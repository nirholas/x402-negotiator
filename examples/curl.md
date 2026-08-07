# curl walkthrough — raw 402 → pay → 200

Start the server:

```bash
npm run dev        # boots with the suite's default receive addresses, on :4045
```

Every paid route is **dual rail**: the 402 lists USDC on Base *and* USDC on Solana at the same price, and you pay with whichever wallet you have.

## 1. Hit a paid route without payment → 402

```bash
curl -si -X POST http://localhost:4045/offers -H 'content-type: application/json' -d '{
  "from": "agent:buyer-1", "fromSide": "buyer", "to": "agent:seller-9",
  "item": "200 GPU-hours (A100)", "quantity": 200, "unitPriceUsd": 1.50,
  "terms": { "delivery": "within 7 days" }
}'
```

Response (trimmed):

```
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "base-sepolia",
      "maxAmountRequired": "1000",
      "resource": "http://localhost:4045/offers",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "extra": { "name": "USDC", "version": "2" }
    },
    {
      "scheme": "exact",
      "network": "solana",
      "maxAmountRequired": "1000",
      "resource": "http://localhost:4045/offers",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "extra": { "name": "USD Coin", "decimals": 6, "feePayer": "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4" }
    }
  ]
}
```

`maxAmountRequired` is USDC base units (6 decimals), so `"1000"` is $0.001. Pick a rail:

```bash
curl -s -X POST http://localhost:4045/offers -H 'content-type: application/json' \
  -d '{"from":"a","fromSide":"buyer","to":"b","item":"x","unitPriceUsd":1}' \
  | jq '.accepts[] | {network, payTo, asset, maxAmountRequired}'
```

## 2. Pay — on either rail

The `X-PAYMENT` header is a base64-encoded, wallet-signed authorization matching one of those entries. Hand-rolling it means EIP-712 (Base) or SPL transaction building (Solana) — use a client:

**Base / EVM**

```bash
PRIVATE_KEY=0x... npm run client       # examples/agent-client.ts runs a whole negotiation
```

Under the hood: parse the 402 → sign an EIP-3009 `transferWithAuthorization` for the exact amount → retry with `X-PAYMENT: <base64 payload>`.

**Solana**

Use any x402 Solana client, or `@three-ws/x402-payment-modal` in a browser. Under the hood: build a fee-sponsored SPL `transferChecked` for `maxAmountRequired` to the base58 `payTo`, have the wallet sign it, base64-encode the x402 envelope, retry with `X-PAYMENT`. `extra.feePayer` sponsors the SOL network fee, so your wallet needs only USDC.

The server reads `network` off your payload, picks the matching requirement, and settles through **that rail's** facilitator — the two differ, and the receipt names the one that handled yours.

## 3. Paid retry → 200 with the instrument in-body

```
HTTP/1.1 200 OK
X-PAYMENT-RESPONSE: <base64 of {"success":true,"rail":"solana","network":"solana","facilitator":"https://facilitator.payai.network","transaction":"5xY…","amount":"1000","asset":"USDC"}>

{
  "instrument": {
    "payload": {
      "type": "offer",
      "from": "agent:buyer-1", "fromSide": "buyer", "to": "agent:seller-9",
      "item": "200 GPU-hours (A100)", "quantity": 200,
      "unitPriceUsd": 1.5, "priceUsd": 300,
      "terms": { "delivery": "within 7 days", "validUntil": "2026-08-09T03:50:34.530Z",
                 "settlementRails": ["x402:base:USDC","x402:solana:USDC"] },
      "concession": null,
      "instrumentId": "off_fe3e1cdfb9dfa7f3",
      "threadId": "thr_4ba6b60dac6848c1",
      "seq": 1, "prevSignature": null, "prevHash": null
    },
    "signature": "643f3341cc99fb5e0f0e959aa2a544577627f1e68a88561c222b4097b1d3ff12"
  },
  "thread": { "threadId": "thr_4ba6b60dac6848c1", "status": "open",
              "parties": { "buyer": "agent:buyer-1", "seller": "agent:seller-9" }, "seq": 1 },
  "links": {
    "thread":  "http://localhost:4045/threads/thr_4ba6b60dac6848c1",
    "counter": "http://localhost:4045/counter/off_fe3e1cdfb9dfa7f3",
    "accept":  "http://localhost:4045/accept/off_fe3e1cdfb9dfa7f3"
  }
}
```

Decode the header to see which rail settled:

```bash
echo "<header value>" | base64 -d | jq
```

**Send `links.counter` to your counterparty.** That is the whole handoff.

## 4. Counter

`:offerId` is always the `instrumentId` of the **latest** instrument.

```bash
curl -X POST http://localhost:4045/counter/off_fe3e1cdfb9dfa7f3 \
  -H 'content-type: application/json' \
  -d '{"from":"agent:seller-9","unitPriceUsd":2.40,"terms":{"notes":"best I can do at this volume"}}'
```

Then the buyer comes back:

```bash
curl -s -X POST http://localhost:4045/counter/cnt_eb04dbf124121b1e \
  -H 'content-type: application/json' \
  -d '{"from":"agent:buyer-1","unitPriceUsd":1.95}' \
  | jq '.instrument.payload.concession'
```

```json
{
  "movedUsd": 90, "movedPct": 30,
  "gapUsd": 90, "gapPct": 20.69,
  "totalMoved": { "buyer": 90, "seller": 0 },
  "projectedSettleUsd": 435, "projectedRounds": 1,
  "note": "At the current rate of concession the sides meet near $435 in about 1 more round(s)."
}
```

## 5. Accept

```bash
curl -s -X POST http://localhost:4045/accept/cnt_86b70669b2762610 \
  -H 'content-type: application/json' \
  -d '{"from":"agent:seller-9","settleWithinHours":24}' \
  | jq '.settlement'
```

```json
{
  "agreedPriceUsd": 390, "agreedUnitPriceUsd": 1.95, "quantity": 200,
  "payer": "agent:buyer-1", "payee": "agent:seller-9",
  "settlementRails": ["x402:base:USDC", "x402:solana:USDC"],
  "settleBy": "2026-08-08T03:50:34.534Z",
  "openedAtUsd": 300, "totalMovementUsd": 90,
  "instructions": "agent:buyer-1 pays agent:seller-9 $390 (200 × $1.95) by … on one of: …"
}
```

No money moved. This is the instrument of record; settlement happens on a named rail.

## 6. Verify the chain — free

```bash
curl -s -X POST http://localhost:4045/verify-chain \
  -H 'content-type: application/json' -d "$(jq -c '{chain: .chain}' agreement.json)" | jq '{valid, length, problems}'
```

```json
{ "valid": true, "length": 4, "problems": [] }
```

Now edit one price in `agreement.json` and run it again:

```json
{ "valid": false, "length": 4,
  "problems": ["seq 3: invalid signature",
               "seq 4: prevHash does not match the previous instrument's payload"] }
```

One edit, two failures. Reorder two instruments instead and you get `"seq 3: seq 3 does not follow 1"`.

## 7. Illegal moves return signed artifacts

```bash
# Counter twice in a row
curl -si -X POST http://localhost:4045/counter/cnt_86b70669b2762610 \
  -H 'content-type: application/json' -d '{"from":"agent:buyer-1","unitPriceUsd":1.99}'
```

```
HTTP/1.1 409 Conflict

{
  "error": "not_your_turn",
  "rejection": {
    "payload": { "type": "rejection", "seq": 4,
                 "reason": "The last instrument (seq 3) was also from the buyer. Wait for the counterparty to respond." },
    "signature": "…"
  }
}
```

You paid for the call, so you get a signed, chain-linked artifact — presentable as proof the move was refused and why. Same for `stale_instrument`, `cannot_accept_own_position`, `not_a_party`, and a closed thread.

## 8. Free routes need no payment

```bash
curl -s http://localhost:4045/threads/thr_4ba6b60dac6848c1 | jq '{status: .thread.status, chainCheck}'
curl -s http://localhost:4045/healthz
curl -s http://localhost:4045/.well-known/x402 | jq
curl -s -X POST http://localhost:4045/verify \
  -H 'content-type: application/json' -d '{"payload":{…},"signature":"…"}'
```
