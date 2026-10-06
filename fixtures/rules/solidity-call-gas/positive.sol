// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IHook { function onPayment(uint256) external; }

contract Router {
    function notify(address hook, uint256 amount) external {
        // ruleid: glamcheck.solidity-call-gas
        (bool ok, ) = hook.call{gas: 50000}(abi.encodeCall(IHook.onPayment, (amount)));
        // ruleid: glamcheck.solidity-call-gas
        (bool ok2, ) = hook.call{value: amount, gas: 30_000}("");
        // ruleid: glamcheck.solidity-call-gas
        IHook(hook).onPayment{gas: 100000}(amount);
        ok; ok2;
    }
}
