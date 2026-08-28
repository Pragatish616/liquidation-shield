// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The one AaveOracle function LiquidationShield needs. Price is
/// NOT a pool method on real Aave v3 -- it lives on a separate oracle
/// contract (PoolAddressesProvider.getPriceOracle()), which is why this is
/// its own interface rather than folded into IPoolLike.
interface IPriceOracleLike {
    function getAssetPrice(address asset) external view returns (uint256);
}
