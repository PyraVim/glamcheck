// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Relayer {
    function relay(address target, bytes calldata data) external {
        // ruleid: glamcheck.gasleft-logic
        uint256 startGas = gasleft();
        // ruleid: glamcheck.gasleft-logic
        require(gasleft() >= 100_000, "not enough gas");
        (bool ok, ) = target.call(data);
        ok;
        // ruleid: glamcheck.gasleft-logic
        uint256 used = startGas - gasleft();
        (bool paid, ) = msg.sender.call{value: used * tx.gasprice}("");
        paid;
    }
}
