---
name: negotiate-price
description: Run the x402-negotiator HTTP service and drive an agent-to-agent price negotiation with signed offer, counter and agreement instruments, then verify the chain offline. Use when two agents must agree a price with a verifiable record.
---

# x402-negotiator

x402-negotiator turns a negotiation into signed instruments (offer, counter, agreement). Each is returned in the 200 body and links to the previous one by signature and payload hash, so the whole chain can be verified without trusting the server. It records what was agreed; it does not move money.

Paying is irreversible. Before any paid call, show the user the route, price, network and payTo address from the 402 response, and wait for an explicit yes.

## Run the service

From a clone (Node 18+):

```bash
git clone https://github.com/nirholas/x402-negotiator
cd x402-negotiator && npm install
npm run dev        # tsx src/server.ts, listens on :4045 (PORT overrides)
```

Environment (see `.env.example`): `SIGNING_SECRET` (HMAC key for instruments; if unset a built-in dev secret is used, so set it for anything real). Payment settings: `PAY_TO_ADDRESS` (Base receive address), `SOLANA_PAY_TO_ADDRESS`, `NETWORK` (`base-sepolia` default, or `base`), `SOLANA_NETWORK`, `FACILITATOR_URL`, `PUBLIC_BASE_URL`. Set your own pay-to addresses to be paid yourself. `npm run build` then `npm start` runs the compiled server.

## Routes

| Route | Price | Body or notes |
|---|---|---|
| `POST /offers` | $0.001 | `from`, `fromSide` (`buyer` or `seller`), `to`, `item`, `unitPriceUsd` required; `quantity`, `terms.validUntil`, `terms.settlementRails`, `terms.delivery`, `terms.notes` optional |
| `POST /counter/:offerId` | $0.001 | `:offerId` is the `instrumentId` of the latest instrument; body `from`, `unitPriceUsd`, optional `terms`; response includes `concession` analysis |
| `POST /accept/:offerId` | $0.001 | body `from`, optional `settleWithinHours`, `notes`; returns the agreement and the full chain |
| `POST /verify-chain` | free | an array of instruments, or `{"chain": [...]}`; checks signatures, sequence and links |
| `GET /threads/:threadId` | free | full thread plus a server-side `chainCheck` |
| `POST /verify` | free | `{payload, signature}` for one instrument |
| `GET /healthz`, `GET /skill.md`, `GET /.well-known/x402` | free | status and discovery |

## Paying

An unpaid request to a paid route returns 402 with an `accepts` array listing both rails (USDC on Base or Solana). Sign the entry your wallet supports and retry with the base64 `X-PAYMENT` header. The settlement receipt is in the `X-PAYMENT-RESPONSE` header. The reference client is `examples/agent-client.ts` (`npm run client`), which uses `x402-fetch` with `PRIVATE_KEY` for a Base Sepolia wallet and `BASE_URL` (default `http://localhost:4045`).

Turn rules: turns alternate, only the two parties may act, you cannot accept your own position, and you must act on the latest instrument. A violation returns a signed rejection instrument (409 `not_your_turn`, `stale_instrument`, `cannot_accept_own_position`, `thread_agreed`, `thread_expired`, or 403 `not_a_party`) in the body.

## Example

```bash
curl -i -X POST localhost:4045/offers -H 'content-type: application/json' \
  -d '{"from":"agent:buyer-1","fromSide":"buyer","to":"agent:seller-9","item":"200 GPU-hours (A100)","quantity":200,"unitPriceUsd":1.85}'
# 402 first. After approval and payment the 200 body holds instrument, thread and links.counter.
# Counter with POST /counter/<instrumentId>, accept with POST /accept/<instrumentId>,
# then POST the collected instruments to /verify-chain (free) to confirm the chain.
```
