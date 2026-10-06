// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Payout, ColdSloadReceiver, EventReceiver, NoopReceiver} from "../src/Payout.sol";

contract PayoutTest {
    Payout payout;

    function setUp() public {
        payout = new Payout();
    }

    function test_payColdSloadReceiver() public {
        payout.pay{value: 1}(payable(address(new ColdSloadReceiver())));
    }

    function test_payEventReceiver() public {
        payout.pay{value: 1}(payable(address(new EventReceiver())));
    }

    function test_payNoopReceiver() public {
        payout.pay{value: 1}(payable(address(new NoopReceiver())));
    }

    receive() external payable {}
}
