// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Escrow {
    function release(address payable payee, uint256 amount) external {
        // ruleid: glamcheck.solidity-transfer-send
        payee.transfer(amount);
    }

    function tryRelease(address payable payee, uint256 amount) external returns (bool) {
        // ruleid: glamcheck.solidity-transfer-send
        return payable(payee).send(amount);
    }
}
