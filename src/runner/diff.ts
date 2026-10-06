// Runs a Foundry suite under today's rules and under Amsterdam execution rules (forge test --hardfork amsterdam:
// runtime only, the compile target does not change), lists tests that pass today and fail under Amsterdam,
// and traces each one to find the frame that ran out of gas.
//
// usage: npx tsx src/runner/diff.ts <path-to-foundry-project> [-- <extra forge test args>]
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AMSTERDAM, OUT_DIR, foundryTool } from "../config.ts";

export interface TestResult { suite: string; test: string; status: string; reason: string | null; gas: number | null }

export function forgeTest(dir: string, args: string[], timeoutMs = 900_000) {
  const r = spawnSync(foundryTool("forge"), ["test", "--json", ...args], {
    cwd: dir, encoding: "utf8", maxBuffer: 512 << 20, timeout: timeoutMs,
    env: { ...process.env, FOUNDRY_FFI: "false" },
  });
  let json: any = {};
  try { json = JSON.parse(r.stdout || "{}"); } catch {}
  return { command: `FOUNDRY_FFI=false forge test --json ${args.join(" ")}`.trim(), exitCode: r.status, json, stderr: r.stderr ?? "" };
}

export function parseResults(json: any): TestResult[] {
  const out: TestResult[] = [];
  for (const [suite, s] of Object.entries<any>(json ?? {})) {
    for (const [test, r] of Object.entries<any>(s.test_results ?? {})) {
      const k = r.kind ?? {};
      out.push({ suite, test, status: r.status, reason: r.reason ?? null, gas: k.Unit?.gas ?? k.Fuzz?.median_gas ?? k.Fuzz?.mean_gas ?? null });
    }
  }
  return out;
}

export function outOfGasFrames(json: any) {
  const frames: any[] = [];
  const walk = (v: any) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      if (v.status === "OutOfGas") frames.push({ kind: v.kind, depth: v.depth, address: v.address, gasLimit: v.gas_limit, gasUsed: v.gas_used });
      Object.values(v).forEach(walk);
    }
  };
  walk(json);
  return frames;
}

export function diff(dir: string, extra: string[] = []) {
  const base = forgeTest(dir, extra);
  const ams = forgeTest(dir, [...AMSTERDAM.forgeRuntime, ...extra]);
  const after = new Map(parseResults(ams.json).map((r) => [`${r.suite}::${r.test}`, r]));
  const rows = parseResults(base.json).map((b) => {
    const a = after.get(`${b.suite}::${b.test}`);
    return { suite: b.suite, test: b.test, before: b.status, after: a?.status ?? "missing", gasBefore: b.gas, gasAfter: a?.gas ?? null, reasonAfter: a?.reason ?? null, flipped: b.status === "Success" && a?.status === "Failure" };
  });
  const flips = rows.filter((r) => r.flipped).map((row) => {
    const contract = row.suite.split(":").pop()!;
    const name = row.test.replace(/\(.*$/, "");
    const tr = forgeTest(dir, [...AMSTERDAM.forgeRuntime, ...extra, "--match-contract", `^${contract}$`, "--match-test", `^${name}\\(`, "-vvvv"]);
    const frames = outOfGasFrames(tr.json);
    const oog = frames[0];
    return {
      ...row, traceCommand: tr.command, outOfGasFrames: frames,
      cause: oog ? `${oog.kind} at depth ${oog.depth} to ${oog.address} ran out of gas (${oog.gasUsed} of ${oog.gasLimit} forwarded)` : `fails with "${row.reasonAfter}" (no out-of-gas frame found)`,
      confirmed: !!oog || /out of gas|OutOfGas|intrinsic gas/i.test(row.reasonAfter ?? ""),
    };
  });
  return { dir, baselineCommand: base.command, amsterdamCommand: ams.command, rows, flips };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dir, ...rest] = process.argv.slice(2);
  if (!dir) { console.error("usage: npx tsx src/runner/diff.ts <path-to-foundry-project> [-- forge args]"); process.exit(2); }
  const r = diff(resolve(dir), rest[0] === "--" ? rest.slice(1) : rest);
  for (const row of r.rows) console.log(`${row.flipped ? "FLIP" : "    "} ${row.before.padEnd(8)} -> ${row.after.padEnd(8)} ${String(row.gasBefore).padStart(9)} -> ${String(row.gasAfter ?? "").padStart(9)}  ${row.suite.split(":").pop()}.${row.test}`);
  for (const f of r.flips) console.log(`${f.confirmed ? "CONFIRMED" : "CHECK"} ${f.test}: ${f.cause}`);
  mkdirSync(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, `diff-${basename(resolve(dir))}.json`);
  writeFileSync(file, JSON.stringify(r, null, 2) + "\n");
  console.log(`results: ${file}`);
}
