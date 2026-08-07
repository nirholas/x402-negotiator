// Agent-to-agent price negotiation instruments.
//
// Three paid moves — open an offer, counter it, accept it — and each one returns
// a signed instrument in the response body. The instruments form a hash chain:
// every one carries the signature of the one before it, so a holder can verify
// the whole negotiation offline, in order, without trusting this server or
// asking it anything.
//
// Nothing here is a side effect. Even the failure cases (countering an expired
// offer, accepting a thread that already closed) return a signed instrument
// naming the reason, because the caller has already paid.

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalize, sign, verify, type SignedArtifact } from "./sign.js";

export type Side = "buyer" | "seller";
export type InstrumentType = "offer" | "counter" | "agreement" | "rejection";
export type ThreadStatus = "open" | "agreed" | "withdrawn" | "expired";

export interface Terms {
  /** Free-text delivery / fulfilment expectation. */
  delivery?: string;
  /** ISO timestamp after which this position lapses. */
  validUntil: string;
  /** Payment rails the proposer will accept for settlement. */
  settlementRails: string[];
  /** Anything else the parties want on the record. */
  notes?: string;
}

export interface InstrumentPayload {
  type: InstrumentType;
  instrumentId: string;
  threadId: string;
  /** 1-based position in the chain. */
  seq: number;
  /** Signature of the previous instrument, or null for the opening offer. */
  prevSignature: string | null;
  /** SHA-256 over the canonical JSON of the previous instrument's payload. */
  prevHash: string | null;
  /** Who is speaking. */
  from: string;
  fromSide: Side;
  to: string;
  item: string;
  quantity: number;
  /** The price this instrument puts on the table (unit price × quantity). */
  priceUsd: number;
  unitPriceUsd: number;
  currency: "USD";
  terms: Terms;
  issuedAt: string;
  /** Populated from seq 2 onward. */
  concession: Concession | null;
  /** Only on agreements. */
  settlement?: Settlement;
  /** Only on rejections. */
  reason?: string;
}

export interface Concession {
  /** How far this side moved from its own previous position, in USD. */
  movedUsd: number;
  movedPct: number;
  /** Distance still between the two sides after this instrument. */
  gapUsd: number;
  gapPct: number;
  /** Sum of concessions so far, per side. */
  totalMoved: { buyer: number; seller: number };
  /**
   * Where the two sides land if both keep conceding at their current average
   * rate. Null when a side has not moved, or when the gap is widening.
   */
  projectedSettleUsd: number | null;
  /** Rounds of counters still needed at the current rate, or null. */
  projectedRounds: number | null;
  note: string;
}

export interface Settlement {
  agreedPriceUsd: number;
  agreedUnitPriceUsd: number;
  quantity: number;
  payer: string;
  payerSide: Side;
  payee: string;
  payeeSide: Side;
  settlementRails: string[];
  settleBy: string;
  /** Total movement from the opening offer to the agreed price. */
  openedAtUsd: number;
  totalMovementUsd: number;
  instructions: string;
}

export type Instrument = SignedArtifact<InstrumentPayload>;

export interface Thread {
  threadId: string;
  item: string;
  quantity: number;
  status: ThreadStatus;
  parties: { buyer: string; seller: string };
  chain: Instrument[];
  openedAt: string;
  closedAt: string | null;
}

// ---------------------------------------------------------------------------
// Storage — file-based by design, same as the rest of the suite.
// ---------------------------------------------------------------------------

const DATA_DIR = path.resolve(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "threads.json");

export class ThreadStore {
  private threads = new Map<string, Thread>();

  constructor() {
    try {
      if (existsSync(DATA_FILE)) {
        for (const t of JSON.parse(readFileSync(DATA_FILE, "utf8")) as Thread[]) {
          this.threads.set(t.threadId, t);
        }
      }
    } catch {
      // Corrupt or missing state file — start fresh. Instruments in the wild
      // remain verifiable regardless: the chain is self-contained.
    }
  }

  private save(): void {
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(DATA_FILE, JSON.stringify([...this.threads.values()], null, 2));
    } catch {
      // Persistence is best-effort; in-memory state remains authoritative.
    }
  }

  get(threadId: string): Thread | undefined {
    const thread = this.threads.get(threadId);
    if (thread && thread.status === "open" && lastOf(thread).payload.terms.validUntil < new Date().toISOString()) {
      thread.status = "expired";
      thread.closedAt = new Date().toISOString();
      this.save();
    }
    return thread;
  }

  /** Find the thread containing an instrument, plus that instrument. */
  findInstrument(instrumentId: string): { thread: Thread; instrument: Instrument } | undefined {
    for (const thread of this.threads.values()) {
      const instrument = thread.chain.find((i) => i.payload.instrumentId === instrumentId);
      if (instrument) return { thread: this.get(thread.threadId) ?? thread, instrument };
    }
    return undefined;
  }

  put(thread: Thread): void {
    this.threads.set(thread.threadId, thread);
    this.save();
  }

  list(): Thread[] {
    return [...this.threads.values()];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;
const nowIso = () => new Date().toISOString();

function lastOf(thread: Thread): Instrument {
  return thread.chain[thread.chain.length - 1];
}

function hashOf(payload: unknown): string {
  return createHash("sha256").update(canonicalize(payload)).digest("hex");
}

function otherSide(side: Side): Side {
  return side === "buyer" ? "seller" : "buyer";
}

/** The most recent price put on the table by a given side, if any. */
function lastPriceBySide(thread: Thread, side: Side): number | null {
  for (let i = thread.chain.length - 1; i >= 0; i--) {
    if (thread.chain[i].payload.fromSide === side) return thread.chain[i].payload.priceUsd;
  }
  return null;
}

/**
 * How far this side just moved, how far apart the sides still are, and — if
 * both keep conceding at their observed average rate — roughly where and when
 * they meet. Deliberately conservative: it returns null rather than a guess
 * whenever the arithmetic doesn't support one.
 */
function computeConcession(thread: Thread, side: Side, newPrice: number): Concession {
  const myPrevious = lastPriceBySide(thread, side);
  const theirLatest = lastPriceBySide(thread, otherSide(side));

  const movedUsd = myPrevious === null ? 0 : round2(Math.abs(newPrice - myPrevious));
  const movedPct = myPrevious ? round2((movedUsd / myPrevious) * 100) : 0;
  const gapUsd = theirLatest === null ? 0 : round2(Math.abs(newPrice - theirLatest));
  const midpoint = theirLatest === null ? newPrice : (newPrice + theirLatest) / 2;
  const gapPct = midpoint ? round2((gapUsd / midpoint) * 100) : 0;

  // Average concession per round, per side, including this instrument.
  const totals: { buyer: number; seller: number } = { buyer: 0, seller: 0 };
  const rounds: { buyer: number; seller: number } = { buyer: 0, seller: 0 };
  const prices: { buyer: number | null; seller: number | null } = { buyer: null, seller: null };
  for (const inst of thread.chain) {
    const s = inst.payload.fromSide;
    if (prices[s] !== null) {
      totals[s] += Math.abs(inst.payload.priceUsd - (prices[s] as number));
      rounds[s] += 1;
    }
    prices[s] = inst.payload.priceUsd;
  }
  if (prices[side] !== null) {
    totals[side] += movedUsd;
    rounds[side] += 1;
  }
  totals.buyer = round2(totals.buyer);
  totals.seller = round2(totals.seller);

  const myRate = rounds[side] > 0 ? totals[side] / rounds[side] : 0;
  const theirRate = rounds[otherSide(side)] > 0 ? totals[otherSide(side)] / rounds[otherSide(side)] : 0;
  const combinedRate = myRate + theirRate;

  let projectedSettleUsd: number | null = null;
  let projectedRounds: number | null = null;
  let note: string;

  if (theirLatest === null) {
    note = "Opening position — nothing to converge on yet.";
  } else if (gapUsd === 0) {
    projectedSettleUsd = round2(newPrice);
    projectedRounds = 0;
    note = "Positions have met. Accept to close.";
  } else if (combinedRate <= 0) {
    note = "Neither side has conceded yet, so no convergence can be projected.";
  } else {
    projectedRounds = Math.ceil(gapUsd / combinedRate);
    projectedSettleUsd = round2(midpoint);
    note =
      projectedRounds > 6
        ? `At the current rate of concession this needs roughly ${projectedRounds} more rounds — at $0.001 per instrument that is cheap, but consider whether the gap is real.`
        : `At the current rate of concession the sides meet near $${projectedSettleUsd} in about ${projectedRounds} more round(s).`;
  }

  return {
    movedUsd,
    movedPct,
    gapUsd,
    gapPct,
    totalMoved: totals,
    projectedSettleUsd,
    projectedRounds,
    note,
  };
}

function makeInstrument(
  thread: Thread,
  fields: Omit<InstrumentPayload, "instrumentId" | "threadId" | "seq" | "prevSignature" | "prevHash" | "issuedAt">,
): Instrument {
  const previous = thread.chain.length > 0 ? lastOf(thread) : null;
  const payload: InstrumentPayload = {
    ...fields,
    instrumentId: `${fields.type === "agreement" ? "agr" : fields.type === "rejection" ? "rej" : fields.type === "counter" ? "cnt" : "off"}_${randomBytes(8).toString("hex")}`,
    threadId: thread.threadId,
    seq: thread.chain.length + 1,
    prevSignature: previous ? previous.signature : null,
    prevHash: previous ? hashOf(previous.payload) : null,
    issuedAt: nowIso(),
  };
  return sign(payload);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const MAX_PRICE = 1_000_000;

export interface OfferInput {
  from: string;
  fromSide: Side;
  to: string;
  item: string;
  quantity?: number;
  unitPriceUsd: number;
  terms?: Partial<Terms>;
}

export interface CounterInput {
  from: string;
  unitPriceUsd: number;
  terms?: Partial<Terms>;
}

export interface AcceptInput {
  from: string;
  /** Optional deadline for settling the agreed amount. Default +48h. */
  settleWithinHours?: number;
  notes?: string;
}

function normalizeTerms(input: Partial<Terms> | undefined, fallbackHours: number): Terms {
  const hours = Math.min(Math.max(Number(input?.validUntil ? 0 : fallbackHours) || fallbackHours, 1), 24 * 30);
  const validUntil =
    typeof input?.validUntil === "string" && !Number.isNaN(Date.parse(input.validUntil))
      ? new Date(input.validUntil).toISOString()
      : new Date(Date.now() + hours * 3_600_000).toISOString();
  const rails = Array.isArray(input?.settlementRails) && input.settlementRails.length > 0
    ? input.settlementRails.map(String).slice(0, 8)
    : ["x402:base:USDC", "x402:solana:USDC"];
  return {
    delivery: input?.delivery ? String(input.delivery).slice(0, 300) : undefined,
    validUntil,
    settlementRails: rails,
    notes: input?.notes ? String(input.notes).slice(0, 500) : undefined,
  };
}

export function validateOffer(body: unknown): { error?: string; input?: OfferInput } {
  const b = body as OfferInput;
  if (!b || typeof b !== "object") return { error: "body must be a JSON object" };
  if (!b.from || typeof b.from !== "string") return { error: "from (your agent/party identifier) is required" };
  if (b.fromSide !== "buyer" && b.fromSide !== "seller") return { error: 'fromSide must be "buyer" or "seller"' };
  if (!b.to || typeof b.to !== "string") return { error: "to (the counterparty identifier) is required" };
  if (!b.item || typeof b.item !== "string") return { error: "item (what is being traded) is required" };
  const unit = Number(b.unitPriceUsd);
  if (!Number.isFinite(unit) || unit <= 0 || unit > MAX_PRICE) {
    return { error: `unitPriceUsd must be a positive number under ${MAX_PRICE}` };
  }
  const qty = b.quantity === undefined ? 1 : Number(b.quantity);
  if (!Number.isFinite(qty) || qty <= 0 || qty > 1_000_000) {
    return { error: "quantity must be a positive number under 1000000" };
  }
  return { input: { ...b, quantity: qty, unitPriceUsd: unit } };
}

export function validateCounter(body: unknown): { error?: string; input?: CounterInput } {
  const b = body as CounterInput;
  if (!b || typeof b !== "object") return { error: "body must be a JSON object" };
  if (!b.from || typeof b.from !== "string") return { error: "from (your agent/party identifier) is required" };
  const unit = Number(b.unitPriceUsd);
  if (!Number.isFinite(unit) || unit <= 0 || unit > MAX_PRICE) {
    return { error: `unitPriceUsd must be a positive number under ${MAX_PRICE}` };
  }
  return { input: { ...b, unitPriceUsd: unit } };
}

export function validateAccept(body: unknown): { error?: string; input?: AcceptInput } {
  const b = (body ?? {}) as AcceptInput;
  if (!b.from || typeof b.from !== "string") return { error: "from (your agent/party identifier) is required" };
  return { input: b };
}

// ---------------------------------------------------------------------------
// The three paid moves
// ---------------------------------------------------------------------------

export function openOffer(store: ThreadStore, input: OfferInput): { thread: Thread; instrument: Instrument } {
  const terms = normalizeTerms(input.terms, 48);
  const quantity = input.quantity ?? 1;
  const thread: Thread = {
    threadId: `thr_${randomBytes(8).toString("hex")}`,
    item: input.item.slice(0, 200),
    quantity,
    status: "open",
    parties:
      input.fromSide === "buyer"
        ? { buyer: input.from, seller: input.to }
        : { buyer: input.to, seller: input.from },
    chain: [],
    openedAt: nowIso(),
    closedAt: null,
  };

  const instrument = makeInstrument(thread, {
    type: "offer",
    from: input.from,
    fromSide: input.fromSide,
    to: input.to,
    item: thread.item,
    quantity,
    unitPriceUsd: round2(input.unitPriceUsd),
    priceUsd: round2(input.unitPriceUsd * quantity),
    currency: "USD",
    terms,
    concession: null,
  });

  thread.chain.push(instrument);
  store.put(thread);
  return { thread, instrument };
}

export type MoveResult =
  | { ok: true; thread: Thread; instrument: Instrument }
  | { ok: false; status: number; error: string; instrument: Instrument | null };

/** Signed rejection instrument — returned instead of a bare error, since the caller paid. */
function rejection(thread: Thread, from: string, fromSide: Side, reason: string): Instrument {
  const latest = lastOf(thread);
  return makeInstrument(thread, {
    type: "rejection",
    from,
    fromSide,
    to: fromSide === "buyer" ? thread.parties.seller : thread.parties.buyer,
    item: thread.item,
    quantity: thread.quantity,
    unitPriceUsd: latest.payload.unitPriceUsd,
    priceUsd: latest.payload.priceUsd,
    currency: "USD",
    terms: latest.payload.terms,
    concession: null,
    reason,
  });
}

function sideOf(thread: Thread, party: string): Side | null {
  if (party === thread.parties.buyer) return "buyer";
  if (party === thread.parties.seller) return "seller";
  return null;
}

export function counterOffer(store: ThreadStore, instrumentId: string, input: CounterInput): MoveResult {
  const found = store.findInstrument(instrumentId);
  if (!found) {
    return { ok: false, status: 404, error: "instrument_not_found", instrument: null };
  }
  const { thread } = found;
  const latest = lastOf(thread);

  const side = sideOf(thread, input.from);
  if (!side) {
    return {
      ok: false,
      status: 403,
      error: "not_a_party",
      instrument: rejection(thread, input.from, "buyer", `"${input.from}" is not a party to this thread.`),
    };
  }
  if (thread.status !== "open") {
    return {
      ok: false,
      status: 409,
      error: `thread_${thread.status}`,
      instrument: rejection(thread, input.from, side, `Thread is ${thread.status}; no further counters are possible.`),
    };
  }
  if (latest.payload.fromSide === side) {
    return {
      ok: false,
      status: 409,
      error: "not_your_turn",
      instrument: rejection(
        thread,
        input.from,
        side,
        `The last instrument (seq ${latest.payload.seq}) was also from the ${side}. Wait for the counterparty to respond.`,
      ),
    };
  }
  if (found.instrument.payload.seq !== latest.payload.seq) {
    return {
      ok: false,
      status: 409,
      error: "stale_instrument",
      instrument: rejection(
        thread,
        input.from,
        side,
        `You countered seq ${found.instrument.payload.seq} but the thread is at seq ${latest.payload.seq}. Re-read the thread and counter the latest instrument.`,
      ),
    };
  }

  const terms = normalizeTerms(input.terms, 48);
  const concession = computeConcession(thread, side, round2(input.unitPriceUsd * thread.quantity));

  const instrument = makeInstrument(thread, {
    type: "counter",
    from: input.from,
    fromSide: side,
    to: side === "buyer" ? thread.parties.seller : thread.parties.buyer,
    item: thread.item,
    quantity: thread.quantity,
    unitPriceUsd: round2(input.unitPriceUsd),
    priceUsd: round2(input.unitPriceUsd * thread.quantity),
    currency: "USD",
    terms,
    concession,
  });

  thread.chain.push(instrument);
  store.put(thread);
  return { ok: true, thread, instrument };
}

export function acceptOffer(store: ThreadStore, instrumentId: string, input: AcceptInput): MoveResult {
  const found = store.findInstrument(instrumentId);
  if (!found) {
    return { ok: false, status: 404, error: "instrument_not_found", instrument: null };
  }
  const { thread } = found;
  const latest = lastOf(thread);

  const side = sideOf(thread, input.from);
  if (!side) {
    return {
      ok: false,
      status: 403,
      error: "not_a_party",
      instrument: rejection(thread, input.from, "buyer", `"${input.from}" is not a party to this thread.`),
    };
  }
  if (thread.status !== "open") {
    return {
      ok: false,
      status: 409,
      error: `thread_${thread.status}`,
      instrument: rejection(thread, input.from, side, `Thread is ${thread.status}; it can no longer be accepted.`),
    };
  }
  if (latest.payload.fromSide === side) {
    return {
      ok: false,
      status: 409,
      error: "cannot_accept_own_position",
      instrument: rejection(
        thread,
        input.from,
        side,
        `Seq ${latest.payload.seq} is your own position. You can only accept the counterparty's.`,
      ),
    };
  }
  if (found.instrument.payload.seq !== latest.payload.seq) {
    return {
      ok: false,
      status: 409,
      error: "stale_instrument",
      instrument: rejection(
        thread,
        input.from,
        side,
        `You accepted seq ${found.instrument.payload.seq} but the thread is at seq ${latest.payload.seq}. Accept the latest instrument or counter it.`,
      ),
    };
  }

  const hours = Math.min(Math.max(Number(input.settleWithinHours ?? 48) || 48, 1), 24 * 30);
  const opening = thread.chain[0].payload.priceUsd;
  const agreed = latest.payload.priceUsd;
  const payerSide: Side = "buyer";
  const payer = thread.parties.buyer;
  const payee = thread.parties.seller;

  const settlement: Settlement = {
    agreedPriceUsd: agreed,
    agreedUnitPriceUsd: latest.payload.unitPriceUsd,
    quantity: thread.quantity,
    payer,
    payerSide,
    payee,
    payeeSide: "seller",
    settlementRails: latest.payload.terms.settlementRails,
    settleBy: new Date(Date.now() + hours * 3_600_000).toISOString(),
    openedAtUsd: opening,
    totalMovementUsd: round2(Math.abs(agreed - opening)),
    instructions:
      `${payer} pays ${payee} $${agreed} (${thread.quantity} × $${latest.payload.unitPriceUsd}) ` +
      `by ${new Date(Date.now() + hours * 3_600_000).toISOString()} on one of: ${latest.payload.terms.settlementRails.join(", ")}. ` +
      `This agreement is the instrument of record — present it, with the chain, as proof of terms. ` +
      `Settlement itself happens on the named rail, not here.`,
  };

  const instrument = makeInstrument(thread, {
    type: "agreement",
    from: input.from,
    fromSide: side,
    to: side === "buyer" ? thread.parties.seller : thread.parties.buyer,
    item: thread.item,
    quantity: thread.quantity,
    unitPriceUsd: latest.payload.unitPriceUsd,
    priceUsd: agreed,
    currency: "USD",
    terms: { ...latest.payload.terms, notes: input.notes ? String(input.notes).slice(0, 500) : latest.payload.terms.notes },
    concession: computeConcession(thread, side, agreed),
    settlement,
  });

  thread.chain.push(instrument);
  thread.status = "agreed";
  thread.closedAt = nowIso();
  store.put(thread);
  return { ok: true, thread, instrument };
}

// ---------------------------------------------------------------------------
// Chain verification — the point of the whole design
// ---------------------------------------------------------------------------

export interface ChainCheck {
  valid: boolean;
  length: number;
  /** Per-instrument findings, in order. */
  steps: {
    seq: number;
    instrumentId: string;
    type: InstrumentType;
    signatureValid: boolean;
    linkValid: boolean;
    problem: string | null;
  }[];
  problems: string[];
}

/**
 * Verify a chain end to end: every signature, and every link (each instrument
 * must carry the previous one's signature and payload hash, with sequence
 * numbers ascending by one). This runs offline against instruments a caller
 * already holds — no server state is consulted.
 */
export function verifyChain(chain: Instrument[]): ChainCheck {
  const steps: ChainCheck["steps"] = [];
  const problems: string[] = [];

  if (!Array.isArray(chain) || chain.length === 0) {
    return { valid: false, length: 0, steps: [], problems: ["chain must be a non-empty array of signed instruments"] };
  }

  for (let i = 0; i < chain.length; i++) {
    const inst = chain[i];
    const payload = inst?.payload;
    if (!payload || typeof inst.signature !== "string") {
      problems.push(`index ${i}: not a signed instrument ({payload, signature})`);
      steps.push({ seq: i + 1, instrumentId: "?", type: "offer", signatureValid: false, linkValid: false, problem: "malformed" });
      continue;
    }

    const signatureValid = verify({ payload, signature: inst.signature });
    let linkValid = true;
    let problem: string | null = null;

    if (i === 0) {
      if (payload.seq !== 1 || payload.prevSignature !== null || payload.prevHash !== null) {
        linkValid = false;
        problem = "opening instrument must have seq 1 and no previous link";
      }
    } else {
      const prev = chain[i - 1];
      if (payload.seq !== prev.payload.seq + 1) {
        linkValid = false;
        problem = `seq ${payload.seq} does not follow ${prev.payload.seq}`;
      } else if (payload.prevSignature !== prev.signature) {
        linkValid = false;
        problem = "prevSignature does not match the previous instrument";
      } else if (payload.prevHash !== hashOf(prev.payload)) {
        linkValid = false;
        problem = "prevHash does not match the previous instrument's payload";
      } else if (payload.threadId !== prev.payload.threadId) {
        linkValid = false;
        problem = "threadId changes mid-chain";
      }
    }

    if (!signatureValid) problems.push(`seq ${payload.seq}: invalid signature`);
    if (problem) problems.push(`seq ${payload.seq}: ${problem}`);

    steps.push({
      seq: payload.seq,
      instrumentId: payload.instrumentId,
      type: payload.type,
      signatureValid,
      linkValid,
      problem,
    });
  }

  return { valid: problems.length === 0, length: chain.length, steps, problems };
}
