// Runs the glamcheck semgrep rules over one or more paths and returns structured hits.
// usage: npx tsx src/rules/semgrep.ts <path> [<path> ...]
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT } from "../config.ts";

export const RULES_DIR = join(ROOT, "src/rules");

export interface Hit { rule: string; path: string; line: number; endLine: number; pattern: number; eip: string; severityHint: string; fixHint: string; message: string }

export function runSemgrep(targets: string[]): { hits: Hit[]; errors: unknown[]; command: string; exitCode: number | null } {
  const args = ["scan", "--metrics=off", "--quiet", "--json", "--config", RULES_DIR, ...targets];
  // semgrep exits non-zero on partial parse errors; the JSON is still complete, so read it regardless.
  const r = spawnSync("semgrep", args, { encoding: "utf8", maxBuffer: 256 << 20, env: { ...process.env, SEMGREP_ENABLE_VERSION_CHECK: "0" } });
  let json: any;
  try { json = JSON.parse(r.stdout); } catch { throw new Error(`semgrep produced no JSON (exit ${r.status}): ${(r.stderr ?? "").slice(0, 500)}`); }
  const hits: Hit[] = json.results.map((x: any) => ({
    rule: x.check_id.replace(/^.*?(glamcheck\.)/, "$1"),
    path: x.path,
    line: x.start.line,
    endLine: x.end.line,
    pattern: x.extra.metadata?.glamcheck_pattern,
    eip: x.extra.metadata?.eip,
    severityHint: x.extra.metadata?.severity_hint,
    fixHint: x.extra.metadata?.fix_hint,
    message: x.extra.message,
  }));
  return { hits, errors: json.errors, command: `semgrep ${args.join(" ")}`, exitCode: r.status };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const targets = process.argv.slice(2);
  if (!targets.length) { console.error("usage: npx tsx src/rules/semgrep.ts <path> [<path> ...]"); process.exit(2); }
  const r = runSemgrep(targets);
  for (const h of r.hits) console.log(`${h.path}:${h.line}  ${h.rule}  [${h.eip}, ${h.severityHint}]\n  fix: ${h.fixHint}`);
  console.log(`${r.hits.length} hits`);
}
