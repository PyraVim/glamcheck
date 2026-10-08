import assert from "node:assert/strict";
import { test } from "node:test";
import { annotation, flipAnnotation, sarif, shouldFail, summary } from "../src/action/run.ts";
import type { Hit } from "../src/rules/semgrep.ts";

const hit: Hit = {
  rule: "glamcheck.eth-send-21000", path: "/repo/src/payout.ts", line: 12, endLine: 12, pattern: 2, eip: "EIP-8037",
  severityHint: "high", fixHint: "Estimate gas per transfer", message: "ETH send with a fixed 21,000 gas limit, 100% done",
};

test("annotation points at the file relative to the workspace and escapes the message", () => {
  const a = annotation(hit, "/repo");
  assert.match(a, /^::warning file=src\/payout\.ts,line=12,endLine=12,title=glamcheck\.eth-send-21000 \(EIP-8037\)::/);
  assert.match(a, /100%25 done%0AFix: Estimate gas per transfer$/);
});

test("flip annotation is an error with gas and cause", () => {
  const a = flipAnnotation({ suite: "test/Pay.t.sol:PayTest", test: "test_payNew()", gasBefore: 45000, gasAfter: null, cause: "CALL ran out of gas", confirmed: true });
  assert.match(a, /^::error title=Fails under Amsterdam%3A test_payNew\(\)::/);
  assert.match(a, /gas 45000/);
});

test("fail-on modes", () => {
  assert.equal(shouldFail("flips", 3, 0), false);
  assert.equal(shouldFail("flips", 0, 1), true);
  assert.equal(shouldFail("hits", 1, 0), true);
  assert.equal(shouldFail("hits", 0, 0), false);
  assert.equal(shouldFail("none", 9, 9), false);
});

test("sarif has one rule per rule id and relative locations", () => {
  const s = sarif([hit, { ...hit, line: 40, endLine: 41 }], "/repo");
  assert.equal(s.version, "2.1.0");
  assert.equal(s.runs[0].tool.driver.rules.length, 1);
  assert.equal(s.runs[0].results.length, 2);
  assert.equal(s.runs[0].results[1].locations[0].physicalLocation.artifactLocation.uri, "src/payout.ts");
});

test("summary says when the diff did not run", () => {
  assert.match(summary([hit], [], false, "/repo"), /Foundry diff: not run/);
  assert.match(summary([], [], true, "/repo"), /fail under Amsterdam: \*\*0\*\*/);
});
