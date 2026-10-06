BATCH = 21000

def payout(w3, to, value):
    tx = {"to": to, "value": value, "nonce": n}
    tx["gas"] = w3.eth.estimate_gas(tx)
    return tx
