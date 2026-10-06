def deploy(w3, contract):
    gas = contract.constructor().estimate_gas({"from": acct})
    tx = contract.constructor().build_transaction({"from": acct, "gas": int(gas * 1.2)})
    return tx
