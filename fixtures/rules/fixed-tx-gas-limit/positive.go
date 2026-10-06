package chequebook

func deploy() {
	// ruleid: glamcheck.fixed-tx-gas-limit
	request := &transaction.TxRequest{To: &factory, Data: callData, GasPrice: price, GasLimit: 175000, Value: zero}
	// ruleid: glamcheck.fixed-tx-gas-limit
	opts.GasLimit = 90_000
	// ruleid: glamcheck.fixed-tx-gas-limit
	tx := types.NewContractCreation(nonce, amount, 3000000, price, code)
	// ruleid: glamcheck.fixed-tx-gas-limit
	dyn := &types.DynamicFeeTx{Nonce: nonce, Gas: 95000, To: &to}
	_, _, _ = request, tx, dyn
}
