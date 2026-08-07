# For AI agents

x402-negotiator is built for two agents that have never met and have no shared account. Each move is one paid HTTP call, and each returns a signed artifact both sides can verify without trusting either the other party or this server.

**Pay in USDC on Base or Solana — your client picks the rail.** Every 402 challenge carries both requirements at the same price; send `X-PAYMENT` for whichever wallet you hold.

## Discovery

Two machine-readable entry points, served by every deployment:

1. **`/skill.md`** (also at the repo root) — a human-and-agent-readable skill file describing every endpoint, price, parameter, and response schema, following the agentres.dev skill.md pattern. Feed it to your agent as context and it knows how to use the service.
2. **`GET /.well-known/x402`** — a JSON manifest (`x402Version`, `payment.rails[]`, and `resources[]` with prices, both networks, per-rail `accepts`, and output schemas) in the discovery format indexed by [x402scan.com](https://x402scan.com), the x402 Bazaar, and [agentic.market](https://agentic.market).

**Operators:** after deploying, submit your base URL to those indexes so agents can find you — x402scan crawls `/.well-known/x402` automatically once listed.

## The handoff protocol

There isn't one to design. Every paid response includes:

```json
"links": {
  "thread":  "https://negotiate.example/threads/thr_4ba6b60dac6848c1",
  "counter": "https://negotiate.example/counter/cnt_86b70669b2762610",
  "accept":  "https://negotiate.example/accept/cnt_86b70669b2762610"
}
```

Send `links.counter` to your counterparty. They `POST` to it with their price and their identifier, and they get back their own pair of links to send to you. Neither agent needs to know the other's internals, and neither needs a schema for "how to reach me next".

## Paying

Any x402-compatible client works. With `x402-fetch`:

```ts
import { wrapFetchWithPayment } from "x402-fetch";
import { privateKeyToAccount } from "viem/accounts";

const payFetch = wrapFetchWithPayment(fetch, privateKeyToAccount(process.env.PRIVATE_KEY));

const res = await payFetch("https://negotiate.example/offers", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    from: "agent:buyer-1", fromSide: "buyer", to: "agent:seller-9",
    item: "200 GPU-hours (A100)", quantity: 200, unitPriceUsd: 1.5,
  }),
});
const { instrument, links } = await res.json();   // keep BOTH
```

The wrapper handles the 402 → sign → retry loop and enforces a max payment cap (default 0.10 USDC) so a misconfigured server can't drain the wallet. It selects the EVM entry from `accepts[]`.

### Solana rail

Read the entry whose `network` starts with `solana`, build a fee-sponsored SPL `transferChecked` for `maxAmountRequired` to the base58 `payTo`, sign it, and send the base64 x402 envelope as `X-PAYMENT`. `extra.feePayer` sponsors the SOL network fee, so a USDC balance is sufficient — no SOL required.

```ts
import { prepareSolanaCheckout, encodeX402Payment } from "@three-ws/x402-payment-modal/server";

const res = await fetch(url, { method: "POST", headers, body });   // → 402
const accept = (await res.json()).accepts.find((a) => a.network.startsWith("solana"));
const { tx_base64 } = await prepareSolanaCheckout({ accept, buyer: myPublicKey });
const { x_payment } = encodeX402Payment({
  accept, signedTxBase64: await wallet.signTransaction(tx_base64), resourceUrl: accept.resource,
});
const paid = await fetch(url, { method: "POST", headers: { ...headers, "X-PAYMENT": x_payment }, body });
```

### Two payment layers

Do not conflate them:

| Layer | Amount | When | Where |
|---|---|---|---|
| **Instrument fee** | $0.001 | Every move | This service, either rail |
| **Agreed price** | Whatever you negotiated | After the agreement | A rail named in `settlement.settlementRails` |

`X-PAYMENT-RESPONSE` (base64 JSON, echoed in the body as `payment`) covers only the first. It carries `{success, rail, network, facilitator, transaction, payer, amount, asset}` — the two rails settle through different facilitators, and `facilitator` names the one that handled yours.

## Deciding whether to keep haggling

Every counter carries `concession`. Branch on these, in this order:

| Field | What it tells you |
|---|---|
| `totalMoved` | Who has actually been conceding. `{ "buyer": 90, "seller": 0 }` is not a negotiation |
| `gapPct` | How far apart the sides still are, relative to the midpoint |
| `projectedRounds` | Counters still needed at the current rate. `null` means unprojectable |
| `projectedSettleUsd` | Rough landing point. `null` rather than a guess when the arithmetic doesn't support one |

A reasonable policy:

```ts
const c = instrument.payload.concession;
if (c.gapUsd === 0) return accept();
if (c.totalMoved[theirSide] === 0 && rounds > 2) return walkAway();   // they aren't moving
if (c.projectedRounds !== null && c.projectedRounds > 8) return walkAway();
if (nextPrice < myReserve) return counter(nextPrice);
return walkAway();
```

Keep your reserve price on your side. Nothing in the protocol asks for it, and nothing in an instrument reveals it — instruments record only the positions actually put on the table.

## Handling refusals

`403` and `409` responses carry a **signed rejection instrument** in `rejection`, chain-linked like any other. Treat them as data, not exceptions:

| Error | What your agent should do |
|---|---|
| `not_your_turn` | You already moved. Wait — do not retry |
| `stale_instrument` | Re-read `GET /threads/:id` (free) and act on the latest seq |
| `cannot_accept_own_position` | You tried to accept your own price. Counter, or wait |
| `not_a_party` | Your `from` string doesn't match either party. Check it against `thread.parties` |
| `thread_agreed` / `thread_expired` | Closed. Open a new thread if you still want the trade |
| `instrument_not_found` | The only case with **no** artifact — there is no chain to link one into |

Retrying a `not_your_turn` costs another $0.001 and returns another rejection. Read the `reason` string; it names the exact seq that blocked you.

## Verifying what you hold

`POST /verify-chain` (free) checks every signature and every link — ascending sequence, matching `prevSignature`, matching `prevHash`, constant `threadId` — against instruments you supply. No server state is consulted.

Verify **before** acting on an agreement someone forwarded you, and store the chain afterwards. A single edit anywhere breaks two links, so a chain that verifies is a chain nobody has touched:

```json
{ "valid": false,
  "problems": ["seq 3: invalid signature",
               "seq 4: prevHash does not match the previous instrument's payload"] }
```

Both parties should keep the full chain. It outlives the deployment: as long as the signer is reachable (or you hold the secret), an agreement remains provable.

## Budgeting

$0.001 per move means a ten-round negotiation costs a cent — deliberately cheap enough that haggling is never the expensive part, and metered enough that an agent cannot flood a counterparty for free. For hard ceilings across many threads, wrap your fetch with [`x402-agent-wallet`](https://github.com/nirholas/x402-agent-wallet)'s policy checks.

## MCP integration

To give Claude these moves as tools, see [`examples/mcp-tool.md`](https://github.com/nirholas/x402-negotiator/blob/main/examples/mcp-tool.md) — an MCP server exposing `open_offer`, `counter_offer`, `accept_offer` and `verify_chain`, each paying its own way via `x402-fetch`.

## Composing with the suite

- `x402-price-watch` tells you when the market moved; the negotiator is where you act on it against a specific counterparty.
- `x402-group-pay` can fund the buyer side of an agreed price across several wallets, and its funded proof pairs naturally with an agreement as evidence the money is in.
- `x402-concierge` can carry a signed agreement into a downstream booking as proof of agreed terms.
- Settlement of the agreed price is deliberately out of scope here — point `settlementRails` at whichever x402 endpoint actually takes the money.

Questions or integration help: **nichxbt@gmail.com**
