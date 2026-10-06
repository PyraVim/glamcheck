const PAGE_SIZE = 21000;
export async function payout(wallet: any, to: string, value: bigint) {
  await wallet.sendTransaction({ to, value });
  const gas = await client.estimateGas({ account, to, value });
  await client.sendTransaction({ account, to, value, gas });
}
