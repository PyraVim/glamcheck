# glamcheck

Find and prove code that breaks under Ethereum's Glamsterdam gas repricing (EIP-8037, EIP-8038, EIP-2780). Static rules find the call sites; a Foundry test diff and a transaction replay show whether they actually fail, with the exact command and its output.

Glamsterdam went live on Sepolia on 2026-10-06 at 13:53:36 UTC. Mainnet is not scheduled yet.

## What Glamsterdam breaks (measured)

Every number below was measured, not taken from the EIP tables.

| what | measured | where |
|---|---|---|
| ETH transfer to an address that does not exist yet | uses 204,600 gas | real client, Platåberget devnet (Glamsterdam since genesis) |
| the same transfer sent with a 21,000 gas limit | included and fails (status 0): the sender pays the fee, the recipient gets nothing; it is not rejected at submission | real client, Platåberget devnet |
| ETH transfer to an existing account | 21,000 (unchanged) | Sepolia node, eth_estimateGas |
| zero-value transfer (existing or fresh address) | 15,000 | Sepolia node, eth_estimateGas |
| self-transfer | 12,000 | Sepolia node and Platåberget |
| each additional new storage slot written in a call | 110,026 gas in total | Sepolia node, eth_estimateGas |
| ERC-4337: first use of a nonce key (EntryPoint v0.7 nonce update) vs a reused key | 98,657 more (17,134 more before the fork) | Sepolia node, eth_estimateGas of `incrementNonce` |
| a 175,000-gas contract deployment that used 141,905 before the fork | estimates at 629,945 now | Sepolia node, eth_estimateGas |
| cold SLOAD / warm SLOAD / cold BALANCE | 2,100 / 100 / 3,000 | Sepolia node opcode trace; same on Foundry 1.8.3 |
| updating an existing storage slot (SSTORE, warm / cold) | 10,100 / 12,100 (was 2,900 / 5,000) | Sepolia node opcode trace |
| Sepolia, same-length windows before vs after the fork | tx failure rate 1.91% to 10.97%; txs that burned their whole gas limit 0.15% to 2.02% | all Sepolia transactions, the first 10.5 hours after the fork against the 10.5 hours before |

What tends to break:

1. Fixed gas limits on state-creating transactions: deployments, factory calls, first writes to new storage.
2. ETH sends with a fixed 21,000 gas limit to addresses that may not exist yet (faucets, payouts, airdrops).
3. ERC-4337 apps that hardcode `verificationGasLimit` and open a new nonce key per userOp: in EntryPoint v0.7 the first use of a key writes a new storage slot inside the verification gas window, and the op fails with `AA26 over verificationGasLimit`.
4. Hardcoded gas forwarded to calls (`{gas: N}`) whose callee writes new storage or deploys.
5. Fixed gas limits on calls that update existing storage: under EIP-8038 each update of an existing slot costs about 7,200 more (10,100 instead of 2,900 warm), so calls with many writes outgrow limits that fit before (DEX swaps, Bee redistribution, bond claims).
6. Token transfers sent with a fixed per-token gas limit: they fail when the recipient has never held the token, because the transfer writes a new balance slot (about 110,000 gas instead of 22,100). Transfers to existing holders still fit, so this only shows up for first-time recipients.

Not seen to break: `.transfer()`/`.send()` to receivers that fit inside the 2,300 stipend today. Cold SLOAD did not change, and no such case flipped in our runs. The rule for it is kept for review only.

## Tooling traps
- anvil's `eth_estimateGas` on an Amsterdam fork returned 21,000 for a transfer to a new account (which needs 204,600). Reported in https://github.com/foundry-rs/foundry/issues/17428 and fixed within a day in https://github.com/foundry-rs/foundry/pull/17432 (merged Oct 7): anvil now estimates transfers by executing them. Until your Foundry build includes the fix, check estimates against a real Glamsterdam node, or measure by submitting.
- `cast run` before Foundry 1.8.5 replays post-fork Sepolia transactions under the previous rules unless you pass `--evm-version amsterdam`. Fixed in 1.8.5.
- For a transaction that already failed on a Glamsterdam chain, the node's own `debug_traceTransaction` is the source of truth for where it ran out of gas.

## Requirements
- Foundry 1.8.5 or later (`forge test --hardfork amsterdam`, `cast run --evm-version amsterdam`). Set `FOUNDRY_BIN` if forge is not on PATH.
- semgrep Community Edition (the Solidity rules are tested with 1.177.0, the version the GitHub Action pins).
- Node 20 or later, then `npm install`.

## Check your own repo

1. Static scan (Solidity, TypeScript/JavaScript, Python, Go):
   ```
   npx tsx src/rules/semgrep.ts /path/to/your/repo
   ```
   Hits are candidates. Confirm them with step 2 or 3 before acting.

2. Foundry suite under Amsterdam execution rules (only the runtime changes; the compile target does not):
   ```
   npx tsx src/runner/diff.ts /path/to/your/foundry/project
   ```
   Lists tests that pass today and fail under Amsterdam, and traces each one to the call that ran out of gas. Runs with `FOUNDRY_FFI=false`.

3. Replay a mined pre-fork transaction under Amsterdam rules and measure the gas it would need:
   ```
   SEPOLIA_RPC=https://your-sepolia-rpc npx tsx src/replay/replay.ts 0x<txhash>
   ```
   Writes the commands and output to `glamcheck-out/`.

4. Settle the new-account question on a devnet yourself (sends three tiny transactions from a throwaway testnet keystore account; dry run by default):
   ```
   bash scripts/probe-new-account.sh                     # dry run
   bash scripts/probe-new-account.sh --send --account <keystore account>
   ```

Scanning or building someone else's repository runs their code: do it in a sandbox or VM, never on a machine with real keys.

## Run it in CI (GitHub Action)

```yaml
- uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
  with:
    submodules: recursive
- uses: PyraVim/glamcheck@v0.1.1
  with:
    fail-on: flips
```

What it does:
1. Runs the static rules on `path` and adds a warning annotation on each hit.
2. If `path` has a `foundry.toml` (or `foundry-diff: true`), runs your suite under today's rules and under Amsterdam execution rules (`forge test --hardfork amsterdam`), with `FOUNDRY_FFI=false`, and adds an error annotation for each test that flips.
3. Writes a job summary, `glamcheck-results.json`, and optionally SARIF for GitHub code scanning.

| input | default | meaning |
|---|---|---|
| `path` | `.` | directory to check |
| `foundry-diff` | `auto` | `auto` runs the diff when `foundry.toml` exists; `true` or `false` to force |
| `forge-args` | | extra `forge test` arguments |
| `fail-on` | `flips` | `flips`, `hits` (any static hit or flip) or `none` |
| `sarif-file` | | write SARIF here (upload with `github/codeql-action/upload-sarif`) |
| `foundry-version` | `v1.8.5` | needs 1.8.5 or later |
| `semgrep-version` | `1.177.0` | |

Outputs: `hits`, `flips`, `results-file`. A full example workflow, with the SARIF upload, is in `docs/example-workflow.yml`.

Static hits are candidates, not proof; the default `fail-on: flips` only fails the job on a measured flip. The Foundry diff runs your own tests in your own CI, with FFI off. Every third-party action this one uses is pinned to a commit.

## Rules

| rule | pattern | EIP |
|---|---|---|
| `glamcheck.fixed-tx-gas-limit` (Go, TS/JS, Python) | fixed gas limit on a transaction or network config | EIP-8037 |
| `glamcheck.eth-send-21000` (Go, TS/JS, Python) | exactly 21,000 gas for an ETH send | EIP-8037 / EIP-2780 |
| `glamcheck.solidity-call-gas` | hardcoded `{gas: N}` forwarded to a call | EIP-8037 / EIP-8038 |
| `glamcheck.gasleft-logic` | logic built on `gasleft()` | EIP-8037 |
| `glamcheck.one-dim-gas-constant` | round gas constants in fee or verification models | EIP-8037 |
| `glamcheck.solidity-transfer-send` | `.transfer()` / `.send()` (review only) | EIP-8038 |

Each rule has positive and negative fixtures in `fixtures/rules/`. `npm test` runs the rule tests and the Foundry diff tests.

## Upstream issues
- Foundry, anvil estimate for transfers to new accounts: https://github.com/foundry-rs/foundry/issues/17428 (fixed in https://github.com/foundry-rs/foundry/pull/17432, merged Oct 7)
- ethersphere/bee, fixed 175,000 chequebook deployment gas: https://github.com/ethersphere/bee/issues/5650
- pk910/PoWFaucet, example config `ethTxGasLimit: 21000`: https://github.com/pk910/PoWFaucet/issues/540
- wevm/viem, the default nonce key opens a new EntryPoint nonce slot on every userOp (Discussion): https://github.com/wevm/viem/discussions/5198
- ethersphere/bee, redistribution commit/reveal fall back to a 500,000 gas floor: https://github.com/ethersphere/bee/issues/5652
- succinctlabs/op-succinct, `claimCredit` sent with a fixed 200,000 gas limit: https://github.com/succinctlabs/op-succinct/issues/1016

## Contact
Need your code checked before mainnet? I do fixed-price Glamsterdam readiness checks: I find what breaks in your contracts, scripts and gas settings, measure it on a real node, and send the fix with tests.

- Email: pyravim.dev@gmail.com

## License
MIT, see LICENSE.
