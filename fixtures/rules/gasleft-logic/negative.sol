// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Relayer {
    event Relayed(address target);

    function relay(address target, bytes calldata data) external {
        (bool ok, ) = target.call(data);
        require(ok, "call failed");
        emit Relayed(target);
    }
}
