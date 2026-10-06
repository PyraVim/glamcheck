// The semgrep rules flag every annotated positive line and nothing else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { ROOT } from "../src/config.ts";
import { runSemgrep } from "../src/rules/semgrep.ts";

const FIX = join(ROOT, "fixtures/rules");
const files = readdirSync(FIX).flatMap((d) => readdirSync(join(FIX, d)).map((f) => join(FIX, d, f)));
const run = runSemgrep([FIX]);
const rel = (p: string) => relative(ROOT, resolve(p));

// `ruleid: <id>` on a line means the next line must be flagged by <id>.
const expected = new Set<string>();
for (const f of files) {
  readFileSync(f, "utf8").split("\n").forEach((l, i) => {
    const m = l.match(/ruleid:\s*(glamcheck\.[\w.-]+)/);
    if (m) expected.add(`${relative(ROOT, f)}:${i + 2}:${m[1]}`);
  });
}

test("rules parse without errors", () => {
  assert.deepEqual(run.errors, []);
});

test("every positive line is flagged, nothing else is", () => {
  const got = new Set(run.hits.map((h) => `${rel(h.path)}:${h.line}:${h.rule}`));
  const missed = [...expected].filter((k) => !got.has(k));
  const extra = [...got].filter((k) => !expected.has(k));
  assert.deepEqual({ missed, extra }, { missed: [], extra: [] });
});

test("negative fixtures produce no hits", () => {
  assert.deepEqual(run.hits.filter((h) => /negative\./.test(h.path)), []);
});

test("all six patterns are covered and every hit carries EIP, severity and fix metadata", () => {
  assert.deepEqual([...new Set(run.hits.map((h) => h.pattern))].sort(), [1, 2, 3, 4, 5, 6]);
  for (const h of run.hits) assert.ok(h.eip && h.severityHint && h.fixHint, `${h.rule} lacks metadata`);
});
