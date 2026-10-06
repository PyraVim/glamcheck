export async function deploy(factory: any, wallet: any, client: any) {
  // ruleid: glamcheck.fixed-tx-gas-limit-js
  await factory.deploy(owner, { gasLimit: 175000 });
  // ruleid: glamcheck.fixed-tx-gas-limit-js
  await client.writeContract({ address, abi, functionName: "create", gas: 250_000n });
  // ruleid: glamcheck.fixed-tx-gas-limit-js
  await wallet.sendTransaction({ to, data, gasLimit: BigInt(400000) });
  // ruleid: glamcheck.fixed-tx-gas-limit-js
  await web3.eth.sendTransaction({ from, to, data, gas: "0x2ab98" });
}
export const networks = {
  // ruleid: glamcheck.fixed-tx-gas-limit-js
  sepolia: { url: process.env.RPC, gas: 2100000 },
};
