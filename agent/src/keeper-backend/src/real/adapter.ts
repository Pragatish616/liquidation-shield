/**
 * Bridges Part 1's real on-chain PositionSnapshot into Part 2's
 * UserPosition shape, so the real planner (generateInterventionPlan) can
 * size an intervention from real chain state instead of the mock system
 * in ../mock/position.ts.
 */

import type { PositionSnapshot, CollateralLeg } from '../../../types.ts';
import type { UserPosition, CollateralAsset, DebtAsset } from '../../../planner/selection.ts';

export interface AdapterOptions {
  /**
   * Real aToken allowance granted to the shield contract, in USD, per
   * collateral asset address (lowercased). Part 1 does not read this (it's
   * an off-chain grant to Part 3's shield, which isn't deployed in this
   * demo) -- legs missing from this map default to "fully approved"
   * (approvalRemainingUsd = balanceUsd), a documented placeholder, not a
   * real allowance read.
   */
  approvalRemainingUsdByAsset?: Record<string, number>;
}

function toCollateralAsset(leg: CollateralLeg, opts: AdapterOptions): CollateralAsset {
  const approvalRemainingUsd =
    opts.approvalRemainingUsdByAsset?.[leg.asset.toLowerCase()] ?? leg.valueUsd;

  return {
    address: leg.asset,
    symbol: leg.symbol,
    decimals: leg.decimals,
    priceUsd: Number(leg.priceUsd) / 1e8,
    lt: leg.ltBps / 10_000,
    balance: leg.balance,
    balanceUsd: leg.valueUsd,
    approvalRemainingUsd,
    aTokenAddress: leg.aToken,
  };
}

function toDebtAsset(leg: PositionSnapshot['debt'][number]): DebtAsset {
  return {
    address: leg.asset,
    symbol: leg.symbol,
    decimals: leg.decimals,
    priceUsd: Number(leg.priceUsd) / 1e8,
    debt: leg.balance,
    debtUsd: leg.valueUsd,
  };
}

/**
 * Only legs with usedAsCollateral=true are eligible: Part 2's sizing math
 * (A - V*LT) assumes V is released from the risk-weighted pool A, which by
 * definition only includes collateral-enabled legs (plan.md's own A = Σ
 * C_i·LT_i, and readPosition.ts's weightedCollateralUsd computation, only
 * sum over usedAsCollateral legs). Releasing a non-collateral-enabled leg
 * wouldn't move A at all, so including it here would let the solver "size"
 * a release that does nothing to the health factor.
 */
export function snapshotToUserPosition(
  snapshot: PositionSnapshot,
  opts: AdapterOptions = {},
): UserPosition {
  const eligibleCollateral = snapshot.collateral.filter((leg) => leg.usedAsCollateral);

  return {
    user: snapshot.user,
    collaterals: eligibleCollateral.map((leg) => toCollateralAsset(leg, opts)),
    debts: snapshot.debt.map(toDebtAsset),
    totalCollateralUsd: snapshot.totalCollateralUsd,
    totalRiskWeightedCollateralUsd: snapshot.weightedCollateralUsd,
    totalDebtUsd: snapshot.totalDebtUsd,
    currentHF: snapshot.healthFactor,
  };
}
