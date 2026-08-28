// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolLike} from "../interfaces/IPoolLike.sol";

/// @notice Translates "give me the aToken / current debt for asset X" into
/// what real Aave v3 actually exposes: both live on the same
/// getReserveData(asset) struct, not as direct pool methods (there is no
/// pool.aTokenFor() or pool.userDebt() on the real IPool -- see
/// contracts/test/LiquidationShieldFork.t.sol for why that mismatch used to
/// make LiquidationShield.sol fail to compile against anything but the mock).
library AaveAdapter {
    function aTokenOf(IPoolLike pool, address asset) internal view returns (address) {
        return pool.getReserveData(asset).aTokenAddress;
    }

    /// @dev Variable debt tokens are non-transferable ERC20-shaped balances
    /// that track a user's accrued debt 1:1 -- this is the standard Aave
    /// pattern for reading "how much does user X currently owe in asset Y",
    /// there being no pool.userDebt(user, asset) on the real IPool.
    function debtOf(IPoolLike pool, address asset, address user) internal view returns (uint256) {
        address debtToken = pool.getReserveData(asset).variableDebtTokenAddress;
        return IERC20(debtToken).balanceOf(user);
    }
}
