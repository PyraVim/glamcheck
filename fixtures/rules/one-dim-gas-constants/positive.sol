// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Paymaster {
    // ruleid: glamcheck.one-dim-gas-constant
    uint256 private constant POST_OP_GAS = 35000;
    // ruleid: glamcheck.one-dim-gas-constant
    uint256 public constant L1_GAS_OVERHEAD = 188_000;
}
