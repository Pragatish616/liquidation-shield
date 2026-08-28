// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IFlashProvider} from "../interfaces/IFlashProvider.sol";
import {IPoolLike} from "../interfaces/IPoolLike.sol";
import {IPriceOracleLike} from "../interfaces/IPriceOracleLike.sol";
import {MockERC20} from "./MockERC20.sol";
import {MockAToken} from "./MockAToken.sol";

interface IERC20MetadataLike {
    function decimals() external view returns (uint8);
}

contract MockPool is IFlashProvider, IPoolLike, IPriceOracleLike {
    // State
    mapping(address => mapping(address => uint256)) public userCollateral; // user -> asset -> amount
    mapping(address => mapping(address => uint256)) public userDebt; // user -> asset -> amount
    mapping(address => address) public aTokenFor; // underlying -> aToken
    mapping(address => address) public underlyingFor; // aToken -> underlying
    mapping(address => address) public debtTokenFor; // underlying -> mock variable debt token

    address[] public assets;

    // Mock prices (USD 8 decimals)
    mapping(address => uint256) public assetPriceUsd;
    mapping(address => uint256) public liquidationThresholdBps; // e.g. 8250 = 82.5%

    // Flash loan tracking
    address public lastFlashReceiver;
    uint256 public lastFlashAmount;
    address public lastFlashAsset;
    bytes public lastFlashParams;

    // Constants
    uint256 constant HF_SCALE = 1e18;
    uint256 constant FLASHLOAN_PREMIUM_BPS = 5; // 0.05% in bips (5/10000)

    event MockSupply(address indexed user, address asset, uint256 amount);
    event MockWithdraw(address indexed user, address asset, uint256 amount);
    event MockBorrow(address indexed user, address asset, uint256 amount);
    event MockRepay(address indexed user, address asset, uint256 amount);
    event FlashLoanExecuted(address indexed receiver, address asset, uint256 amount);

    constructor() {
        // Default prices
        assetPriceUsd[address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2)] = 3000 * 1e8; // WETH
        assetPriceUsd[address(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48)] = 1 * 1e8; // USDC

        liquidationThresholdBps[address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2)] = 8250; // 82.5%
        liquidationThresholdBps[address(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48)] = 8600; // 86%
    }

    // ===== Pool Interface =====

    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external override {
        userCollateral[onBehalfOf][asset] += amount;
        MockERC20(asset).transferFrom(msg.sender, address(this), amount);
        _addAssetIfMissing(asset);
        emit MockSupply(onBehalfOf, asset, amount);
    }

    function withdraw(address asset, uint256 amount, address to) external override returns (uint256) {
        address aToken = aTokenFor[asset];
        if (aToken != address(0) && MockERC20(aToken).balanceOf(msg.sender) >= amount) {
            MockERC20(aToken).burn(msg.sender, amount);
            if (MockERC20(asset).balanceOf(address(this)) < amount) {
                MockERC20(asset).mint(address(this), amount);
            }
            MockERC20(asset).transfer(to, amount);
        } else {
            require(userCollateral[msg.sender][asset] >= amount, "Insufficient collateral");
            userCollateral[msg.sender][asset] -= amount;
            MockERC20(asset).transfer(to, amount);
        }
        emit MockWithdraw(to, asset, amount);
        return amount;
    }

    function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)
        external
    {
        userDebt[onBehalfOf][asset] += amount;
        MockERC20(asset).transfer(onBehalfOf, amount);
        _addAssetIfMissing(asset);
        emit MockBorrow(onBehalfOf, asset, amount);
    }

    function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf)
        external
        override
        returns (uint256)
    {
        uint256 actualRepay = amount == type(uint256).max ? userDebt[onBehalfOf][asset] : amount;
        require(userDebt[onBehalfOf][asset] >= actualRepay, "Repay exceeds debt");
        userDebt[onBehalfOf][asset] -= actualRepay;
        MockERC20(asset).transferFrom(msg.sender, address(this), actualRepay);
        emit MockRepay(onBehalfOf, asset, actualRepay);
        return actualRepay;
    }

    function getUserAccountData(address user)
        external
        view
        override
        returns (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            uint256 availableBorrowsBase,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        )
    {
        uint256 totalAdjustedColUsd = 0;

        for (uint256 i = 0; i < assets.length; i++) {
            address asset = assets[i];
            uint256 price = assetPriceUsd[asset];
            if (price == 0) continue;

            uint8 dec = IERC20MetadataLike(asset).decimals();
            uint256 cAmt = userCollateral[user][asset];
            if (cAmt > 0) {
                uint256 cUsd = (cAmt * price) / (10 ** dec);
                totalCollateralBase += cUsd;

                uint256 lt = liquidationThresholdBps[asset];
                totalAdjustedColUsd += (cUsd * lt) / 10000;
            }

            uint256 dAmt = userDebt[user][asset];
            if (dAmt > 0) {
                uint256 dUsd = (dAmt * price) / (10 ** dec);
                totalDebtBase += dUsd;
            }
        }

        if (totalDebtBase == 0) {
            healthFactor = type(uint256).max;
        } else {
            healthFactor = (totalAdjustedColUsd * 1e18) / totalDebtBase;
        }

        return (totalCollateralBase, totalDebtBase, 0, 0, 0, healthFactor);
    }

    function FLASHLOAN_PREMIUM_TOTAL() external pure returns (uint256) {
        return FLASHLOAN_PREMIUM_BPS;
    }

    // ===== Flash Loan =====

    function flashLoanSimple(
        address receiver,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external override(IFlashProvider, IPoolLike) {
        lastFlashReceiver = receiver;
        lastFlashAmount = amount;
        lastFlashAsset = asset;
        lastFlashParams = params;

        // Give receiver the tokens
        MockERC20(asset).mint(receiver, amount);

        // Call callback
        IFlashLoanSimpleReceiver(receiver)
            .executeOperation(asset, amount, (amount * FLASHLOAN_PREMIUM_BPS) / 10000, msg.sender, params);

        // Receiver should have approved pool for amount + premium
        uint256 owed = amount + (amount * FLASHLOAN_PREMIUM_BPS) / 10000;
        MockERC20(asset).transferFrom(receiver, address(this), owed);

        emit FlashLoanExecuted(receiver, asset, amount);
    }

    // ===== Helpers for Testing =====

    function setUserPosition(
        address user,
        address collateralAsset,
        uint256 collateralAmt,
        address debtAsset,
        uint256 debtAmt
    ) external {
        userCollateral[user][collateralAsset] = collateralAmt;
        userDebt[user][debtAsset] = debtAmt;
        _addAssetIfMissing(collateralAsset);
        _addAssetIfMissing(debtAsset);
    }

    function setAssetPrice(address asset, uint256 priceUsd) external {
        assetPriceUsd[asset] = priceUsd;
    }

    function setLiquidationThreshold(address asset, uint256 thresholdBps) external {
        liquidationThresholdBps[asset] = thresholdBps;
    }

    function registerAToken(address underlying, address aToken) external {
        aTokenFor[underlying] = aToken;
        underlyingFor[aToken] = underlying;
        _addAssetIfMissing(underlying);
    }

    function registerDebtToken(address underlying, address debtToken) external {
        debtTokenFor[underlying] = debtToken;
    }

    // ===== IPoolLike / IPriceOracleLike =====

    // Only the two fields AaveAdapter actually reads (aTokenAddress,
    // variableDebtTokenAddress) are populated -- everything else in the
    // real struct (rates, indices, etc.) has no mock equivalent and nothing
    // here reads it.
    function getReserveData(address asset) external view override returns (ReserveDataLegacy memory data) {
        data.aTokenAddress = aTokenFor[asset];
        data.variableDebtTokenAddress = debtTokenFor[asset];
    }

    // MockPool doubles as its own price oracle for the mock/demo path --
    // real Aave splits this onto a separate AaveOracle contract (see
    // IPriceOracleLike), but the mock already tracks assetPriceUsd itself.
    function getAssetPrice(address asset) external view override returns (uint256) {
        return assetPriceUsd[asset];
    }

    function _addAssetIfMissing(address asset) internal {
        for (uint256 i = 0; i < assets.length; i++) {
            if (assets[i] == asset) return;
        }
        assets.push(asset);
    }
}

interface IFlashLoanSimpleReceiver {
    function executeOperation(address asset, uint256 amount, uint256 premium, address initiator, bytes calldata params)
        external;
}
