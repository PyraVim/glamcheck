package payout

// ruleid: glamcheck.eth-send-21000
const transferGas = 21000

func send() {
	// ruleid: glamcheck.eth-send-21000
	tx := types.NewTransaction(nonce, to, amount, 21000, price, nil)
	// ruleid: glamcheck.eth-send-21000
	req := &transaction.TxRequest{To: &to, Value: amount, GasLimit: 21_000}
	_, _ = tx, req
}
