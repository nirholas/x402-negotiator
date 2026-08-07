/**
 * Full x402 flow against x402-negotiator, EVM rail (primary).
 *
 * Every paid route is DUAL RAIL: the 402 challenge lists USDC on Base and USDC
 * on Solana at the same price, and you pay with whichever you hold. This example
 * uses `x402-fetch` + `viem`, which handles the Base rail. See the "Solana rail"
 * note at the bottom of this file for the SVM path.
 *
 * It plays BOTH agents against the same server so you can watch a whole
 * negotiation without a counterparty:
 *
 *   1. buyer opens at $1.50/unit          (paid, $0.001)
 *   2. seller counters at $2.40           (paid, $0.001)
 *   3. buyer counters at $1.95            (paid, $0.001)
 *   4. seller accepts                     (paid, $0.001)
 *   5. verify the chain                   (free)
 *   6. tamper with it and verify again    (free) — watch it fail
 *   7. try an illegal move                (paid) — get a signed rejection
 *
 * Usage:
 *   PRIVATE_KEY=0x... BASE_URL=http://localhost:4045 npm run client
 *
 * PRIVATE_KEY must hold Base Sepolia USDC (faucet: https://faucet.circle.com).
 */
import { config } from "dotenv";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";

config();

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4045";
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error("Set PRIVATE_KEY (0x… key of a wallet holding Base Sepolia USDC).");
  process.exit(1);
}

const BUYER = "agent:buyer-1";
const SELLER = "agent:seller-9";

const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
const payFetch = wrapFetchWithPayment(fetch, account);

async function post(path: string, body: unknown): Promise<{ status: number; body: any; res: Response }> {
  const res = await payFetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json(), res };
}

function printReceiptHeader(res: Response, label: string): void {
  const header = res.headers.get("x-payment-response");
  if (header) {
    const r = decodeXPaymentResponse(header) as any;
    console.log(`  ${label} paid on the ${r.rail ?? "?"} rail (${r.network ?? "?"}) tx ${r.transaction ?? "—"}`);
  }
}

function printInstrument(instrument: any, label: string): void {
  const p = instrument.payload;
  console.log(
    `  ${label} seq ${p.seq} · ${p.type} · ${p.fromSide} ${p.from} · $${p.priceUsd} ($${p.unitPriceUsd}/unit) · ${p.instrumentId}`,
  );
  console.log(`    prevSignature: ${p.prevSignature ? p.prevSignature.slice(0, 16) + "…" : "null"}`);
  if (p.concession) {
    const c = p.concession;
    console.log(
      `    concession: moved $${c.movedUsd} (${c.movedPct}%) · gap $${c.gapUsd} (${c.gapPct}%) · ` +
        `totalMoved buyer $${c.totalMoved.buyer} / seller $${c.totalMoved.seller}`,
    );
    console.log(`    ${c.note}`);
  }
}

async function main(): Promise<void> {
  console.log(`agent wallet: ${account.address}`);
  console.log("(one wallet is paying for both sides here — in the real thing each agent pays for its own moves)\n");

  // ---- 1. Buyer opens ----
  const opened = await post("/offers", {
    from: BUYER,
    fromSide: "buyer",
    to: SELLER,
    item: "200 GPU-hours (A100)",
    quantity: 200,
    unitPriceUsd: 1.5,
    terms: { delivery: "within 7 days", notes: "spot capacity, flexible on start date" },
  });
  console.log("1) buyer opens:");
  printInstrument(opened.body.instrument, "offer");
  printReceiptHeader(opened.res, "offer");
  console.log(`    hand this to the counterparty → ${opened.body.links.counter}`);

  const threadId: string = opened.body.thread.threadId;
  let latest: string = opened.body.instrument.payload.instrumentId;

  // ---- 2 & 3. Counters. Turns must alternate; the server enforces it. ----
  const counters = [
    { from: SELLER, unitPriceUsd: 2.4, notes: "best I can do at this volume" },
    { from: BUYER, unitPriceUsd: 1.95, notes: "final offer at this volume" },
  ];
  let step = 2;
  for (const c of counters) {
    const r = await post(`/counter/${latest}`, {
      from: c.from,
      unitPriceUsd: c.unitPriceUsd,
      terms: { notes: c.notes },
    });
    console.log(`\n${step}) ${c.from === BUYER ? "buyer" : "seller"} counters:`);
    printInstrument(r.body.instrument, "counter");
    printReceiptHeader(r.res, "counter");
    latest = r.body.instrument.payload.instrumentId;
    step++;
  }

  // ---- 4. Seller accepts the buyer's last position ----
  const accepted = await post(`/accept/${latest}`, { from: SELLER, settleWithinHours: 24 });
  console.log("\n4) seller accepts:");
  printInstrument(accepted.body.agreement, "agreement");
  printReceiptHeader(accepted.res, "accept");
  const s = accepted.body.settlement;
  console.log(
    `\n  SETTLEMENT: ${s.payer} owes ${s.payee} $${s.agreedPriceUsd} ` +
      `(${s.quantity} × $${s.agreedUnitPriceUsd}) by ${s.settleBy}`,
  );
  console.log(`  rails: ${s.settlementRails.join(", ")}`);
  console.log(`  opened at $${s.openedAtUsd}, total movement $${s.totalMovementUsd}`);
  console.log("  NOTE: no money moved here. This is the instrument of record; settlement happens on a named rail.");

  const chain = accepted.body.chain;

  // ---- 5. Verify the chain (free) ----
  const check = await (
    await fetch(`${BASE_URL}/verify-chain`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chain }),
    })
  ).json();
  console.log(`\n5) chain check: valid=${check.valid} length=${check.length} problems=${JSON.stringify(check.problems)}`);

  // ---- 6. Tamper, and watch it break in two places ----
  const tampered = JSON.parse(JSON.stringify(chain));
  tampered[2].payload.unitPriceUsd = 0.01;
  const broken = await (
    await fetch(`${BASE_URL}/verify-chain`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chain: tampered }),
    })
  ).json();
  console.log(`6) after editing seq 3's price: valid=${broken.valid}`);
  for (const p of broken.problems) console.log(`    ${p}`);
  console.log("    (one edit breaks the instrument's own signature AND the next one's prevHash)");

  // ---- 7. An illegal move still returns a signed artifact ----
  const illegal = await post(`/accept/${latest}`, { from: BUYER });
  console.log(`\n7) buyer tries to accept a closed thread → ${illegal.status} ${illegal.body.error}`);
  if (illegal.body.rejection) {
    console.log(`    signed rejection seq ${illegal.body.rejection.payload.seq}: ${illegal.body.rejection.payload.reason}`);
    console.log("    (you paid for the call, so you get an artifact — not a bare error)");
  }

  console.log(`\nThread: ${BASE_URL}/threads/${threadId} (free)`);
  console.log("Done. Five paid moves, $0.005 total.");
}

main().catch((err) => {
  console.error("agent-client failed:", err);
  process.exit(1);
});

/* ---------------------------------------------------------------------------
 * Solana rail — the same routes, paid with USDC on Solana.
 *
 * The 402 body's `accepts` array has a second entry with `network: "solana"`, a
 * base58 `payTo`, the USDC mint as `asset`, and `extra.feePayer` — the
 * facilitator account that sponsors the SOL network fee, so your wallet needs
 * only USDC. Note the two rails settle through DIFFERENT facilitators: the
 * reference x402.org facilitator does not settle Solana mainnet, so this server
 * routes the Solana rail to PayAI by default (SOLANA_FACILITATOR_URL).
 *
 * Build a fee-sponsored SPL `transferChecked` for `maxAmountRequired`, sign it,
 * and send it base64-encoded as `X-PAYMENT`:
 *
 *   const challenge = await (await fetch(`${BASE_URL}/offers`, {
 *     method: "POST", headers, body,
 *   })).json();
 *   const solana = challenge.accepts.find((a: any) => a.network.startsWith("solana"));
 *
 *   //   import { prepareSolanaCheckout, encodeX402Payment }
 *   //     from "@three-ws/x402-payment-modal/server";
 *   //   const { tx_base64 } = await prepareSolanaCheckout({ accept: solana, buyer: myPubkey });
 *   //   const signed = await wallet.signTransaction(tx_base64);
 *   //   const { x_payment } = encodeX402Payment({
 *   //     accept: solana, signedTxBase64: signed, resourceUrl: solana.resource,
 *   //   });
 *   //   await fetch(`${BASE_URL}/offers`, {
 *   //     method: "POST", headers: { ...headers, "X-PAYMENT": x_payment }, body,
 *   //   });
 *
 * And the raw dual-rail 402 body, for reference:
 *
 *   curl -s -X POST http://localhost:4045/offers -H 'content-type: application/json' \\
 *     -d '{"from":"a","fromSide":"buyer","to":"b","item":"x","unitPriceUsd":1}' \\
 *     | jq '.accepts[] | {network, payTo, maxAmountRequired}'
 *
 *   { "network": "base-sepolia", "payTo": "0x4025…2402", "maxAmountRequired": "1000" }
 *   { "network": "solana",       "payTo": "Wwwu…T3WwW", "maxAmountRequired": "1000" }
 *
 * Remember the two layers: this pays for the INSTRUMENT ($0.001). Settling the
 * AGREED PRICE happens later, on whichever rail the parties named in
 * terms.settlementRails.
 * ------------------------------------------------------------------------- */
