import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activeRails, paymentReceipt, paywall, usingSuiteDefaultPayTo } from "./payments.js";
import {
  ThreadStore,
  acceptOffer,
  counterOffer,
  openOffer,
  validateAccept,
  validateCounter,
  validateOffer,
  verifyChain,
} from "./service.js";
import { usingDevSecret, verify } from "./sign.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

const PORT = Number(process.env.PORT ?? 4045);

const PRICES: Record<string, string> = {
  "POST /offers": "$0.001",
  "POST /counter/:offerId": "$0.001",
  "POST /accept/:offerId": "$0.001",
};

const DESCRIPTIONS: Record<string, string> = {
  "POST /offers": "Open a negotiation; returns a signed offer instrument",
  "POST /counter/:offerId": "Counter the latest instrument; returns a signed counter with concession analysis",
  "POST /accept/:offerId": "Accept the counterparty's position; returns a signed agreement with settlement terms",
};

const rails = activeRails();
const store = new ThreadStore();

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(paywall(PRICES, { service: "x402-negotiator", descriptions: DESCRIPTIONS }));

function links(req: express.Request, threadId: string, instrumentId: string) {
  const base = (process.env.PUBLIC_BASE_URL ?? `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  return {
    thread: `${base}/threads/${threadId}`,
    counter: `${base}/counter/${instrumentId}`,
    accept: `${base}/accept/${instrumentId}`,
  };
}

// ---------- paid routes ----------

app.post("/offers", (req, res) => {
  const { error, input } = validateOffer(req.body);
  if (error || !input) {
    res.status(400).json({
      error,
      hint: 'POST body: {"from":"agent:buyer-1","fromSide":"buyer","to":"agent:seller-9","item":"200 GPU-hours (A100)","quantity":200,"unitPriceUsd":1.85,"terms":{"delivery":"within 7 days","validUntil":"2026-08-10T00:00:00Z"}}',
    });
    return;
  }
  const { thread, instrument } = openOffer(store, input);
  res.status(200).json({
    instrument,
    thread: { threadId: thread.threadId, status: thread.status, parties: thread.parties, seq: instrument.payload.seq },
    links: links(req, thread.threadId, instrument.payload.instrumentId),
    payment: paymentReceipt(res),
  });
});

app.post("/counter/:offerId", (req, res) => {
  const { error, input } = validateCounter(req.body);
  if (error || !input) {
    res.status(400).json({
      error,
      hint: 'POST body: {"from":"agent:seller-9","unitPriceUsd":2.10,"terms":{"notes":"best I can do at this volume"}}',
    });
    return;
  }
  const result = counterOffer(store, req.params.offerId, input);
  if (!result.ok) {
    // Payment already settled — return the signed rejection instrument, not a bare error.
    res.status(result.status).json({
      error: result.error,
      rejection: result.instrument,
      payment: paymentReceipt(res),
    });
    return;
  }
  res.status(200).json({
    instrument: result.instrument,
    thread: {
      threadId: result.thread.threadId,
      status: result.thread.status,
      parties: result.thread.parties,
      seq: result.instrument.payload.seq,
    },
    links: links(req, result.thread.threadId, result.instrument.payload.instrumentId),
    payment: paymentReceipt(res),
  });
});

app.post("/accept/:offerId", (req, res) => {
  const { error, input } = validateAccept(req.body);
  if (error || !input) {
    res.status(400).json({
      error,
      hint: 'POST body: {"from":"agent:buyer-1","settleWithinHours":24,"notes":"invoice to ops@example.com"}',
    });
    return;
  }
  const result = acceptOffer(store, req.params.offerId, input);
  if (!result.ok) {
    res.status(result.status).json({
      error: result.error,
      rejection: result.instrument,
      payment: paymentReceipt(res),
    });
    return;
  }
  res.status(200).json({
    agreement: result.instrument,
    settlement: result.instrument.payload.settlement,
    thread: {
      threadId: result.thread.threadId,
      status: result.thread.status,
      parties: result.thread.parties,
      seq: result.instrument.payload.seq,
    },
    chain: result.thread.chain,
    payment: paymentReceipt(res),
  });
});

// ---------- free routes ----------

app.get("/threads/:threadId", (req, res) => {
  const thread = store.get(req.params.threadId);
  if (!thread) {
    res.status(404).json({ error: "thread_not_found" });
    return;
  }
  res.json({ thread, chainCheck: verifyChain(thread.chain) });
});

app.post("/verify", (req, res) => {
  const { payload, signature } = req.body ?? {};
  if (payload === undefined || typeof signature !== "string") {
    res.status(400).json({ error: "body must be {payload, signature}" });
    return;
  }
  res.json({ valid: verify({ payload, signature }) });
});

/** Verify a whole chain of instruments you already hold — no server state consulted. */
app.post("/verify-chain", (req, res) => {
  const chain = Array.isArray(req.body) ? req.body : req.body?.chain;
  if (!Array.isArray(chain)) {
    res.status(400).json({
      error: "body must be an array of signed instruments, or {chain: [...]}",
    });
    return;
  }
  res.json(verifyChain(chain));
});

app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    service: "x402-negotiator",
    rails: rails.map((r) => ({ rail: r.rail, network: r.network })),
    threads: store.list().length,
  });
});

app.get("/.well-known/x402", (_req, res) => {
  res.type("application/json");
  res.sendFile(path.join(PUBLIC_DIR, ".well-known", "x402"));
});

// Agent-facing skill file lives at the repo root; serve it alongside the manifest.
app.get("/skill.md", (_req, res) => {
  res.type("text/markdown");
  res.sendFile(path.resolve(__dirname, "..", "skill.md"));
});

app.use(express.static(PUBLIC_DIR));

app.listen(PORT, () => {
  console.log(`x402-negotiator listening on http://localhost:${PORT}`);
  console.log("  Payment rails (client picks one):");
  for (const rail of rails) {
    console.log(`    ${rail.rail.padEnd(7)} ${rail.network.padEnd(14)} USDC → ${rail.payTo}`);
    console.log(`            facilitator: ${rail.facilitator}`);
  }
  if (usingSuiteDefaultPayTo()) {
    console.log(
      "  NOTE: using suite default payTo — set PAY_TO_ADDRESS / SOLANA_PAY_TO_ADDRESS to receive funds yourself.",
    );
  }
  if (usingDevSecret()) {
    console.log("  WARNING: using built-in dev SIGNING_SECRET — set SIGNING_SECRET in production.");
    console.log("           Instruments are signed with it; rotating it invalidates every issued instrument.");
  }
  console.log("  Paid routes:");
  for (const [route, price] of Object.entries(PRICES)) {
    console.log(`    ${route.padEnd(26)} ${price}`);
  }
  console.log("  Free routes: GET /threads/:id, POST /verify, POST /verify-chain, GET /healthz, GET /.well-known/x402");
});
