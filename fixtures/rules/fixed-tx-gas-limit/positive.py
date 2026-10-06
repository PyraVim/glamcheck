def deploy(w3, contract):
    # ruleid: glamcheck.fixed-tx-gas-limit-py
    tx = contract.constructor().build_transaction({"from": acct, "gas": 3000000, "nonce": n})
    # ruleid: glamcheck.fixed-tx-gas-limit-py
    contract.functions.create().transact({'from': acct, 'gas': 175000})
    return tx
