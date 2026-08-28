// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IFlashProvider} from "../interfaces/IFlashProvider.sol";
import {IPoolLike} from "../interfaces/IPoolLike.sol";
import "../libraries/Errors.sol";

contract AaveFlashProvider is IFlashProvider {
    address public immutable POOL;
    address private immutable DEPLOYER;
    address public shield;

    constructor(address _pool) {
        POOL = _pool;
        DEPLOYER = msg.sender;
    }

    // LiquidationShield's constructor needs this adapter's address (to set its
    // own FLASH_PROVIDER immutable), so `shield` can't be set here without a
    // circular deploy dependency. Settable exactly once, by the deployer only,
    // gives the same effective guarantee as immutable once wiring is done.
    function setShield(address _shield) external {
        if (msg.sender != DEPLOYER) revert OnlyDeployer();
        if (shield != address(0)) revert ShieldAlreadySet();
        shield = _shield;
    }

    function flashLoanSimple(
        address receiver,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external override {
        if (msg.sender != shield) revert OnlyShield();
        IPoolLike(POOL).flashLoanSimple(receiver, asset, amount, params, referralCode);
    }
}
