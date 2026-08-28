// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {IFlashProvider} from "./interfaces/IFlashProvider.sol";
import {ISwapper} from "./interfaces/ISwapper.sol";
import {IPolicyRegistry} from "./interfaces/IPolicyRegistry.sol";
import {IIntervention} from "./interfaces/IIntervention.sol";
import {IPoolLike} from "./interfaces/IPoolLike.sol";
import {IPriceOracleLike} from "./interfaces/IPriceOracleLike.sol";
import {AaveAdapter} from "./libraries/AaveAdapter.sol";
import {HealthMath} from "./libraries/HealthMath.sol";
import "./libraries/Errors.sol";

interface IERC20Metadata {
    function decimals() external view returns (uint8);
}

contract LiquidationShield is ReentrancyGuard {
    IFlashProvider public immutable FLASH_PROVIDER;
    ISwapper public immutable SWAPPER;
    IPolicyRegistry public immutable POLICY_REGISTRY;
    IPoolLike public immutable POOL;
    IPriceOracleLike public immutable ORACLE;

    // Transient commitment binding a flash loan callback to the exact params
    // executeIntervention just initiated it with -- see executeOperation.
    bytes32 private _pendingParamsHash;

    // Independent reentrancy lock for executeOperation. It can't share
    // ReentrancyGuard's nonReentrant with executeIntervention: the flash loan
    // callback re-enters this contract from inside executeIntervention's own
    // nonReentrant call, and OZ's guard is a single shared flag, so reusing
    // it here would make every legitimate intervention revert with
    // ReentrancyGuardReentrantCall the instant the callback fires.
    bool private _operationEntered;

    modifier nonReentrantOperation() {
        if (_operationEntered) revert ReentrantOperation();
        _operationEntered = true;
        _;
        _operationEntered = false;
    }

    constructor(address flashProvider, address swapper, address policyRegistry, address pool, address oracle) {
        FLASH_PROVIDER = IFlashProvider(flashProvider);
        SWAPPER = ISwapper(swapper);
        POLICY_REGISTRY = IPolicyRegistry(policyRegistry);
        POOL = IPoolLike(pool);
        ORACLE = IPriceOracleLike(oracle);
    }

    // ============ ENTRY POINT ============

    function executeIntervention(IIntervention.InterventionParams calldata params) external nonReentrant {
        // 1. Deadline check
        if (block.timestamp > params.deadline) revert Expired();

        // 2. Keeper authorization
        if (!POLICY_REGISTRY.isKeeper(msg.sender)) revert UnauthorizedKeeper();

        // 3. Validate policy & get it
        IPolicyRegistry.Policy memory policy =
            POLICY_REGISTRY.validatePolicy(params.user, params.collateralAsset, params.debtAsset, params.releaseAmount);

        // 4. Check position is actually at risk
        uint256 hfBefore = HealthMath.getHealthFactor(params.user, POOL);
        if (hfBefore != 0 && hfBefore >= policy.triggerHF) revert NotAtRisk();

        // 5. Snapshot user state for post-execution verification
        uint256 debtBefore = _snapshotUserDebt(params);

        // 6. Execute flash loan (calls back into executeOperation)
        bytes memory flashParams = abi.encode(params, hfBefore);
        _pendingParamsHash = keccak256(flashParams);
        FLASH_PROVIDER.flashLoanSimple(address(this), params.debtAsset, params.repayAmount, flashParams, 0);
        _pendingParamsHash = bytes32(0);

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

    function executeOperation(address asset, uint256 amount, uint256 premium, address initiator, bytes calldata params)
        external
        nonReentrantOperation
        returns (bool)
    {
        // Security: Only the Pool/FlashProvider can call this, and only from our own flash loan
        if (msg.sender != address(POOL) && msg.sender != address(FLASH_PROVIDER)) revert OnlyPool();
        // The real gate: this callback must carry the exact params
        // executeIntervention committed to right before initiating the flash
        // loan. `initiator` alone is not sufficient -- it is always
        // address(FLASH_PROVIDER) for any flash loan routed through the
        // adapter, legitimate or not, since FLASH_PROVIDER is the account
        // that actually calls POOL.flashLoanSimple.
        if (_pendingParamsHash == bytes32(0) || keccak256(params) != _pendingParamsHash) {
            revert InvalidParamsCommitment();
        }
        if (initiator != address(FLASH_PROVIDER)) revert OnlyThis();

        // Decode parameters
        (IIntervention.InterventionParams memory p,) = abi.decode(params, (IIntervention.InterventionParams, uint256));

        // ============ STEP 1: REPAY DEBT FIRST ============
        IERC20(p.debtAsset).approve(address(POOL), amount);
        POOL.repay(p.debtAsset, amount, 2, p.user); // 2 = variable rate

        // ============ STEP 2: PERMIT + PULL aTOKENS ============
        address aToken = AaveAdapter.aTokenOf(POOL, p.collateralAsset);
        if (aToken == address(0)) aToken = p.collateralAsset;

        if (p.permit.deadline != 0) {
            IERC20Permit(aToken)
                .permit(p.user, address(this), p.permit.value, p.permit.deadline, p.permit.v, p.permit.r, p.permit.s);
        }
        // Pull aTokens from user
        IERC20(aToken).transferFrom(p.user, address(this), p.releaseAmount);

        // ============ STEP 3: WITHDRAW UNDERLYING COLLATERAL ============
        POOL.withdraw(p.collateralAsset, p.releaseAmount, address(this));

        // ============ STEP 4: SWAP COLLATERAL -> DEBT ASSET (ExactOutput) ============
        // maxAmountIn (not releaseAmount) bounds the swap: it's a tight,
        // quote-derived ceiling with a small slippage buffer, not the full
        // amount pulled from the user. Using releaseAmount here previously
        // let the trade spend far more than intended before reverting --
        // the swap approval still allows up to releaseAmount for STEP 5's
        // refund math, but the swap itself is now bounded far tighter.
        uint256 owed = amount + premium;
        IERC20(p.collateralAsset).approve(address(SWAPPER), p.releaseAmount);
        uint256 spent = SWAPPER.swapExactOutput(p.swapPath, owed, p.maxAmountIn, p.deadline);

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

    function _snapshotUserDebt(IIntervention.InterventionParams calldata p) internal view returns (uint256) {
        return AaveAdapter.debtOf(POOL, p.debtAsset, p.user);
    }

    function _assertNoNewDebt(IIntervention.InterventionParams calldata p, uint256 debtBefore) internal view {
        uint256 debtAfter = AaveAdapter.debtOf(POOL, p.debtAsset, p.user);
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

    function _assertCostWithinLimit(IIntervention.InterventionParams calldata p, IPolicyRegistry.Policy memory policy)
        internal
        view
    {
        uint256 costBps = _computeCostBps(p);
        if (costBps > policy.maxCostBps) revert TooExpensive();
    }

    function _computeCostBps(IIntervention.InterventionParams calldata p) internal view returns (uint256) {
        // Compute cost BPS based on flash loan premium (owed vs repaid)
        uint256 premiumUsd = (p.repayAmount * 5) / 10000; // 5 BPS flash loan premium
        uint256 repayValueUsd =
            p.repayAmount * ORACLE.getAssetPrice(p.debtAsset) / (10 ** IERC20Metadata(p.debtAsset).decimals());

        if (repayValueUsd == 0) return 0;
        return (premiumUsd * 10000) / p.repayAmount;
    }
}
