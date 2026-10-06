// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Router, LedgerHook, ViewHook, ReceiptFactory, Issuer} from "../src/Router.sol";

contract RouterTest {
    function test_notifyWritesNewSlot() public {
        new Router().notify(address(new LedgerHook()), 1);
    }

    function test_issueDeploysReceipt() public {
        new Issuer().issue(new ReceiptFactory());
    }

    function test_notifyViewHookControl() public {
        new Router().notify(address(new ViewHook()), 1);
    }
}
