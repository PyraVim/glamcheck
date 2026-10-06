// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// Pays with .transfer(), which forwards a fixed 2,300 gas stipend.
contract Payout {
    function pay(address payable to) external payable {
        to.transfer(msg.value);
    }
}

// Reads one cold storage slot in its fallback: fits in 2,300 today.
contract ColdSloadReceiver {
    bool public paused;

    receive() external payable {
        require(!paused, "paused");
    }
}

// Emits an event in its fallback.
contract EventReceiver {
    event Paid(address from, uint256 amount);

    receive() external payable {
        emit Paid(msg.sender, msg.value);
    }
}

// Does nothing: control.
contract NoopReceiver {
    receive() external payable {}
}
