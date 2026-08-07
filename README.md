# x402-negotiator

> Agent-to-agent price negotiation instruments — signed offers, counters, and agreements, each returned in-response.

![License](https://img.shields.io/badge/license-Apache--2.0-blue)
![x402](https://img.shields.io/badge/payments-x402%20%2F%20USDC-0052ff)
![rails](https://img.shields.io/badge/rails-Base%20%2B%20Solana-9945ff)
![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)

> **Pay in USDC on Base or Solana — your client picks the rail.** Every 402 challenge lists both.

Two agents want to trade and disagree on the price. Chat gets you a transcript nobody can prove. This gets you **instruments**: three paid moves — open an offer, counter it, accept it — each returning a signed artifact that carries the previous one's signature and payload hash. The result is a hash chain both parties hold, verifiable offline, in order, without trusting the server that produced it.

Counters carry **concession analysis** — how far you moved, how far apart the sides still are, who has actually been conceding, and where the two land if the current rate holds. That is the number an agent needs to decide whether to keep haggling or close.

## Why x402 for this

Negotiation is the one interaction where a per-call price is a feature rather than a friction. At $0.001 an instrument a ten-round haggle costs a cent — cheap enough that nobody optimizes around it, expensive enough that an agent cannot spam a counterparty with a thousand offers for free. Metering by the move gives the protocol a natural, symmetric cost that neither side has to trust the other to enforce. And with no accounts to provision, two agents that have never met can open a thread on first contact.

## Quickstart

```bash
git clone https://github.com/nirholas/x402-negotiator && cd x402-negotiator
npm install
cp .env.example .env        # pre-filled — runs with no edits
npm run dev                 # server on http://localhost:4045
```

Then watch a full negotiation run, paying for every move, with a wallet holding [Base Sepolia USDC](https://faucet.circle.com):

```bash
PRIVATE_KEY=0x... npm run client
```

To receive the fees yourself, set `PAY_TO_ADDRESS` (Base) and `SOLANA_PAY_TO_ADDRESS` (Solana) in `.env` — the server logs a note while the suite defaults are in use.

## API

| Route | Price | What you get back |
|---|---|---|
| `POST /offers` | $0.001 | Signed offer instrument + thread record + counter/accept links |
| `POST /counter/:offerId` | $0.001 | Signed counter with concession analysis |
| `POST /accept/:offerId` | $0.001 | Signed agreement + settlement terms + the full chain |
| `GET /threads/:threadId` | free | The thread plus a server-side chain check |
| `POST /verify-chain` | free | Per-instrument signature and link verification |
| `POST /verify` | free | Signature check for a single instrument |
| `GET /healthz` | free | Liveness + the rails this deployment accepts |

```bash
# 1. Buyer opens
curl -X POST http://localhost:4045/offers -H 'content-type: application/json' -d '{
  "from": "agent:buyer-1", "fromSide": "buyer", "to": "agent:seller-9",
  "item": "200 GPU-hours (A100)", "quantity": 200, "unitPriceUsd": 1.50,
  "terms": { "delivery": "within 7 days" }
}'

# 2. Seller counters the instrument they were handed
curl -X POST http://localhost:4045/counter/off_fe3e1cdfb9dfa7f3 \
  -H 'content-type: application/json' \
  -d '{"from":"agent:seller-9","unitPriceUsd":2.40}'

# 3. …and eventually someone accepts
curl -X POST http://localhost:4045/accept/cnt_86b70669b2762610 \
  -H 'content-type: application/json' \
  -d '{"from":"agent:seller-9","settleWithinHours":24}'
```

`:offerId` is always the `instrumentId` of the **latest** instrument in the thread. Every response hands you `links.counter` and `links.accept` for the instrument it just created — send one to your counterparty and the handoff is done.

## The chain is the product

Every instrument carries `prevSignature` (the previous instrument's HMAC) and `prevHash` (SHA-256 over its canonical payload). Editing anything breaks two links at once, and `POST /verify-chain` — free, consulting no server state — finds them:

```json
{ "valid": true, "length": 4, "problems": [] }
```

```json
// after editing seq 3's price
{ "valid": false,
  "problems": ["seq 3: invalid signature",
               "seq 4: prevHash does not match the previous instrument's payload"] }

// after reordering two instruments
{ "valid": false, "problems": ["seq 3: seq 3 does not follow 1"] }
```

Both parties hold the same chain, and neither needs this server to prove what was agreed. If `data/threads.json` is lost tomorrow, every instrument already issued stays verifiable.

## Reading a counter

```json
"concession": {
  "movedUsd": 90, "movedPct": 30,
  "gapUsd": 90, "gapPct": 20.69,
  "totalMoved": { "buyer": 90, "seller": 0 },
  "projectedSettleUsd": 435, "projectedRounds": 1,
  "note": "At the current rate of concession the sides meet near $435 in about 1 more round(s)."
}
```

`totalMoved` is the honest field: a thread where one side has moved $90 and the other $0 is not a negotiation. `projectedSettleUsd` is `null` — with a note saying why — whenever the arithmetic doesn't support a projection, rather than inventing a comfortable number.

## Rules, and why refusals are artifacts

Turns alternate, only parties may act, you cannot accept your own position, you must act on the latest instrument, and a closed thread stays closed. Break one of those and you get `409`/`403` — **with a signed rejection instrument in the body**, chain-linked like any other and presentable as proof the move was refused and why.

That is deliberate. You paid for the call, so you get an artifact for it. No paid route here produces a bare error or a silent side effect.

## This service does not move money

An agreement is the instrument of *record*: what was agreed, by whom, at what price, by when, and on which rails settlement should happen.

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

The transfer itself happens on a named rail — often an x402 call to the seller's own endpoint. Keeping the two separate is what lets one agreement travel between parties, escrow agents and auditors unchanged.

## How x402 works — two rails, one flow

1. Client calls a paid route → server responds `402 Payment Required` with an `accepts` array holding **both** payment requirements: USDC on Base (EVM) and USDC on Solana (SVM), same price, same resource.
2. Client picks the rail its wallet supports and authorizes exactly that amount — an EIP-3009 transfer authorization on Base, or a fee-sponsored SPL `transferChecked` on Solana — then retries with the `X-PAYMENT` header.
3. The server reads `network` off the payload, selects the matching requirement, and verifies + settles through that rail's facilitator (x402.org for Base, PayAI for Solana by default — the reference facilitator does not settle Solana mainnet).
4. Server responds `200` with the instrument in-body and an `X-PAYMENT-RESPONSE` header carrying the settlement receipt (`rail`, `network`, `facilitator`, `transaction`, `payer`).

Solana buyers need no SOL: the facilitator's `feePayer` sponsors the network fee, so a USDC balance is enough. `x402-fetch` does steps 2–3 automatically — see [`examples/agent-client.ts`](examples/agent-client.ts) and [`examples/curl.md`](examples/curl.md).

Note the two payment layers: paying for an *instrument* costs $0.001 on either rail, and is entirely separate from settling the *agreed price*, which happens later on whichever rail the parties named in `terms.settlementRails`.

## Real backend / API keys

Fully self-contained — no third-party data APIs and no keys to obtain. Thread state persists to `data/threads.json` (file-based, gitignored); losing it invalidates nothing, because instruments carry their own chain.

Payment envs: `PAY_TO_ADDRESS`, `SOLANA_PAY_TO_ADDRESS`, `NETWORK`/`FACILITATOR_URL` (EVM rail), `SOLANA_NETWORK`/`SOLANA_FACILITATOR_URL` (Solana rail). A rail whose address is missing or malformed is dropped from `accepts` with a startup warning — the other rail keeps working.

`SIGNING_SECRET` signs every instrument. Set it **once**, before the first negotiation: rotating it invalidates instruments already in counterparties' hands. A dev fallback (with console warning) keeps the demo keyless.

## For AI agents

- **[skill.md](skill.md)** — agent-facing skill file: endpoints, prices, schemas, payment instructions.
- **`GET /.well-known/x402`** — machine-readable manifest, both rails per resource, indexable by [x402scan.com](https://x402scan.com), the x402 Bazaar, and [agentic.market](https://agentic.market).
- **MCP**: [`examples/mcp-tool.md`](examples/mcp-tool.md) exposes `open_offer`, `counter_offer` and `accept_offer` as Claude tools that pay per move.

Two agents on opposite sides of a trade can both point at the same deployment, or at their own — the instruments are portable either way, as long as both can reach the signer that issued them.

## Docs

Full docs on GitHub Pages: **https://nirholas.github.io/x402-negotiator/** — [tutorial](https://nirholas.github.io/x402-negotiator/tutorial), [API reference](https://nirholas.github.io/x402-negotiator/api), [agents guide](https://nirholas.github.io/x402-negotiator/agents).

Part of the [x402 Suite](https://github.com/nirholas/x402-suite).

## Support

Questions, deployments, or a rail you want added: **nichxbt@gmail.com**

## License

[Apache-2.0](LICENSE)
