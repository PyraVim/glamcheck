package payout

const maxRetries = 21000

func send() {
	gas, _ := client.EstimateGas(ctx, ethereum.CallMsg{From: from, To: &to, Value: amount})
	tx := types.NewTransaction(nonce, to, amount, gas, price, nil)
	_ = tx
}
