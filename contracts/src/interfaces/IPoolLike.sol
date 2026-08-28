// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The subset of Aave v3's real IPool that LiquidationShield and
/// AaveFlashProvider actually need. Deliberately not the full IPool --
/// only what's called, so MockPool's job (satisfying this for unit tests)
/// stays small and honest about what's actually exercised.
///
/// getReserveData's struct layout is Aave v3's real ReserveDataLegacy,
/// verified against the live deployed Pool at
/// 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2 on mainnet (block 25,855,209)
/// via `cast call` before being written here, not copied from a blog post --
/// same discipline as agent/src/reader/abis.ts's own header comment.
interface IPoolLike {
    struct ReserveConfigurationMap {
        uint256 data;
    }

    struct ReserveDataLegacy {
        ReserveConfigurationMap configuration;
        uint128 liquidityIndex;
        uint128 currentLiquidityRate;
        uint128 variableBorrowIndex;
        uint128 currentVariableBorrowRate;
        uint128 currentStableBorrowRate;
        uint40 lastUpdateTimestamp;
        uint16 id;
        address aTokenAddress;
        address stableDebtTokenAddress;
        address variableDebtTokenAddress;
        address interestRateStrategyAddress;
        uint128 accruedToTreasury;
        uint128 unbacked;
        uint128 isolationModeTotalDebt;
    }

    function getUserAccountData(address user)
        external
        view
        returns (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            uint256 availableBorrowsBase,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        );

    function getReserveData(address asset) external view returns (ReserveDataLegacy memory);

    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;

    function withdraw(address asset, uint256 amount, address to) external returns (uint256);

    function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf)
        external
        returns (uint256);

    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
}
