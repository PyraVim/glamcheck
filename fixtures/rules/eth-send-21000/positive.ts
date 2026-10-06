// ruleid: glamcheck.eth-send-21000-js
const TRANSFER_GAS = 21000n;
export async function payout(wallet: any, to: string, value: bigint) {
  // ruleid: glamcheck.eth-send-21000-js
  await wallet.sendTransaction({ to, value, gasLimit: 21000 });
  // ruleid: glamcheck.eth-send-21000-js
  await client.sendTransaction({ account, to, value, gas: 21_000n });
  // ruleid: glamcheck.eth-send-21000-js
  await provider.send("eth_sendTransaction", [{ from, to, value, gas: "0x5208" }]);
}
