# API reference

Base URL: your deployment (default `http://localhost:4045`). Machine-readable: [`openapi.json`](https://github.com/nirholas/x402-negotiator/blob/main/openapi.json) · [`/.well-known/x402`](https://github.com/nirholas/x402-negotiator/blob/main/public/.well-known/x402).

All paid routes follow x402: unpaid request → `402` + `PaymentRequirements`; request with a valid `X-PAYMENT` header → `200` + artifact + `X-PAYMENT-RESPONSE`.

## Payment rails

Every paid route is **dual rail** — the 402 body's `accepts[]` holds one entry per rail at the same price, and the server settles whichever one your `X-PAYMENT` payload names in its `network` field.

| Rail | `network` | Asset | payTo | Facilitator |
|---|---|---|---|---|
| EVM | `base-sepolia` (default), `base` | USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x40252CFDF8B20Ed757D61ff157719F33Ec332402` | `https://x402.org/facilitator` |
| Solana | `solana` (default), `solana-devnet` | USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` | `https://facilitator.payai.network` |

The two rails use **different facilitators** because the reference x402.org facilitator does not settle Solana mainnet. Override either with `FACILITATOR_URL` / `SOLANA_FACILITATOR_URL`. The Solana entry carries `extra.feePayer` — the facilitator account that sponsors the SOL network fee, so payers need only USDC.

**402 body**

```json
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    { "scheme": "exact", "network": "base-sepolia", "maxAmountRequired": "1000",
      "resource": "https://host/offers", "description": "…", "mimeType": "application/json",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402", "maxTimeoutSeconds": 60,
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "extra": { "name": "USDC", "version": "2" } },
    { "scheme": "exact", "network": "solana", "maxAmountRequired": "1000",
      "resource": "https://host/offers", "description": "…", "mimeType": "application/json",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW", "maxTimeoutSeconds": 60,
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "extra": { "name": "USD Coin", "decimals": 6, "feePayer": "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4" } }
  ]
}
```

**`X-PAYMENT-RESPONSE`** (on every paid `200`) is base64 JSON, also echoed in the body as `payment`:

```json
{ "success": true, "rail": "solana", "network": "solana",
  "facilitator": "https://facilitator.payai.network",
  "transaction": "5xY…", "payer": "7hF…", "amount": "1000", "asset": "USDC" }
```

Paying for an **instrument** ($0.001) is entirely separate from settling the **agreed price**, which happens later on whichever rail the parties named in `terms.settlementRails`.

---

## The instrument

Every paid route returns one. This is the shape:

| Field | Meaning |
|---|---|
| `payload.type` | `offer` \| `counter` \| `agreement` \| `rejection` |
| `payload.instrumentId` | `off_…` / `cnt_…` / `agr_…` / `rej_…`. Use the latest one as `:offerId` |
| `payload.threadId` | Constant across a negotiation |
| `payload.seq` | 1-based position in the chain |
| `payload.prevSignature` | The previous instrument's signature. `null` at seq 1 |
| `payload.prevHash` | SHA-256 over the previous payload's canonical JSON. `null` at seq 1 |
| `payload.from` / `fromSide` / `to` | Who is speaking, and on which side |
| `payload.unitPriceUsd` / `priceUsd` | The price on the table. `priceUsd = unitPriceUsd × quantity` |
| `payload.terms` | `delivery`, `validUntil`, `settlementRails`, `notes` |
| `payload.concession` | Movement analysis. `null` on the opening offer |
| `payload.settlement` | Agreements only |
| `payload.reason` | Rejections only |
| `signature` | HMAC-SHA256 over the canonical JSON of `payload` |

---

## POST /offers — $0.001

Open a negotiation.

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `from` | string | yes | Your agent/party identifier. Any stable string |
| `fromSide` | string | yes | `buyer` \| `seller`. The counterparty takes the other side |
| `to` | string | yes | Counterparty identifier |
| `item` | string | yes | What is being traded, ≤200 chars |
| `quantity` | number | no | Default `1`, max 1,000,000 |
| `unitPriceUsd` | number | yes | Per-unit price, >0 and <1,000,000 |
| `terms.validUntil` | string | no | ISO timestamp. Default +48h |
| `terms.settlementRails` | string[] | no | Default `["x402:base:USDC", "x402:solana:USDC"]` |
| `terms.delivery`, `terms.notes` | string | no | Free text, on the record |

**200** — real output:

```json
{
  "instrument": {
    "payload": {
      "type": "offer",
      "from": "agent:buyer-1",
      "fromSide": "buyer",
      "to": "agent:seller-9",
      "item": "200 GPU-hours (A100)",
      "quantity": 200,
      "unitPriceUsd": 1.5,
      "priceUsd": 300,
      "currency": "USD",
      "terms": {
        "delivery": "within 7 days",
        "validUntil": "2026-08-09T03:50:34.530Z",
        "settlementRails": ["x402:base:USDC", "x402:solana:USDC"]
      },
      "concession": null,
      "instrumentId": "off_fe3e1cdfb9dfa7f3",
      "threadId": "thr_4ba6b60dac6848c1",
      "seq": 1,
      "prevSignature": null,
      "prevHash": null,
      "issuedAt": "2026-08-07T03:50:34.531Z"
    },
    "signature": "643f3341cc99fb5e0f0e959aa2a544577627f1e68a88561c222b4097b1d3ff12",
    "algorithm": "HMAC-SHA256",
    "canonicalization": "sorted-json"
  },
  "thread": {
    "threadId": "thr_4ba6b60dac6848c1",
    "status": "open",
    "parties": { "buyer": "agent:buyer-1", "seller": "agent:seller-9" },
    "seq": 1
  },
  "links": {
    "thread": "http://localhost:4045/threads/thr_4ba6b60dac6848c1",
    "counter": "http://localhost:4045/counter/off_fe3e1cdfb9dfa7f3",
    "accept": "http://localhost:4045/accept/off_fe3e1cdfb9dfa7f3"
  },
  "payment": { "success": true, "rail": "solana", "network": "solana", "transaction": "5xY…" }
}
```

Send `links.counter` to the counterparty. That is the entire handoff protocol.

**Errors**: `400` invalid body (names the missing field, includes a worked example), `402` unpaid.

---

## POST /counter/:offerId — $0.001

`:offerId` is the `instrumentId` of the **latest** instrument in the thread.

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `from` | string | yes | Must be one of the thread's two parties |
| `unitPriceUsd` | number | yes | Your position, per unit |
| `terms` | object | no | Same shape as on `/offers`. Defaults reapply per instrument |

**200** — real output (seq 3 of a four-instrument thread):

```json
{
  "instrument": {
    "payload": {
      "type": "counter",
      "from": "agent:buyer-1",
      "fromSide": "buyer",
      "to": "agent:seller-9",
      "item": "200 GPU-hours (A100)",
      "quantity": 200,
      "unitPriceUsd": 1.95,
      "priceUsd": 390,
      "currency": "USD",
      "terms": {
        "validUntil": "2026-08-09T03:50:34.533Z",
        "settlementRails": ["x402:base:USDC", "x402:solana:USDC"],
        "notes": "final offer at this volume"
      },
      "concession": {
        "movedUsd": 90,
        "movedPct": 30,
        "gapUsd": 90,
        "gapPct": 20.69,
        "totalMoved": { "buyer": 90, "seller": 0 },
        "projectedSettleUsd": 435,
        "projectedRounds": 1,
        "note": "At the current rate of concession the sides meet near $435 in about 1 more round(s)."
      },
      "instrumentId": "cnt_86b70669b2762610",
      "threadId": "thr_4ba6b60dac6848c1",
      "seq": 3,
      "prevSignature": "7ac8594e267251187f232895d933a14348e308afb418b4f138d2c84090d2dbfe",
      "prevHash": "fefa1a555177e6fb8de7d6e677dd528afdc67be8641ea91d7980339b95d77851",
      "issuedAt": "2026-08-07T03:50:34.533Z"
    },
    "signature": "906f750a0d6bc580031fc4da9b9cf158e6b4d28fa210e8796af1a84747e91f7d",
    "algorithm": "HMAC-SHA256",
    "canonicalization": "sorted-json"
  },
  "thread": { "threadId": "thr_4ba6b60dac6848c1", "status": "open", "seq": 3 },
  "links": {
    "counter": "http://localhost:4045/counter/cnt_86b70669b2762610",
    "accept": "http://localhost:4045/accept/cnt_86b70669b2762610"
  }
}
```

### `concession`

| Field | Meaning |
|---|---|
| `movedUsd` / `movedPct` | How far **you** moved from your own previous position. `0` on your first instrument |
| `gapUsd` / `gapPct` | Distance still between the two sides after this instrument. `gapPct` is measured against the midpoint |
| `totalMoved` | Cumulative concession per side across the whole thread |
| `projectedSettleUsd` | Rough landing point if both sides keep conceding at their observed average rate. `null` when unprojectable |
| `projectedRounds` | Counters still needed at that rate. `null` when unprojectable |
| `note` | Plain-language reading of the above |

`projectedSettleUsd` is deliberately conservative. It is `null` — with a note explaining why — when the counterparty has not opened a position yet, and when neither side has conceded, rather than producing a comfortable number from nothing.

**Errors** (each returns a **signed rejection instrument** in `rejection`, because payment settled):

| Status | Error | Cause |
|---|---|---|
| 403 | `not_a_party` | `from` is neither the buyer nor the seller on this thread |
| 404 | `instrument_not_found` | No such instrument. No artifact — there is no chain to link one into |
| 409 | `not_your_turn` | The latest instrument is already yours |
| 409 | `stale_instrument` | You countered an older seq; the reason names the current one |
| 409 | `thread_agreed` / `thread_expired` | The thread is closed |

---

## POST /accept/:offerId — $0.001

Accept the counterparty's latest position. `:offerId` must be the latest instrument, and must not be your own.

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `from` | string | yes | Must be a party, and not the author of the instrument being accepted |
| `settleWithinHours` | number | no | 1–720, default `48` |
| `notes` | string | no | Carried onto the agreement's terms |

**200** returns the agreement, the settlement broken out, and the **complete chain**:

```json
{
  "agreement": {
    "payload": {
      "type": "agreement",
      "from": "agent:seller-9",
      "fromSide": "seller",
      "priceUsd": 390,
      "unitPriceUsd": 1.95,
      "concession": {
        "movedUsd": 90, "movedPct": 18.75, "gapUsd": 0, "gapPct": 0,
        "totalMoved": { "buyer": 90, "seller": 90 },
        "projectedSettleUsd": 390, "projectedRounds": 0,
        "note": "Positions have met. Accept to close."
      },
      "settlement": { "…": "see below" },
      "instrumentId": "agr_b9c63b3aaa9e3606",
      "seq": 4,
      "prevSignature": "906f750a0d6bc580031fc4da9b9cf158e6b4d28fa210e8796af1a84747e91f7d",
      "prevHash": "143250432ac7470f8bfe31f8941ce76054a4c0427c9ec02b7232b347fe4ecc09"
    },
    "signature": "7b960019f49cb5288eaa6ee88b637a934b5d2b0005831f91aac2636d9b8caec7"
  },
  "settlement": {
    "agreedPriceUsd": 390,
    "agreedUnitPriceUsd": 1.95,
    "quantity": 200,
    "payer": "agent:buyer-1",
    "payerSide": "buyer",
    "payee": "agent:seller-9",
    "payeeSide": "seller",
    "settlementRails": ["x402:base:USDC", "x402:solana:USDC"],
    "settleBy": "2026-08-08T03:50:34.534Z",
    "openedAtUsd": 300,
    "totalMovementUsd": 90,
    "instructions": "agent:buyer-1 pays agent:seller-9 $390 (200 × $1.95) by 2026-08-08T03:50:34.534Z on one of: x402:base:USDC, x402:solana:USDC. This agreement is the instrument of record — present it, with the chain, as proof of terms. Settlement itself happens on the named rail, not here."
  },
  "thread": { "threadId": "thr_4ba6b60dac6848c1", "status": "agreed", "seq": 4 },
  "chain": [ "…all four signed instruments…" ]
}
```

**This route does not move money.** It produces the instrument of record. The transfer happens on a rail named in `settlementRails` — often an x402 call to the seller's own endpoint.

**Errors**: as for `/counter`, plus `409 cannot_accept_own_position`. All return a signed rejection.

---

## GET /threads/:threadId — free

The full thread plus a `chainCheck` computed server-side.

```json
{
  "thread": {
    "threadId": "thr_…", "item": "200 GPU-hours (A100)", "quantity": 200,
    "status": "agreed",
    "parties": { "buyer": "agent:buyer-1", "seller": "agent:seller-9" },
    "chain": [ "…" ],
    "openedAt": "…", "closedAt": "…"
  },
  "chainCheck": { "valid": true, "length": 4, "steps": [ "…" ], "problems": [] }
}
```

`status` is `open`, `agreed`, `withdrawn`, or `expired`. A thread whose latest instrument has passed its `validUntil` flips to `expired` on read.

## POST /verify-chain — free

Send an array of instruments, or `{"chain": [...]}`. No server state is consulted, so this works on instruments you hold from any deployment whose `SIGNING_SECRET` this server shares.

Checks, per instrument: the signature; that `seq` ascends by exactly one; that `prevSignature` matches the previous instrument's signature; that `prevHash` matches SHA-256 of the previous payload's canonical JSON; and that `threadId` is constant.

```json
{
  "valid": true,
  "length": 4,
  "steps": [
    { "seq": 1, "instrumentId": "off_fe3e1cdfb9dfa7f3", "type": "offer",
      "signatureValid": true, "linkValid": true, "problem": null },
    { "seq": 2, "instrumentId": "cnt_eb04dbf124121b1e", "type": "counter",
      "signatureValid": true, "linkValid": true, "problem": null },
    { "seq": 3, "instrumentId": "cnt_86b70669b2762610", "type": "counter",
      "signatureValid": true, "linkValid": true, "problem": null },
    { "seq": 4, "instrumentId": "agr_b9c63b3aaa9e3606", "type": "agreement",
      "signatureValid": true, "linkValid": true, "problem": null }
  ],
  "problems": []
}
```

Real failure output — after editing seq 3's price:

```json
{ "valid": false,
  "problems": ["seq 3: invalid signature",
               "seq 4: prevHash does not match the previous instrument's payload"] }
```

After reordering two instruments:

```json
{ "valid": false, "problems": ["seq 3: seq 3 does not follow 1", "seq 2: seq 2 does not follow 3"] }
```

One edit breaks two links. That redundancy is the point of carrying the chain.

## POST /verify — free

Body: `{"payload": …, "signature": "hex"}` → `{"valid": true|false}` for a single instrument.

## GET /healthz — free

```json
{ "ok": true, "service": "x402-negotiator",
  "rails": [{ "rail": "evm", "network": "base-sepolia" }, { "rail": "solana", "network": "solana" }],
  "threads": 3 }
```

## Signature scheme

`signature = HMAC-SHA256(SIGNING_SECRET, canonicalJson(payload))` where `canonicalJson` recursively sorts object keys and strips `undefined`. `prevHash = SHA-256(canonicalJson(previousPayload))`. See `src/sign.ts` and `verifyChain` in `src/service.ts`.

Rotating `SIGNING_SECRET` invalidates every instrument already issued. Set it once, before the first negotiation.

## Error codes

| Status | Meaning |
|---|---|
| 400 | Invalid body — names the missing field and includes a worked example |
| 402 | Payment required, or the payment failed verification/settlement. Body carries the dual-rail `accepts[]` and an `error` reason |
| 403 | `not_a_party` — signed rejection included |
| 404 | `instrument_not_found` / `thread_not_found` |
| 409 | `not_your_turn` / `stale_instrument` / `cannot_accept_own_position` / `thread_agreed` / `thread_expired` — signed rejection included |
| 500 | `no_payment_rail` when neither rail is configured |
| 502 | `facilitator_unreachable` / `settlement_error` — the rail's facilitator failed; nothing was charged |
