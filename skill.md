# x402-negotiator — agent skill

Agent-to-agent price negotiation as **signed instruments**. Three paid moves — open an offer, counter it, accept it — and each returns a signed instrument in the response body. The instruments form a hash chain: every one carries the previous one's signature and payload hash, so a holder can verify an entire negotiation offline, in order, without trusting this server or asking it anything.

Counters carry **concession analysis**: how far you moved, how far apart the sides still are, and where they converge if both keep conceding at the current rate. That is the number an agent needs to decide whether to keep haggling.

**Pay in USDC on Base or Solana — your client picks the rail.** Every 402 challenge lists both.

**Base URL**: `{BASE_URL}` (self-hosted; default `http://localhost:4045`)

## The three moves

### POST /offers — $0.001

Open a negotiation. You declare which side you are on; the counterparty takes the other.

```json
{
  "from": "agent:buyer-1",
  "fromSide": "buyer",
  "to": "agent:seller-9",
  "item": "200 GPU-hours (A100)",
  "quantity": 200,
  "unitPriceUsd": 1.50,
  "terms": {
    "delivery": "within 7 days",
    "validUntil": "2026-08-09T00:00:00Z",
    "settlementRails": ["x402:base:USDC", "x402:solana:USDC"],
    "notes": "spot capacity, flexible on start date"
  }
}
```

| Field | Required | Notes |
|---|---|---|
| `from` | yes | Your agent/party identifier. Any stable string |
| `fromSide` | yes | `buyer` \| `seller` |
| `to` | yes | The counterparty's identifier |
| `item` | yes | What is being traded (≤200 chars) |
| `quantity` | no | Default `1` |
| `unitPriceUsd` | yes | Per-unit price. `priceUsd` = `unitPriceUsd × quantity` |
| `terms.validUntil` | no | ISO timestamp. Default +48h |
| `terms.settlementRails` | no | Default `["x402:base:USDC", "x402:solana:USDC"]` |
| `terms.delivery`, `terms.notes` | no | Free text, on the record |

Response 200 (real output):

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
  "thread": { "threadId": "thr_4ba6b60dac6848c1", "status": "open",
              "parties": { "buyer": "agent:buyer-1", "seller": "agent:seller-9" }, "seq": 1 },
  "links": { "thread": "…/threads/thr_…", "counter": "…/counter/off_…", "accept": "…/accept/off_…" },
  "payment": { "success": true, "rail": "solana", "network": "solana", "transaction": "5xY…" }
}
```

Send `links.counter` to the counterparty. That is the whole handoff.

### POST /counter/:offerId — $0.001

`:offerId` is the `instrumentId` of the **latest** instrument in the thread — the one you are responding to.

```json
{ "from": "agent:seller-9", "unitPriceUsd": 2.40, "terms": { "notes": "best I can do at this volume" } }
```

Response 200 (real output, seq 3 of a four-instrument thread):

```json
{
  "instrument": {
    "payload": {
      "type": "counter",
      "from": "agent:buyer-1",
      "fromSide": "buyer",
      "to": "agent:seller-9",
      "unitPriceUsd": 1.95,
      "priceUsd": 390,
      "terms": { "validUntil": "…", "settlementRails": ["x402:base:USDC", "x402:solana:USDC"],
                 "notes": "final offer at this volume" },
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
    "algorithm": "HMAC-SHA256"
  },
  "thread": { "threadId": "thr_…", "status": "open", "seq": 3 },
  "links": { "thread": "…", "counter": "…/counter/cnt_86b70669b2762610", "accept": "…/accept/cnt_86b70669b2762610" }
}
```

**Reading `concession`**

| Field | Meaning |
|---|---|
| `movedUsd` / `movedPct` | How far **you** moved from your own previous position |
| `gapUsd` / `gapPct` | How far apart the two sides still are, after this instrument |
| `totalMoved` | Cumulative concession per side — who has been doing the conceding |
| `projectedSettleUsd` | Rough landing point if both sides keep conceding at their observed rate. `null` when the arithmetic doesn't support a projection |
| `projectedRounds` | Counters still needed at that rate. `null` when unprojectable |

`totalMoved` is the field worth watching: a thread where one side has moved $90 and the other $0 is not a negotiation, and the projection will say so by refusing to guess.

### POST /accept/:offerId — $0.001

Accept the counterparty's latest position. `:offerId` must be the latest instrument, and it must **not** be your own.

```json
{ "from": "agent:seller-9", "settleWithinHours": 24, "notes": "invoice to ops@example.com" }
```

Response 200 returns the agreement, the settlement terms broken out, and the **full chain**:

```json
{
  "agreement": { "payload": { "type": "agreement", "seq": 4, "priceUsd": 390, "…": "…" }, "signature": "7b96…" },
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
  "thread": { "threadId": "thr_…", "status": "agreed", "seq": 4 },
  "chain": [ "…all four signed instruments…" ]
}
```

**This service does not move money.** It produces the instrument of record that says what was agreed, by whom, at what price, and on which rails settlement should happen. The transfer itself happens on a named rail — often an x402 call to the seller's own endpoint.

## Rules the server enforces

| Rule | What happens if you break it |
|---|---|
| Turns alternate | `409 not_your_turn` + a signed rejection naming the seq that blocked you |
| Only parties may act | `403 not_a_party` + signed rejection |
| You cannot accept your own position | `409 cannot_accept_own_position` + signed rejection |
| You must act on the latest instrument | `409 stale_instrument` + signed rejection naming the current seq |
| A closed thread stays closed | `409 thread_agreed` / `thread_expired` + signed rejection |

Every one of those returns a **signed rejection instrument** in the body, not a bare error, because you already paid. A rejection is itself a chain-linked artifact you can present as proof the move was refused and why.

## Verification — the point of the design

### POST /verify-chain — free

Send an array of instruments (or `{"chain": [...]}`) you already hold. The server checks every signature and every link: sequence numbers ascending by one, each `prevSignature` matching the previous instrument, each `prevHash` matching the previous payload, and a constant `threadId`.

```json
{
  "valid": true,
  "length": 4,
  "steps": [
    { "seq": 1, "instrumentId": "off_fe3e1cdfb9dfa7f3", "type": "offer", "signatureValid": true, "linkValid": true, "problem": null },
    { "seq": 4, "instrumentId": "agr_b9c63b3aaa9e3606", "type": "agreement", "signatureValid": true, "linkValid": true, "problem": null }
  ],
  "problems": []
}
```

Tamper with any price and you get:

```json
{ "valid": false,
  "problems": ["seq 3: invalid signature", "seq 4: prevHash does not match the previous instrument's payload"] }
```

Reorder two instruments and you get `"seq 3: seq 3 does not follow 1"`. A single edit breaks two links, which is what makes the chain worth carrying.

### GET /threads/:threadId — free
The full thread plus a `chainCheck` computed server-side.

### POST /verify — free
Body `{payload, signature}` → `{valid}` for a single instrument.

### GET /healthz — free

## Payment — dual rail

Protocol: **x402** (HTTP 402). Asset: **USDC** on both rails. A 402 response carries an `accepts` array with two entries; send `X-PAYMENT` for whichever you can pay.

| Rail | `network` | Asset address | payTo | Facilitator |
|---|---|---|---|---|
| EVM | `base-sepolia` (`base` via `NETWORK`) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x40252CFDF8B20Ed757D61ff157719F33Ec332402` | `https://x402.org/facilitator` |
| Solana | `solana` (`solana-devnet` via `SOLANA_NETWORK`) | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` | `https://facilitator.payai.network` |

The two rails settle through **different facilitators** — the reference x402.org facilitator does not settle Solana mainnet. The receipt names the one that handled yours.

Flow: request → `402` with `accepts[]` → pick your rail → sign the USDC authorization (EIP-3009 on Base, fee-sponsored SPL `transferChecked` on Solana; `extra.feePayer` sponsors the SOL fee so you need no SOL) → retry with `X-PAYMENT` → `200` with the instrument in-body plus an `X-PAYMENT-RESPONSE` header, echoed in the body as `payment`.

At $0.001 an instrument, a ten-round negotiation costs a cent. The price is deliberately low enough that haggling is never the expensive part.

## Error codes

| Status | Meaning |
|---|---|
| 400 | Invalid body — names the missing field and includes a worked example |
| 402 | Payment required, or the payment failed verification/settlement. Body carries the dual-rail `accepts[]` |
| 403 | `not_a_party` — signed rejection included |
| 404 | `instrument_not_found` — no signed artifact, because there is no thread to link one into |
| 409 | `not_your_turn` / `stale_instrument` / `cannot_accept_own_position` / `thread_agreed` / `thread_expired` — signed rejection included |
| 500 | `no_payment_rail` when neither rail is configured |
| 502 | `facilitator_unreachable` / `settlement_error` — the rail's facilitator failed; nothing was charged |

Machine-readable manifest (lists both rails per resource): `{BASE_URL}/.well-known/x402`

Contact: **nichxbt@gmail.com**
