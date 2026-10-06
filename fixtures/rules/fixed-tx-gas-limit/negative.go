package chequebook

func deploy() {
	request := &transaction.TxRequest{To: &factory, Data: callData, GasLimit: 0}
	est, _ := client.EstimateGas(ctx, msg)
	opts.GasLimit = est * 12 / 10
	other := &Config{Gas: 50000}
	_, _ = request, other
}
