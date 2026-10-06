// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Router {
    uint256 public hookGas;

    function notify(address hook, uint256 amount) external {
        (bool ok, ) = hook.call{value: amount}("");
        (bool ok2, ) = hook.call{gas: hookGas}("");
        ok; ok2;
    }
}
