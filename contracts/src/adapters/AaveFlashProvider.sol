// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IFlashProvider} from "../interfaces/IFlashProvider.sol";
import {MockPool} from "../mocks/MockPool.sol";

contract AaveFlashProvider is IFlashProvider {
    address public immutable POOL;

    constructor(address _pool) {
        POOL = _pool;
    }

    function flashLoanSimple(
        address receiver,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external override {
        // Call the mock pool's flashLoanSimple
        MockPool(POOL).flashLoanSimple(receiver, asset, amount, params, referralCode);
    }
}
