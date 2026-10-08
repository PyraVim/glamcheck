// GitHub Action entry point: runs the static rules and (optionally) the Foundry Amsterdam diff on the
// workspace, then writes annotations, a job summary, outputs, an optional SARIF file and the exit code.
// Inputs come from GLAMCHECK_* environment variables set by action.yml.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { OUT_DIR } from "../config.ts";
import { runSemgrep, type Hit } from "../rules/semgrep.ts";
import { diff } from "../runner/diff.ts";

export type FailOn = "flips" | "hits" | "none";
type Flip = { suite: string; test: string; gasBefore: number | null; gasAfter: number | null; cause: string; confirmed: boolean };

// Workflow commands need %, CR and LF escaped in the message, and also : and , in properties.
const escData = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escProp = (s: string) => escData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

export function annotation(h: Hit, root: string): string {
  const file = relative(root, resolve(root, h.path)) || h.path;
  const title = `${h.rule} (${h.eip})`;
  return `::warning file=${escProp(file)},line=${h.line},endLine=${h.endLine},title=${escProp(title)}::${escData(`${h.message}\nFix: ${h.fixHint}`)}`;
}

export function flipAnnotation(f: Flip): string {
  return `::error title=${escProp(`Fails under Amsterdam: ${f.test}`)}::${escData(`${f.suite} ${f.test} passes today (gas ${f.gasBefore ?? "?"}) and fails under Amsterdam rules. ${f.cause}`)}`;
}

export function shouldFail(failOn: FailOn, hits: number, flips: number): boolean {
  if (failOn === "none") return false;
  if (failOn === "hits") return hits > 0 || flips > 0;
  return flips > 0;
}

export function sarif(hits: Hit[], root: string) {
  const rules = [...new Map(hits.map((h) => [h.rule, h])).values()].map((h) => ({
    id: h.rule, shortDescription: { text: h.rule }, fullDescription: { text: h.message }, help: { text: h.fixHint },
    properties: { eip: h.eip, severityHint: h.severityHint },
  }));
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [{
      tool: { driver: { name: "glamcheck", informationUri: "https://github.com/PyraVim/glamcheck", rules } },
      results: hits.map((h) => ({
        ruleId: h.rule, level: "warning", message: { text: `${h.message} Fix: ${h.fixHint}` },
        locations: [{ physicalLocation: { artifactLocation: { uri: relative(root, resolve(root, h.path)) || h.path }, region: { startLine: h.line, endLine: h.endLine } } }],
      })),
    }],
  };
}

export function summary(hits: Hit[], flips: Flip[], diffRan: boolean, root: string): string {
  const lines = ["## glamcheck (Glamsterdam gas repricing)", ""];
  lines.push(`Static hits: **${hits.length}**. These are candidates; confirm with the Foundry diff or a transaction replay before acting.`, "");
  if (hits.length) {
    lines.push("| file:line | rule | EIP | fix |", "|---|---|---|---|");
    for (const h of hits.slice(0, 100)) lines.push(`| ${relative(root, resolve(root, h.path)) || h.path}:${h.line} | ${h.rule} | ${h.eip} | ${h.fixHint.replace(/\|/g, "\\|")} |`);
    if (hits.length > 100) lines.push(`| ... ${hits.length - 100} more in the results file | | | |`);
    lines.push("");
  }
  if (diffRan) {
    lines.push(`Foundry tests that pass today and fail under Amsterdam: **${flips.length}**.`, "");
    if (flips.length) {
      lines.push("| test | gas today | gas under Amsterdam | cause |", "|---|---|---|---|");
      for (const f of flips) lines.push(`| ${f.suite.split(":").pop()}.${f.test} | ${f.gasBefore ?? ""} | ${f.gasAfter ?? ""} | ${f.cause.replace(/\|/g, "\\|")} |`);
      lines.push("");
    }
  } else lines.push("Foundry diff: not run (no foundry.toml, or foundry-diff is false).", "");
  return lines.join("\n");
}

async function main() {
  const root = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const target = resolve(root, process.env.GLAMCHECK_PATH ?? ".");
  const failOn = (process.env.GLAMCHECK_FAIL_ON ?? "flips") as FailOn;
  if (!["flips", "hits", "none"].includes(failOn)) throw new Error(`fail-on must be flips, hits or none, not "${failOn}"`);

  const scan = runSemgrep([target]);
  for (const h of scan.hits) console.log(annotation(h, root));

  let flips: Flip[] = [];
  let diffResult: unknown = null;
  const diffRan = process.env.GLAMCHECK_DIFF === "true";
  if (diffRan) {
    const extra = (process.env.GLAMCHECK_FORGE_ARGS ?? "").split(/\s+/).filter(Boolean);
    const r = diff(target, extra);
    diffResult = r;
    flips = r.flips;
    for (const f of flips) console.log(flipAnnotation(f));
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const resultsFile = join(OUT_DIR, "glamcheck-results.json");
  writeFileSync(resultsFile, JSON.stringify({ target, semgrepCommand: scan.command, hits: scan.hits, semgrepErrors: scan.errors, diff: diffResult }, null, 2) + "\n");
  if (process.env.GLAMCHECK_SARIF) writeFileSync(resolve(root, process.env.GLAMCHECK_SARIF), JSON.stringify(sarif(scan.hits, root), null, 2) + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(scan.hits, flips, diffRan, root) + "\n");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `hits=${scan.hits.length}\nflips=${flips.length}\nresults-file=${resultsFile}\n`);

  console.log(`glamcheck: ${scan.hits.length} static hits, ${diffRan ? `${flips.length} Amsterdam flips` : "Foundry diff not run"}; results in ${resultsFile}`);
  if (shouldFail(failOn, scan.hits.length, flips.length)) process.exit(1);
}

if (process.argv[1]?.endsWith("run.ts")) {
  main().catch((e) => { console.log(`::error title=glamcheck::${escData(String(e?.message ?? e))}`); process.exit(2); });
}
