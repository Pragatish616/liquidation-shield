// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockPool} from "./MockPool.sol";

/// @notice Minimal read-through proxy so MockPool.getReserveData can hand
/// out a variableDebtTokenAddress that behaves like real Aave's variable
/// debt tokens (an ERC20-shaped balanceOf tracking accrued debt) without
/// duplicating MockPool's own userDebt bookkeeping. Real variable debt
/// tokens are non-transferable, so only balanceOf is implemented -- nothing
/// in this codebase needs more than that (see AaveAdapter.debtOf).
contract MockDebtToken {
    MockPool public immutable POOL;
    address public immutable UNDERLYING;

    constructor(address pool, address underlying) {
        POOL = MockPool(pool);
        UNDERLYING = underlying;
    }

    function balanceOf(address user) external view returns (uint256) {
        return POOL.userDebt(user, UNDERLYING);
    }
}
