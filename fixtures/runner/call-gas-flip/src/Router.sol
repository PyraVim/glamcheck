// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// Forwards a hardcoded 60,000 gas to a payment hook.
contract Router {
    function notify(address hook, uint256 amount) external {
        (bool ok, ) = hook.call{gas: 60_000}(abi.encodeWithSignature("onPayment(uint256)", amount));
        require(ok, "hook failed");
    }
}

// Records the first payment per payer: a write to a new storage slot.
contract LedgerHook {
    mapping(address => uint256) public paid;

    function onPayment(uint256 amount) external {
        paid[msg.sender] += amount;
    }
}

// Deploys a small receipt contract per payment with a hardcoded 150,000 gas forward.
contract ReceiptFactory {
    function issue() external returns (address r) {
        r = address(new Receipt{salt: bytes32(uint256(1))}());
    }
}

contract Receipt {
    uint256 public issuedAt = 1;
}

contract Issuer {
    function issue(ReceiptFactory f) external {
        (bool ok, ) = address(f).call{gas: 150_000}(abi.encodeCall(ReceiptFactory.issue, ()));
        require(ok, "issue failed");
    }
}

// Control: the hook only reads.
contract ViewHook {
    uint256 public limit = 10;

    function onPayment(uint256 amount) external view {
        require(amount <= limit, "too much");
    }
}
