// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 { function transfer(address to, uint256 amount) external returns (bool); }

contract Escrow {
    function release(address payable payee, uint256 amount) external {
        (bool ok, ) = payee.call{value: amount}("");
        require(ok, "send failed");
    }

    function releaseToken(IERC20 token, address to, uint256 amount) external {
        token.transfer(to, amount);
    }
}
