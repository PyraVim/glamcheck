export async function deploy(factory: any, client: any) {
  const gas = await client.estimateGas({ account, to, data });
  await client.writeContract({ address, abi, functionName: "create", gas: (gas * 12n) / 10n });
  await factory.deploy(owner, { gasLimit: estimated });
  await factory.deploy(owner);
  const zeroed = { gas: 0 };
}
