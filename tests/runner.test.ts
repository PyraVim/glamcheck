// The Amsterdam test diff finds tests that pass today and run out of gas under Amsterdam rules.
// Needs forge >= 1.8.3 on PATH (or FOUNDRY_BIN).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../src/config.ts";
import { diff } from "../src/runner/diff.ts";

const copy = (name: string) => {
  const dir = join(mkdtempSync(join(tmpdir(), "glamcheck-")), name);
  cpSync(join(ROOT, "fixtures/runner", name), dir, { recursive: true });
  return dir;
};

test("hardcoded call gas to a state-writing callee passes today and fails under amsterdam", { timeout: 600_000 }, () => {
  const r = diff(copy("call-gas-flip"));
  const row = (t: string) => r.rows.find((x) => x.test.startsWith(t))!;
  assert.equal(row("test_notifyWritesNewSlot").flipped, true);
  assert.equal(row("test_issueDeploysReceipt").flipped, true);
  assert.equal(row("test_notifyViewHookControl").flipped, false, "read-only control must not flip");
  assert.equal(r.flips.length, 2);
  for (const f of r.flips) assert.equal(f.confirmed, true);
  assert.deepEqual(r.flips.map((f) => f.outOfGasFrames[0].gasLimit).sort((a, b) => a - b), [60000, 150000]);
});

test(".transfer() to receivers that fit in 2,300 today does not flip (measured on forge 1.8.3)", { timeout: 600_000 }, () => {
  const r = diff(copy("stipend-flip"));
  assert.equal(r.rows.length, 3);
  assert.deepEqual(r.flips, []);
});
