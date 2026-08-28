// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IFlashProvider} from "./interfaces/IFlashProvider.sol";
import {ISwapper} from "./interfaces/ISwapper.sol";
import {IPolicyRegistry} from "./interfaces/IPolicyRegistry.sol";
import {IIntervention} from "./interfaces/IIntervention.sol";
import {MockPool} from "./mocks/MockPool.sol";
import {MockAToken} from "./mocks/MockAToken.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {HealthMath} from "./libraries/HealthMath.sol";
import "./libraries/Errors.sol";

interface IERC20Metadata {
    function decimals() external view returns (uint8);
}

contract LiquidationShield is ReentrancyGuard {
    IFlashProvider public immutable FLASH_PROVIDER;
    ISwapper public immutable SWAPPER;
    IPolicyRegistry public immutable POLICY_REGISTRY;
    MockPool public immutable POOL;

    constructor(
        address flashProvider,
        address swapper,
        address policyRegistry,
        address pool
    ) {
        FLASH_PROVIDER = IFlashProvider(flashProvider);
        SWAPPER = ISwapper(swapper);
        POLICY_REGISTRY = IPolicyRegistry(policyRegistry);
        POOL = MockPool(pool);
    }

    // ============ ENTRY POINT ============

    function executeIntervention(IIntervention.InterventionParams calldata params) external nonReentrant {
        // 1. Deadline check
        if (block.timestamp > params.deadline) revert Expired();

        // 2. Keeper authorization
        if (!POLICY_REGISTRY.isKeeper(msg.sender)) revert UnauthorizedKeeper();

        // 3. Validate policy & get it
        IPolicyRegistry.Policy memory policy = POLICY_REGISTRY.validatePolicy(
            params.user,
            params.collateralAsset,
            params.debtAsset,
            params.releaseAmount
        );

        // 4. Check position is actually at risk
        uint256 hfBefore = HealthMath.getHealthFactor(params.user, POOL);
        if (hfBefore != 0 && hfBefore >= policy.triggerHF) revert NotAtRisk();

        // 5. Snapshot user state for post-execution verification
        (uint256 debtBefore,) = _snapshotUserState(params);

        // 6. Execute flash loan (calls back into executeOperation)
        FLASH_PROVIDER.flashLoanSimple(
            address(this),
            params.debtAsset,
            params.repayAmount,
            abi.encode(params, hfBefore),
            0
        );

        // ============ POST-FLASH INVARIANTS ============

        // 7. Health factor must have improved
        uint256 hfAfter = HealthMath.getHealthFactor(params.user, POOL);
        if (hfBefore != 0 && hfAfter <= hfBefore) revert MadeItWorse();
        if (hfAfter != 0 && hfAfter < params.targetHF) revert TargetNotReached();

        // 8. No new debt opened
        _assertNoNewDebt(params, debtBefore);

        // 9. Contract must be drained
        _assertContractDrained(params.collateralAsset, params.debtAsset);

        // 10. Cost within policy limit
        _assertCostWithinLimit(params, policy);

        // 11. Update rate limit
        POLICY_REGISTRY.setLastExecutedAt(params.user, uint64(block.timestamp));

        // 12. Emit event
        uint256 costBps = _computeCostBps(params);
        emit IIntervention.InterventionExecuted(
            params.user,
            params.collateralAsset,
            params.debtAsset,
            params.releaseAmount,
            params.repayAmount,
            hfBefore,
            hfAfter,
            costBps
        );
    }

    // ============ FLASH LOAN CALLBACK ============

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        // Security: Only the Pool/FlashProvider can call this, and only from our own flash loan
        if (msg.sender != address(POOL) && msg.sender != address(FLASH_PROVIDER)) revert OnlyPool();
        if (initiator != address(FLASH_PROVIDER) && initiator != address(this)) revert OnlyThis();

        // Decode parameters
        (IIntervention.InterventionParams memory p,) = abi.decode(params, (IIntervention.InterventionParams, uint256));

        // ============ STEP 1: REPAY DEBT FIRST ============
        IERC20(p.debtAsset).approve(address(POOL), amount);
        POOL.repay(p.debtAsset, amount, 2, p.user); // 2 = variable rate

        // ============ STEP 2: PERMIT + PULL aTOKENS ============
        address aToken = POOL.aTokenFor(p.collateralAsset);
        if (aToken == address(0)) aToken = p.collateralAsset;

        if (p.permit.deadline != 0) {
            MockAToken(aToken).permit(
                p.user,
                address(this),
                p.permit.value,
                p.permit.deadline,
                p.permit.v,
                p.permit.r,
                p.permit.s
            );
        }
        // Pull aTokens from user
        IERC20(aToken).transferFrom(p.user, address(this), p.releaseAmount);

        // ============ STEP 3: WITHDRAW UNDERLYING COLLATERAL ============
        POOL.withdraw(p.collateralAsset, p.releaseAmount, address(this));

        // ============ STEP 4: SWAP COLLATERAL -> DEBT ASSET (ExactOutput) ============
        uint256 owed = amount + premium;
        IERC20(p.collateralAsset).approve(address(SWAPPER), p.releaseAmount);
        uint256 spent = SWAPPER.swapExactOutput(p.swapPath, owed, p.releaseAmount, p.deadline);

        // ============ STEP 5: REFUND LEFTOVER COLLATERAL TO USER ============
        uint256 leftover = p.releaseAmount - spent;
        if (leftover > 0) {
            IERC20(p.collateralAsset).approve(address(POOL), leftover);
            POOL.supply(p.collateralAsset, leftover, p.user, 0);
        }

        // ============ STEP 6: APPROVE FLASH LOAN REPAYMENT ============
        IERC20(asset).approve(msg.sender, owed);

        return true;
    }

    // ============ INTERNAL HELPERS ============

    function _snapshotUserState(IIntervention.InterventionParams calldata p) internal view returns (uint256, uint256) {
        return (POOL.userDebt(p.user, p.debtAsset), POOL.userCollateral(p.user, p.collateralAsset));
    }

    function _assertNoNewDebt(IIntervention.InterventionParams calldata p, uint256 debtBefore) internal view {
        uint256 debtAfter = POOL.userDebt(p.user, p.debtAsset);
        if (debtAfter >= debtBefore) revert NewDebtOpened();
    }

    function _assertContractDrained(address collateralAsset, address debtAsset) internal view {
        if (IERC20(collateralAsset).balanceOf(address(this)) > 0) {
            revert ResidualBalance(collateralAsset, IERC20(collateralAsset).balanceOf(address(this)));
        }
        if (IERC20(debtAsset).balanceOf(address(this)) > 0) {
            revert ResidualBalance(debtAsset, IERC20(debtAsset).balanceOf(address(this)));
        }
    }

    function _assertCostWithinLimit(IIntervention.InterventionParams calldata p, IPolicyRegistry.Policy memory policy) internal view {
        uint256 costBps = _computeCostBps(p);
        if (costBps > policy.maxCostBps) revert TooExpensive();
    }

    function _computeCostBps(IIntervention.InterventionParams calldata p) internal view returns (uint256) {
        // Compute cost BPS based on flash loan premium (owed vs repaid)
        uint256 premiumUsd = (p.repayAmount * 5) / 10000; // 5 BPS flash loan premium
        uint256 repayValueUsd = p.repayAmount * POOL.assetPriceUsd(p.debtAsset) / (10 ** IERC20Metadata(p.debtAsset).decimals());

        if (repayValueUsd == 0) return 0;
        return (premiumUsd * 10000) / p.repayAmount;
    }
}
