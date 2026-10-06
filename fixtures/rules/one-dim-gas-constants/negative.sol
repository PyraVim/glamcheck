// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Paymaster {
    uint256 private constant MAX_SUPPLY = 1000000;
    uint256 public constant POST_OP_GAS_SLACK = 1234;
    uint256 public constant DECIMALS = 18;
}
