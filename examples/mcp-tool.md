# Expose x402-negotiator as an MCP tool for Claude

[MCP](https://modelcontextprotocol.io) lets Claude call your services as tools. This implementation wraps `x402-fetch`, so every move pays its own way with USDC.

The service is **dual rail** — its 402 challenges accept USDC on Base *and* USDC on Solana. `x402-fetch` pays the Base rail; to pay from a Solana wallet instead, swap the fetch wrapper for an x402 Solana client (see [`docs/agents.md`](../docs/agents.md#solana-rail)). Everything below is otherwise identical.

## The server

```ts
// negotiator-mcp.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { wrapFetchWithPayment } from "x402-fetch";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

const BASE = process.env.NEGOTIATOR_URL ?? "http://localhost:4045";
const ME = process.env.AGENT_ID ?? "agent:claude-1";
const payFetch = wrapFetchWithPayment(
  fetch,
  privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`),
);

// The chain we hold, per thread. Kept here rather than in the model's context —
// instruments are long, and the agent only needs the latest state to decide.
const chains = new Map<string, any[]>();

async function paidPost(path: string, body: unknown) {
  const res = await payFetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const server = new McpServer({ name: "x402-negotiator", version: "0.1.0" });

server.tool(
  "open_offer",
  "Open a price negotiation with a counterparty ($0.001). Returns a signed offer instrument and a `counter` link to hand to the other side.",
  {
    to: z.string().describe("Counterparty identifier."),
    side: z.enum(["buyer", "seller"]).describe("Which side YOU are on."),
    item: z.string(),
    quantity: z.number().optional(),
    unitPriceUsd: z.number().describe("Your opening position, per unit."),
    delivery: z.string().optional(),
    notes: z.string().optional(),
  },
  async ({ to, side, item, quantity, unitPriceUsd, delivery, notes }) => {
    const { body } = await paidPost("/offers", {
      from: ME, fromSide: side, to, item, quantity, unitPriceUsd,
      terms: { delivery, notes },
    });
    chains.set(body.thread.threadId, [body.instrument]);
    return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
  },
);

server.tool(
  "counter_offer",
  "Counter the latest instrument in a thread ($0.001). The response includes concession analysis: how far each side has moved and where they converge. A 409 returns a SIGNED REJECTION explaining the refusal — read `rejection.payload.reason` rather than retrying blindly.",
  {
    instrumentId: z.string().describe("instrumentId of the LATEST instrument (from the counterparty's link, or from thread_state)."),
    unitPriceUsd: z.number(),
    notes: z.string().optional(),
  },
  async ({ instrumentId, unitPriceUsd, notes }) => {
    const { status, body } = await paidPost(`/counter/${instrumentId}`, {
      from: ME, unitPriceUsd, terms: { notes },
    });
    if (status === 200) {
      const t = body.thread.threadId;
      chains.set(t, [...(chains.get(t) ?? []), body.instrument]);
    }
    return { content: [{ type: "text", text: JSON.stringify({ status, ...body }, null, 2) }] };
  },
);

server.tool(
  "accept_offer",
  "Accept the counterparty's latest position ($0.001). Returns a signed agreement with settlement terms and the full chain. This does NOT move money — settlement happens separately on a rail named in settlementRails.",
  {
    instrumentId: z.string().describe("instrumentId of the LATEST instrument. Must not be your own."),
    settleWithinHours: z.number().optional(),
    notes: z.string().optional(),
  },
  async ({ instrumentId, settleWithinHours, notes }) => {
    const { status, body } = await paidPost(`/accept/${instrumentId}`, {
      from: ME, settleWithinHours, notes,
    });
    if (status === 200) chains.set(body.thread.threadId, body.chain);
    return { content: [{ type: "text", text: JSON.stringify({ status, ...body }, null, 2) }] };
  },
);

server.tool(
  "thread_state",
  "Read a negotiation thread and its chain check. Free. Use this after a `stale_instrument` error to find the current latest instrument.",
  { threadId: z.string() },
  async ({ threadId }) => {
    const res = await fetch(`${BASE}/threads/${threadId}`);
    const body = await res.json();
    if (body.thread) chains.set(threadId, body.thread.chain);
    // Summarise rather than dumping every instrument into context.
    const latest = body.thread?.chain?.at(-1)?.payload;
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: body.thread?.status,
          parties: body.thread?.parties,
          latest: latest && {
            instrumentId: latest.instrumentId, seq: latest.seq, type: latest.type,
            from: latest.from, fromSide: latest.fromSide,
            priceUsd: latest.priceUsd, unitPriceUsd: latest.unitPriceUsd,
            concession: latest.concession,
          },
          chainCheck: body.chainCheck,
        }, null, 2),
      }],
    };
  },
);

server.tool(
  "verify_chain",
  "Verify a stored negotiation chain end to end — every signature and every link. Free. Run this before acting on an agreement someone forwarded you.",
  { threadId: z.string() },
  async ({ threadId }) => {
    const chain = chains.get(threadId);
    if (!chain) return { content: [{ type: "text", text: `No chain held for ${threadId}. Call thread_state first.` }] };
    const res = await fetch(`${BASE}/verify-chain`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chain }),
    });
    return { content: [{ type: "text", text: JSON.stringify(await res.json(), null, 2) }] };
  },
);

await server.connect(new StdioServerTransport());
```

```bash
npm install @modelcontextprotocol/sdk x402-fetch viem zod tsx
```

## Wire it into Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "x402-negotiator": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/negotiator-mcp.ts"],
      "env": {
        "NEGOTIATOR_URL": "http://localhost:4045",
        "AGENT_ID": "agent:claude-1",
        "PRIVATE_KEY": "0x…wallet with Base Sepolia USDC…"
      }
    }
  }
}
```

Give the wallet a small, capped balance. Every move spends real (testnet) USDC — including refused moves, which is exactly the property that stops an agent from spamming a counterparty. At $0.001 a move, a ten-round negotiation is a cent.

## Prompting notes

- **Give the model a reserve price and tell it to keep it private.** Nothing in the protocol asks for it, and instruments record only the positions actually put on the table. A model that volunteers its walk-away number in `terms.notes` has negotiated against itself.
- **Have it read `concession.totalMoved` before `projectedSettleUsd`.** `{ "buyer": 90, "seller": 0 }` means the counterparty has not moved at all — more informative than any projection, and a good trigger to walk.
- **`projectedSettleUsd: null` is meaningful**, not missing data. It means the arithmetic doesn't support a projection yet. The `note` says why.
- **Treat 409s as data.** `not_your_turn` means wait, not retry — a retry costs another $0.001 and returns another rejection. On `stale_instrument`, call `thread_state` (free) to find the current latest instrument.
- **Say plainly that accepting does not pay.** The agreement is the instrument of record; the model should surface `settlement.instructions` and `settlement.settleBy` so a human knows what still has to happen.
- **Verify before trusting.** If a chain arrives from outside, run `verify_chain` before acting on it. A single edit breaks two links, so `valid: true` is a strong signal.
