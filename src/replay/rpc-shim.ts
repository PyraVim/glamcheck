// Local JSON-RPC shim in front of public endpoints, for cast and anvil.
// - Answers anvil_/hardhat_/evm_ probes immediately. Public endpoints let those hang until timeout,
//   which made each `cast run` take ~170s.
// - Fails over across the configured endpoints on network errors, 429 and 5xx.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// eth_getAccountInfo is a non-standard call anvil tries first; public nodes hang on it too.
const LOCAL_ONLY = /^((anvil|hardhat|evm)_|eth_getAccountInfo$)/;

interface RpcReq { id?: unknown; method?: string; jsonrpc?: string }

export interface Shim { url: string; close: () => Promise<void>; stats: { forwarded: number; shortCircuited: number; failovers: number } }

// Public endpoints stall (rather than 429) when a forked anvil fires dozens of parallel requests.
const MAX_IN_FLIGHT = 4;

export async function startShim(upstreams: string[]): Promise<Shim> {
  const stats = { forwarded: 0, shortCircuited: 0, failovers: 0 };
  let inFlight = 0;
  const waiting: (() => void)[] = [];
  const acquire = () => (inFlight < MAX_IN_FLIGHT ? (inFlight++, Promise.resolve()) : new Promise<void>((r) => waiting.push(() => (inFlight++, r()))));
  const release = () => { inFlight--; waiting.shift()?.(); };

  async function forward(body: string): Promise<{ status: number; text: string }> {
    await acquire();
    try {
      return await forwardNow(body);
    } finally {
      release();
    }
  }

  async function forwardNow(body: string): Promise<{ status: number; text: string }> {
    let last = "";
    for (let round = 0; round < 3; round++) {
      for (const u of upstreams) {
        try {
          const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(12_000) });
          if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
          stats.forwarded++;
          return { status: r.status, text: await r.text() };
        } catch (e: any) {
          last = `${u}: ${e.message}${e.cause?.code ? ` (${e.cause.code})` : ""}`;
          stats.failovers++;
          if (process.env.GLAM_DEBUG) console.error(`[shim] failover: ${last} :: ${body.slice(0, 160)}`);
        }
      }
      await new Promise((r) => setTimeout(r, 1000 * 2 ** round));
    }
    return { status: 502, text: JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: `all upstreams failed: ${last}` } }) };
  }

  const notFound = (req: RpcReq) => ({ jsonrpc: "2.0", id: req.id ?? null, error: { code: -32601, message: `method ${req.method} not supported` } });

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let parsed: RpcReq | RpcReq[];
      try { parsed = JSON.parse(raw); } catch { res.writeHead(400).end(); return; }
      const batch = Array.isArray(parsed) ? parsed : [parsed];
      const local = batch.filter((r) => LOCAL_ONLY.test(r.method ?? ""));
      let out: { status: number; text: string };
      if (local.length === batch.length) {
        stats.shortCircuited += local.length;
        const answers = batch.map(notFound);
        out = { status: 200, text: JSON.stringify(Array.isArray(parsed) ? answers : answers[0]) };
      } else if (local.length === 0) {
        out = await forward(raw);
      } else {
        // Mixed batch: forward the real calls, answer the probes locally, keep the order.
        stats.shortCircuited += local.length;
        const remote = batch.filter((r) => !LOCAL_ONLY.test(r.method ?? ""));
        const fwd = await forward(JSON.stringify(remote));
        const answers = JSON.parse(fwd.text) as { id?: unknown }[];
        const byId = new Map(answers.map((a) => [JSON.stringify(a.id), a]));
        out = { status: fwd.status, text: JSON.stringify(batch.map((r) => (LOCAL_ONLY.test(r.method ?? "") ? notFound(r) : byId.get(JSON.stringify(r.id))))) };
      }
      res.writeHead(out.status, { "content-type": "application/json" }).end(out.text);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, stats, close: () => new Promise((r) => server.close(() => r())) };
}
