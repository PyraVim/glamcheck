#!/usr/bin/env bash
# Probe on a Glamsterdam network (default: the Platåberget devnet, Glamsterdam rules since genesis).
# Does a value transfer with gas limit 21,000 to an account that does not exist get rejected at submission
# (EIP-8037 text) or included and failed (EIP-2780 text)?
#
# Sends three tiny txs from your keystore account:
#   1. control: 21,000 gas to an existing account (your own address). Should succeed.
#   2. probe:   21,000 gas to a fresh address. The answer.
#   3. measure: node-estimated gas to another fresh address. What a new account really costs.
#
# Default is a dry run: checks the chain and recipients and prints the exact commands, sends nothing.
# Real run: bash scripts/probe-new-account.sh --send --account <your cast keystore account>
# cast prompts for the keystore password; the key never leaves the keystore. Use a throwaway testnet account.
set -euo pipefail

CAST="${FOUNDRY_BIN:+$FOUNDRY_BIN/}cast"
ACCOUNT="glam-throwaway"
SEND=0
VALUE_WEI=1000000000 # 1 gwei
RPC="${PLATABERGET_RPC:-https://rpc.plataberget.ethpandaops.io}"
EXPECTED_CHAIN="${EXPECTED_CHAIN:-7091047534}"

while (( $# )); do
  case "$1" in
    --send) SEND=1; shift ;;
    --dry-run) SEND=0; shift ;;
    --account) ACCOUNT=$2; shift 2 ;;
    --rpc) RPC=$2; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

LOG="${PROBE_LOG:-probe-new-account.log}"
say() { echo "$*" | tee -a "$LOG"; }
c() { "$CAST" "$@" --rpc-url "$RPC"; }

say "== probe-new-account $(date -u +%Y-%m-%dT%H:%M:%SZ) mode=$([[ $SEND == 1 ]] && echo send || echo dry-run) rpc=$RPC"
CHAIN=$(c chain-id)
say "chain id: $CHAIN"
[[ "$CHAIN" == "$EXPECTED_CHAIN" ]] || { say "ERROR: not Platåberget ($EXPECTED_CHAIN)"; exit 1; }

fresh() { echo "0x$(openssl rand -hex 20)"; }
empty() { # nonce 0, balance 0, no code
  [[ "$(c nonce "$1")" == "0" && "$(c balance "$1")" == "0" && "$(c code "$1")" == "0x" ]]
}
PROBE_TO=$(fresh)
MEASURE_TO=$(fresh)
for a in "$PROBE_TO" "$MEASURE_TO"; do
  empty "$a" || { say "ERROR: $a is not empty"; exit 1; }
done
say "fresh recipients (verified empty: nonce 0, balance 0, no code): probe=$PROBE_TO measure=$MEASURE_TO"

if (( ! SEND )); then
  say "DRY RUN. A real run sends:"
  say "  1. $CAST send --account $ACCOUNT --rpc-url $RPC --gas-limit 21000 --value $VALUE_WEI <your own address> --async"
  say "  2. $CAST send --account $ACCOUNT --rpc-url $RPC --gas-limit 21000 --value $VALUE_WEI $PROBE_TO --async"
  say "  3. $CAST send --account $ACCOUNT --rpc-url $RPC --value $VALUE_WEI $MEASURE_TO --async   (node estimates gas)"
  say "  then cast receipt for each hash."
  exit 0
fi

FROM=$("$CAST" wallet address --account "$ACCOUNT")
say "sender: $FROM, balance $(c balance "$FROM") wei"

# Returns "rejected: <error>" or "hash <0x..>". Never aborts the script.
send() {
  local out
  if out=$("$CAST" send --account "$ACCOUNT" --rpc-url "$RPC" "$@" --async 2>&1); then
    echo "hash $(echo "$out" | grep -oE '0x[0-9a-fA-F]{64}' | tail -1)"
  else
    echo "rejected: $(echo "$out" | tr '\n' ' ' | cut -c1-400)"
  fi
}
receipt() {
  local h=$1 r
  r=$(timeout 180 "$CAST" receipt "$h" --rpc-url "$RPC" --json 2>&1) || { echo "no receipt within 180s: $r"; return; }
  echo "$r" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log(`block ${parseInt(r.blockNumber)} status ${parseInt(r.status)} gasUsed ${parseInt(r.gasUsed)}`)})'
}
step() {
  local name=$1; shift
  say "-- $name: cast send $* --async"
  local res; res=$(send "$@")
  say "   submit: $res"
  if [[ "$res" == hash* ]]; then
    local h=${res#hash }
    say "   receipt: $(receipt "$h")"
  fi
}

step "1 control (existing account, 21000)" --gas-limit 21000 --value "$VALUE_WEI" "$FROM"
step "2 probe (fresh account, 21000)" --gas-limit 21000 --value "$VALUE_WEI" "$PROBE_TO"
say "   node estimate for a transfer to a fresh account: $(c estimate --from "$FROM" --value "$VALUE_WEI" "$MEASURE_TO" 2>&1 | tr '\n' ' ')"
step "3 measure (fresh account, node-estimated gas)" --value "$VALUE_WEI" "$MEASURE_TO"
say "== done. Log: $LOG"
