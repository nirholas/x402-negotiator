# Tutorial — from clone to a signed agreement

This walkthrough runs a complete four-instrument negotiation and then proves it can't be tampered with.

Every paid route here accepts **USDC on Base or USDC on Solana** — the 402 challenge lists both and the client picks. The walkthrough uses the Base Sepolia testnet rail because it is the easiest to fund; step 7 covers the Solana rail and mainnet.

## 1. Install

```bash
git clone https://github.com/nirholas/x402-negotiator
cd x402-negotiator
npm install
```

Requires Node 18+. There are no data-provider keys to obtain — this service is self-contained.

## 2. Configure

```bash
cp .env.example .env
```

`.env.example` ships pre-filled with the x402 Suite's public receive addresses, so **the server runs with no edits**. To receive the money yourself, replace both:

```
# EVM (Base / Base Sepolia) USDC receive address
PAY_TO_ADDRESS=0xYourReceivingWallet
# Solana USDC receive address
SOLANA_PAY_TO_ADDRESS=YourBase58SolanaWallet
```

One variable deserves more care here than elsewhere in the suite: **`SIGNING_SECRET`**. It signs every instrument, and instruments live in your counterparties' hands, not just yours. Rotating it invalidates agreements other people are holding. Set it once, before the first negotiation, and leave it alone.

## 3. Run the server

```bash
npm run dev
```

```
x402-negotiator listening on http://localhost:4045
  Payment rails (client picks one):
    evm     base-sepolia   USDC → 0x40252CFDF8B20Ed757D61ff157719F33Ec332402
            facilitator: https://x402.org/facilitator
    solana  solana         USDC → WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW
            facilitator: https://facilitator.payai.network
  Paid routes:
    POST /offers               $0.001
    POST /counter/:offerId     $0.001
    POST /accept/:offerId      $0.001
```

Note the two facilitators. The reference x402.org facilitator does not settle Solana mainnet, so the Solana rail defaults to PayAI's public facilitator — no key needed for either.

## 4. Your first 402

```bash
curl -si -X POST http://localhost:4045/offers -H 'content-type: application/json' -d '{
  "from":"agent:buyer-1","fromSide":"buyer","to":"agent:seller-9",
  "item":"200 GPU-hours (A100)","quantity":200,"unitPriceUsd":1.50
}'
```

You get `HTTP/1.1 402 Payment Required` and a body whose `accepts[]` array holds **two** x402 `PaymentRequirements` — one per rail, same price:

```bash
curl -s -X POST http://localhost:4045/offers -H 'content-type: application/json' \
  -d '{"from":"a","fromSide":"buyer","to":"b","item":"x","unitPriceUsd":1}' \
  | jq '.accepts[] | {network, payTo, asset, maxAmountRequired}'
```

```json
{ "network": "base-sepolia", "payTo": "0x4025…2402", "asset": "0x036C…CF7e", "maxAmountRequired": "1000" }
{ "network": "solana",       "payTo": "Wwwu…T3WwW", "asset": "EPjF…TDt1v", "maxAmountRequired": "1000" }
```

`maxAmountRequired` is USDC base units (6 decimals), so `"1000"` = $0.001. Nothing was charged; this is the price quote.

## 5. A paid negotiation

Fund a wallet with Base Sepolia USDC from https://faucet.circle.com, then:

```bash
PRIVATE_KEY=0xThatWalletsKey npm run client
```

`examples/agent-client.ts` plays **both** agents against the same server: the buyer opens at $1.50/unit, the seller counters at $2.40, the buyer comes back at $1.95, and the seller accepts — four paid instruments, $0.004 in total. It then verifies the chain, tampers with it, and verifies again so you can watch the check fail.

## 6. Reading the instruments

### The offer (seq 1)

```json
{
  "type": "offer",
  "from": "agent:buyer-1", "fromSide": "buyer", "to": "agent:seller-9",
  "item": "200 GPU-hours (A100)", "quantity": 200,
  "unitPriceUsd": 1.5, "priceUsd": 300,
  "terms": { "delivery": "within 7 days", "validUntil": "2026-08-09T03:50:34.530Z",
             "settlementRails": ["x402:base:USDC", "x402:solana:USDC"] },
  "concession": null,
  "instrumentId": "off_fe3e1cdfb9dfa7f3", "threadId": "thr_4ba6b60dac6848c1",
  "seq": 1, "prevSignature": null, "prevHash": null
}
```

`prevSignature` and `prevHash` are `null` because nothing came before. `concession` is `null` for the same reason.

The response also gives you `links.counter` and `links.accept`. **Send `links.counter` to the counterparty** — that is the entire handoff protocol. They do not need to know your `threadId`, your API shape, or anything else.

### A counter (seq 3)

```json
{
  "type": "counter",
  "from": "agent:buyer-1", "fromSide": "buyer",
  "unitPriceUsd": 1.95, "priceUsd": 390,
  "concession": {
    "movedUsd": 90, "movedPct": 30,
    "gapUsd": 90, "gapPct": 20.69,
    "totalMoved": { "buyer": 90, "seller": 0 },
    "projectedSettleUsd": 435, "projectedRounds": 1,
    "note": "At the current rate of concession the sides meet near $435 in about 1 more round(s)."
  },
  "seq": 3,
  "prevSignature": "7ac8594e267251187f232895d933a14348e308afb418b4f138d2c84090d2dbfe",
  "prevHash": "fefa1a555177e6fb8de7d6e677dd528afdc67be8641ea91d7980339b95d77851"
}
```

Read `totalMoved` before `projectedSettleUsd`. `{ "buyer": 90, "seller": 0 }` says the buyer has conceded $90 and the seller nothing — which tells you more about whether to keep going than any projection can.

`projectedSettleUsd` is `null` whenever the arithmetic doesn't support a guess (nobody has conceded, or the counterparty hasn't opened yet), with `note` saying so. It will not invent a comfortable number.

### The agreement (seq 4)

```json
"settlement": {
  "agreedPriceUsd": 390, "agreedUnitPriceUsd": 1.95, "quantity": 200,
  "payer": "agent:buyer-1", "payee": "agent:seller-9",
  "settlementRails": ["x402:base:USDC", "x402:solana:USDC"],
  "settleBy": "2026-08-08T03:50:34.534Z",
  "openedAtUsd": 300, "totalMovementUsd": 90,
  "instructions": "agent:buyer-1 pays agent:seller-9 $390 (200 × $1.95) by … on one of: …"
}
```

**No money moved.** This is the instrument of record: what was agreed, by whom, by when, on which rails. The transfer happens separately, on a rail named in `settlementRails` — often an x402 call to the seller's own endpoint.

## 7. Prove the chain

Take the `chain` array from the accept response and post it back — free:

```bash
curl -s -X POST http://localhost:4045/verify-chain \
  -H 'content-type: application/json' -d "$(jq -c '{chain: .chain}' agreement.json)" | jq
```

```json
{ "valid": true, "length": 4, "problems": [] }
```

Now edit one price in the saved file and try again:

```json
{ "valid": false,
  "problems": ["seq 3: invalid signature",
               "seq 4: prevHash does not match the previous instrument's payload"] }
```

One edit, two failures — the instrument's own signature and the next one's back-reference. Swap two instruments instead:

```json
{ "valid": false, "problems": ["seq 3: seq 3 does not follow 1", "seq 2: seq 2 does not follow 3"] }
```

This runs entirely on the instruments you hold. No server state is consulted, which means a counterparty can verify your copy without asking you for anything, and both of you keep a record that outlives this deployment.

## 8. What the server refuses — and still gives you

Try countering twice in a row:

```bash
curl -s -X POST http://localhost:4045/counter/cnt_86b70669b2762610 \
  -H 'content-type: application/json' -d '{"from":"agent:buyer-1","unitPriceUsd":1.99}'
```

```json
{
  "error": "not_your_turn",
  "rejection": {
    "payload": { "type": "rejection", "seq": 4,
                 "reason": "The last instrument (seq 3) was also from the buyer. Wait for the counterparty to respond." },
    "signature": "…"
  }
}
```

That is a `409` — and a **signed, chain-linked rejection instrument**. You paid for the call, so you get an artifact for it, and you can present that artifact as proof the move was refused and why.

The same holds for acting on a stale instrument, accepting your own position, acting as a non-party, or touching a thread that already closed.

## 9. Paying on the Solana rail

The second `accepts[]` entry is the Solana rail. Its `extra.feePayer` is the facilitator account that sponsors the SOL network fee, so a payer needs **only USDC** — no SOL for gas.

Build a fee-sponsored SPL `transferChecked` for `maxAmountRequired` to the base58 `payTo`, sign it, and send the base64 x402 envelope as `X-PAYMENT`. The payment modal's server helpers do the building and encoding:

```ts
import { prepareSolanaCheckout, encodeX402Payment } from "@three-ws/x402-payment-modal/server";

const res = await fetch(`${BASE}/offers`, { method: "POST", headers, body });   // → 402
const accept = (await res.json()).accepts.find((a) => a.network.startsWith("solana"));

const { tx_base64 } = await prepareSolanaCheckout({ accept, buyer: myPublicKey });
const { x_payment } = encodeX402Payment({
  accept, signedTxBase64: await wallet.signTransaction(tx_base64), resourceUrl: accept.resource,
});
const paid = await fetch(`${BASE}/offers`, { method: "POST", headers: { ...headers, "X-PAYMENT": x_payment }, body });
```

To test on devnet instead of mainnet, set `SOLANA_NETWORK=devnet`.

Remember the two layers: this pays for the **instrument** ($0.001). Settling the **agreed price** ($390 in the example) happens later, on whichever rail the parties named.

## 10. Going live

1. **EVM rail**: set `NETWORK=base` and point `FACILITATOR_URL` at a mainnet-capable facilitator (the default x402.org facilitator settles testnets).
2. **Solana rail**: already mainnet by default (`SOLANA_NETWORK=mainnet-beta`, PayAI facilitator). Nothing to change.
3. Set `SIGNING_SECRET` — **once**, before any real negotiation. Treat it like a signing key, because that is what it is.
4. Set `PUBLIC_BASE_URL` so the `links.counter` you hand counterparties point at your real host.
5. Use real receiving wallets for `PAY_TO_ADDRESS` / `SOLANA_PAY_TO_ADDRESS`.

Want a single rail? Unset the other rail's `payTo`; it is dropped from `accepts` with a startup warning and the remaining rail keeps working.

Prices stay in dollar strings (`$0.001`); the middleware converts to USDC base units per network, so both rails always quote the same price.
