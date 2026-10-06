// 3b: replay a mined tx under current rules and under Amsterdam rules, measure the gas it would need,
// and write a finding with the verbatim commands and their output.
//
// usage: npx tsx src/replay/replay.ts [--chain sepolia] <txhash> [<txhash> ...]
//
// For a PRE-fork tx: does it still fit under Amsterdam rules, and how much gas would it need. Note: Foundry 1.8.3
// does not know Sepolia's Amsterdam activation, so replaying a POST-fork tx without --evm-version amsterdam
// silently uses the old rules; for post-fork failures, use the node's debug_traceTransaction instead.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, toHex, type Hash, type PublicClient } from "viem";
import { AMSTERDAM, OUT_DIR, RPC, foundryTool } from "../config.ts";
import { startShim, type Shim } from "./rpc-shim.ts";


// Local shim and anvil must never go through the sandbox HTTP proxy (this process uses it via NODE_USE_ENV_PROXY).
for (const k of ["NO_PROXY", "no_proxy"]) process.env[k] = [process.env[k], "127.0.0.1", "localhost"].filter(Boolean).join(",");
const FINDINGS = OUT_DIR;
const QUICK_NOTE = "cast run --quick executes on the parent block's state; earlier txs in the same block are not applied first.";

export interface RunResult {
  command: string;      // exactly what ran (against the local shim)
  reproduce: string;    // same command against the public endpoint, for the finding
  exitCode: number | null;
  secs: number;
  success: boolean;
  gasUsed: number | null;
  error: string | null;
  outputHead: string[]; // first 20 lines
  outputTail: string[]; // last 12 lines (result and error live here)
}

function toolEnv(): NodeJS.ProcessEnv {
  return { ...process.env };
}

function exec(bin: string, args: string[], timeoutMs: number): Promise<{ code: number | null; out: string; secs: number }> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(bin, args, { env: toolEnv(), stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out: out.replace(/\x1b\[[0-9;]*m/g, ""), secs: +((Date.now() - t0) / 1000).toFixed(1) });
    });
  });
}

// Pull the most specific failure reason out of a cast trace.
export function failureReason(out: string): string | null {
  const lines = out.split("\n");
  const evm = lines.find((l) => /\[(OutOfGas|OutOfFunds|CreateCollision|CreateContractSizeLimit|InvalidFEOpcode|StackOverflow)\]|EvmError|OutOfGas|out of gas|intrinsic gas/i.test(l));
  const err = lines.find((l) => /^Error:/.test(l.trim()));
  return [evm?.trim(), err?.trim()].filter(Boolean).join(" | ") || null;
}

// evm: null replays under the chain's own rules for that block; "amsterdam" forces Amsterdam rules (with the
// EIP-7825 per-tx cap); any other value (for example "osaka", pre-Glamsterdam) forces that spec.
// Where the pre-tx state comes from:
//   quick:    the parent block's state (fast; ignores earlier txs in the same block)
//   prestate: the node's prestateTracer for this exact tx (fast and exact; needs the debug_ namespace)
//   full:     re-execute every earlier tx in the block (exact, but thousands of RPC reads on busy blocks)
export type ReplayMode = "quick" | "prestate" | "full";

export async function castRun(tx: Hash, rpc: string, publicRpc: string, evm: string | null, opts: { mode?: ReplayMode; timeoutMs?: number } = {}): Promise<RunResult> {
  const extra = evm === "amsterdam" ? [...AMSTERDAM.castRun, "--enable-tx-gas-limit"] : evm ? ["--evm-version", evm] : [];
  const mode = opts.mode ?? "quick";
  const modeArgs = mode === "quick" ? ["--quick"] : mode === "prestate" ? ["--prestate-tracer"] : [];
  const args = ["run", tx, ...modeArgs, "--rpc-timeout", "20", "--rpc-url", rpc, ...extra];
  const r = await exec(foundryTool("cast"), args, opts.timeoutMs ?? 240_000);
  const lines = r.out.split("\n").filter((l) => l.trim() !== "");
  const gas = r.out.match(/Gas used: (\d+)/);
  const success = /Transaction successfully executed/.test(r.out);
  return {
    command: `cast ${args.join(" ")}`,
    reproduce: `cast ${args.join(" ").replace(rpc, publicRpc).replace("--rpc-timeout 20 ", "")}`,
    exitCode: r.code,
    secs: r.secs,
    success,
    gasUsed: gas ? Number(gas[1]) : null,
    error: success ? null : failureReason(r.out) ?? (r.code === null ? "timeout" : "unknown failure"),
    outputHead: lines.slice(0, 20),
    outputTail: lines.slice(-12),
  };
}

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });

// Fork the parent block under Amsterdam rules and measure the smallest gas limit at which the same tx,
// actually submitted by the impersonated sender, is accepted and succeeds. Each attempt runs from a
// snapshot of the parent state. eth_call and eth_estimateGas are not trusted for this: on anvil 1.8.3
// they skip intrinsic/state gas (21,000 for a transfer to an empty account; 24,000 for a CREATE).
export interface Attempt { kind: "ok" | "failed" | "rejected"; gasUsed: number | null; message: string | null }

export type ForkCall = { from: string; to: string | null; input: string; value: bigint; gasLimit: bigint };

export function neededGasUnderAmsterdam(rpc: string, publicRpc: string, block: bigint, call: ForkCall) {
  return measureOnFork(rpc, publicRpc, block - 1n, "amsterdam", call);
}

// Same measurement under any hardfork and fork point ("latest" for a call that was never mined).
export async function measureOnFork(rpc: string, publicRpc: string, forkBlock: bigint | "latest", hardfork: string, call: ForkCall) {
  const port = await freePort();
  const at = forkBlock === "latest" ? [] : ["--fork-block-number", String(forkBlock)];
  const args = ["--fork-url", rpc, ...at, "--hardfork", hardfork, "--accounts", "0", "--port", String(port),
    "--no-storage-caching", "--disable-block-gas-limit", "--silent"];
  const anvil = spawn(foundryTool("anvil"), args, { env: toolEnv(), stdio: "ignore" });
  const local = createPublicClient({ transport: http(`http://127.0.0.1:${port}`, { retryCount: 0, timeout: 120_000 }) });
  const req = (method: string, params: unknown[]) => local.request({ method: method as any, params: params as any }) as Promise<any>;
  let gasPrice = "0x0";
  const tx = (gas: bigint) => ({ from: call.from, ...(call.to ? { to: call.to } : {}), data: call.input, value: toHex(call.value), gas: toHex(gas), gasPrice });
  const reproduce = `anvil ${args.join(" ").replace(rpc, publicRpc)}; then cast rpc anvil_impersonateAccount ${call.from} and anvil_setBalance it to 1e24 wei, and send the same tx (${call.to ?? "create"}, value ${call.value}) with --gas-limit N --unlocked, bisecting N`;
  try {
    for (let i = 0; ; i++) {
      try { await local.getChainId(); break; } catch { if (i > 60) throw new Error("anvil did not start"); await new Promise((r) => setTimeout(r, 500)); }
    }
    await req("anvil_impersonateAccount", [call.from]);
    // Balance only pays for gas at the bisection's high limits; it does not change gas accounting.
    await req("anvil_setBalance", [call.from, toHex(10n ** 24n)]);
    gasPrice = toHex(BigInt(await req("eth_gasPrice", [])) * 2n + 1n);
    await req("anvil_setAutomine", [true]);
    let snap: string = await req("evm_snapshot", []);
    const attemptOnce = async (gas: bigint): Promise<Attempt> => {
      await req("evm_revert", [snap]);
      snap = await req("evm_snapshot", []);
      let hash: string;
      try {
        hash = await req("eth_sendTransaction", [tx(gas)]);
      } catch (e: any) {
        return { kind: "rejected", gasUsed: null, message: String(e?.details ?? e?.shortMessage ?? e?.message).split("\n")[0] };
      }
      let r: any = null;
      for (let i = 0; i < 20 && !r; i++) {
        r = await req("eth_getTransactionReceipt", [hash]);
        if (!r) await new Promise((res) => setTimeout(res, 100));
      }
      if (!r) return { kind: "failed", gasUsed: null, message: "not mined" };
      return { kind: r?.status === "0x1" ? "ok" : "failed", gasUsed: r ? Number(BigInt(r.gasUsed)) : null, message: r?.status === "0x1" ? null : "included, status 0" };
    };
    const attempt = async (gas: bigint) => {
      const a = await attemptOnce(gas);
      if (process.env.GLAM_DEBUG) console.error(`[needed] gas ${gas}: ${a.kind} ${a.gasUsed ?? ""} ${a.message ?? ""}`);
      return a;
    };

    const atOriginalLimit = await attempt(call.gasLimit);
    let lo = 21_000n, hi = call.gasLimit;
    if (atOriginalLimit.kind === "ok") hi = call.gasLimit;
    else {
      for (;;) {
        lo = hi;
        hi *= 2n;
        if (hi > 1_000_000_000n) throw new Error("no gas limit up to 1e9 succeeds under Amsterdam (fails for a reason other than gas)");
        if ((await attempt(hi)).kind === "ok") break;
      }
    }
    while (hi - lo > 1n) {
      const mid = (lo + hi) / 2n;
      if ((await attempt(mid)).kind === "ok") hi = mid;
      else lo = mid;
    }
    let estimateGas: number | null = null;
    try { estimateGas = Number(BigInt(await req("eth_estimateGas", [{ ...tx(call.gasLimit), gas: undefined }]))); } catch {}
    const errorAtOriginalLimit = atOriginalLimit.kind === "ok" ? null
      : atOriginalLimit.kind === "rejected" ? `rejected at submission: ${atOriginalLimit.message}`
      : `included and failed, gasUsed ${atOriginalLimit.gasUsed}`;
    return { gas: Number(hi), estimateGas, atOriginalLimit, error: null as string | null, errorAtOriginalLimit, reproduce };
  } catch (e: any) {
    return { gas: null, estimateGas: null, atOriginalLimit: null, error: String(e?.details ?? e?.shortMessage ?? e?.message).split("\n")[0], errorAtOriginalLimit: null, reproduce };
  } finally {
    anvil.kill("SIGKILL");
  }
}

export interface ReplayFinding {
  id: string;
  kind: "replay";
  chain: string;
  tx: Hash;
  block: number;
  from: string;
  to: string | null;
  selector: string;
  gasLimit: number;
  chainGasUsed: number;
  chainStatus: "success" | "failure";
  baseline: RunResult;
  amsterdam: RunResult;
  neededUnderAmsterdam: { gas: number | null; estimateGas: number | null; atOriginalLimit: Attempt | null; error: string | null; errorAtOriginalLimit: string | null; reproduce: string } | null;
  verdict: "breaks" | "tight" | "ok" | "inconclusive";
  confirmed: boolean;
  summary: string;
  notes: string[];
  createdAt: string;
}

export async function replayTx(chain: string, txHash: Hash, shim?: Shim): Promise<ReplayFinding> {
  if (chain !== "sepolia") throw new Error("only --chain sepolia is configured (set SEPOLIA_RPC)");
  const publicRpc = RPC.sepolia[0];
  const ownShim = shim ?? (await startShim(RPC.sepolia));
  try {
    const client = createPublicClient({ transport: http(ownShim.url) }) as PublicClient;
    const [tx, receipt] = await Promise.all([client.getTransaction({ hash: txHash }), client.getTransactionReceipt({ hash: txHash })]);
    const base = { from: tx.from.toLowerCase(), to: tx.to?.toLowerCase() ?? null, gasLimit: Number(tx.gas) };
    const selector = tx.to === null ? "create" : tx.input.length >= 10 ? tx.input.slice(0, 10) : tx.input;

    const [baseline, amsterdam] = await Promise.all([
      castRun(txHash, ownShim.url, publicRpc, null),
      castRun(txHash, ownShim.url, publicRpc, "amsterdam"),
    ]);
    const notes = [QUICK_NOTE];
    const chainGasUsed = Number(receipt.gasUsed);
    const chainOk = receipt.status === "success";
    const baselineFaithful = baseline.success === chainOk && (!chainOk || baseline.gasUsed === chainGasUsed);
    if (!baselineFaithful) notes.push(`baseline replay does not match the chain (chain: ${receipt.status}, ${chainGasUsed} gas; replay: ${baseline.success ? "success" : "failure"}, ${baseline.gasUsed} gas)`);

    let needed: ReplayFinding["neededUnderAmsterdam"] = null;
    if (!amsterdam.success || (amsterdam.gasUsed ?? 0) > base.gasLimit * 0.9) {
      needed = await neededGasUnderAmsterdam(ownShim.url, publicRpc, receipt.blockNumber, { from: tx.from, to: tx.to ?? null, input: tx.input, value: tx.value, gasLimit: tx.gas });
      notes.push("needed gas = smallest gas limit at which the same tx, submitted by the impersonated sender on an anvil --hardfork amsterdam fork of the parent block, is accepted and succeeds (bisection, snapshot per attempt). This is anvil behavior, not a production client.");
      if (needed.gas && needed.estimateGas !== null && needed.estimateGas < needed.gas) {
        notes.push(`eth_estimateGas on the same fork returned ${needed.estimateGas}, below the measured ${needed.gas}: estimates undercount here.`);
      }
    }

    let verdict: ReplayFinding["verdict"];
    if (!chainOk || !baselineFaithful) verdict = "inconclusive";
    else if (!amsterdam.success) verdict = "breaks";
    else if ((amsterdam.gasUsed ?? 0) > base.gasLimit * 0.9) verdict = "tight";
    else verdict = "ok";

    const fmt = (n: number | null) => (n === null ? "?" : n.toLocaleString("en-US"));
    const summary =
      verdict === "breaks"
        ? `Succeeds today (${fmt(chainGasUsed)} gas used of ${fmt(base.gasLimit)} limit); fails under Amsterdam (${needed?.errorAtOriginalLimit ?? amsterdam.error ?? "failure"})${needed?.gas ? `; needs ~${fmt(needed.gas)} gas under Amsterdam` : ""}.`
        : verdict === "tight"
          ? `Still succeeds under Amsterdam but uses ${fmt(amsterdam.gasUsed)} of its ${fmt(base.gasLimit)} limit.`
          : verdict === "ok"
            ? `Succeeds under Amsterdam: ${fmt(amsterdam.gasUsed)} gas vs ${fmt(chainGasUsed)} today, limit ${fmt(base.gasLimit)}.`
            : `Inconclusive: ${notes[notes.length - 1]}`;

    const finding: ReplayFinding = {
      id: `replay-${chain}-${txHash.slice(2, 12)}`,
      kind: "replay",
      chain,
      tx: txHash,
      block: Number(receipt.blockNumber),
      ...base,
      selector,
      chainGasUsed,
      chainStatus: chainOk ? "success" : "failure",
      baseline,
      amsterdam,
      neededUnderAmsterdam: needed,
      verdict,
      confirmed: verdict === "breaks", // set only from runs, never from reading code
      summary,
      notes,
      createdAt: new Date().toISOString(),
    };
    mkdirSync(FINDINGS, { recursive: true });
    writeFileSync(join(FINDINGS, `${finding.id}.json`), JSON.stringify(finding, null, 2) + "\n");
    return finding;
  } finally {
    if (!shim) await ownShim.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ options: { chain: { type: "string", default: "sepolia" } }, allowPositionals: true });
  for (const h of positionals) {
    const f = await replayTx(values.chain!, h as Hash);
    console.log(`${f.id}  ${f.verdict.toUpperCase()}  ${f.summary}`);
  }
}
