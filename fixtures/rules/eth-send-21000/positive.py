# ruleid: glamcheck.eth-send-21000-py
TRANSFER_GAS = 21000

def payout(w3, to, value):
    # ruleid: glamcheck.eth-send-21000-py
    tx = {"to": to, "value": value, "gas": 21000, "nonce": n, "chainId": 11155111}
    return tx
