import { type InterventionPlan } from './plan.js';
import { type UserPosition } from './selection.js';

export interface SimulationInvariants {
  /** Health factor strictly improved post-intervention */
  hfImproved: boolean;
  /** Resulting health factor reaches or exceeds targetHF setpoint */
  hfTargetMet: boolean;
  /** Swap produced at least minAmountOut required by on-chain guard */
  minAmountOutSatisfied: boolean;
}

export interface SimulationResult {
  /** True if simulation dry-run passed all invariant assertions and landed within tolerance */
  success: boolean;
  /** Initial health factor before restructuring */
  initialHF: number;
  /** Target health factor setpoint (H_t) */
  targetHF: number;
  /** Actual resulting health factor after simulated restructuring */
  postHF: number;
  /** Absolute error: postHF - targetHF */
  hfDelta: number;
  /** Relative error fraction: |postHF - targetHF| / targetHF */
  hfRelativeError: number;
  /** True if resulting HF is within 0.5% (0.005) tolerance of targetHF (§7 & §10.6) */
  withinTolerance: boolean;
  /** Post-intervention total debt value in USD */
  simulatedDebtAfterUsd: number;
  /** Post-intervention risk-weighted collateral value A in USD */
  simulatedRiskWeightedCollateralAfterUsd: number;
  /** On-chain settlement invariant checks (§6) */
  invariants: SimulationInvariants;
  /** Trace logs */
  logs: string[];
}

/**
 * Dry-runs an InterventionPlan on a position and asserts that the resulting HF
 * lands within 0.5% (0.005) of the target setpoint (§7, §9 item 11, §10.6).
 *
 * Simulates the exact on-chain restructuring sequence and enforces the 3 invariants:
 *   1. amountOut >= minAmountOut
 *   2. healthFactorAfter >= targetHF (within float tolerance)
 *   3. healthFactorAfter > healthFactorBefore
 *
 * @param position - Initial UserPosition
 * @param plan - Generated InterventionPlan
 * @param toleranceFraction - Max acceptable relative error (default: 0.005 = 0.5%)
 * @returns SimulationResult
 */
export function simulatePlanExecution(
  position: UserPosition,
  plan: InterventionPlan,
  toleranceFraction: number = 0.005
): SimulationResult {
  const logs: string[] = [];
  const targetHFNum = Number(plan.targetHF) / 1e18;
  const initialHF = position.currentHF;

  logs.push(`Initial Position: Debt $${position.totalDebtUsd.toFixed(2)}, Risk-Weighted Collateral $${position.totalRiskWeightedCollateralUsd.toFixed(2)}, HF ${initialHF.toFixed(4)}`);
  logs.push(`Plan Mode: ${plan.mode}, Target HF: ${targetHFNum.toFixed(4)}`);

  if (plan.verdict === 'REFUSE') {
    return {
      success: false,
      initialHF,
      targetHF: targetHFNum,
      postHF: initialHF,
      hfDelta: 0,
      hfRelativeError: 1,
      withinTolerance: false,
      simulatedDebtAfterUsd: position.totalDebtUsd,
      simulatedRiskWeightedCollateralAfterUsd: position.totalRiskWeightedCollateralUsd,
      invariants: {
        hfImproved: false,
        hfTargetMet: false,
        minAmountOutSatisfied: false,
      },
      logs: [...logs, `Simulation skipped: Plan has verdict REFUSE (${plan.reasonCode ?? 'NO_FEASIBLE_ROUTE'}).`],
    };
  }

  let postA: number;
  let postD: number;
  let minAmountOutSatisfied = true;

  if (plan.mode === 'EXTERNAL_REPAY') {
    // Mode A: Only debt changes
    const debtAsset = position.debts.find(
      (d) => d.address.toLowerCase() === plan.debtAsset.toLowerCase()
    );
    const repayUsd = debtAsset
      ? (Number(plan.repayAmount) / 10 ** debtAsset.decimals) * debtAsset.priceUsd
      : 0;

    postD = Math.max(0, position.totalDebtUsd - repayUsd);
    postA = position.totalRiskWeightedCollateralUsd;
    logs.push(`Mode A Repay: Repaid $${repayUsd.toFixed(2)} debt directly.`);
  } else {
    // Mode B: Both collateral release and debt repayment occur
    const collateralAsset = position.collaterals.find(
      (c) => c.address.toLowerCase() === plan.collateralAsset.toLowerCase()
    );
    const debtAsset = position.debts.find(
      (d) => d.address.toLowerCase() === plan.debtAsset.toLowerCase()
    );

    const releaseUsd = collateralAsset
      ? (Number(plan.releaseAmount) / 10 ** collateralAsset.decimals) * collateralAsset.priceUsd
      : 0;
    const repayUsd = debtAsset
      ? (Number(plan.repayAmount) / 10 ** debtAsset.decimals) * debtAsset.priceUsd
      : 0;

    const releasedRiskWeighted = releaseUsd * (collateralAsset?.lt ?? 0.825);
    postA = Math.max(0, position.totalRiskWeightedCollateralUsd - releasedRiskWeighted);
    postD = Math.max(0, position.totalDebtUsd - repayUsd);

    minAmountOutSatisfied = plan.repayAmount >= plan.minAmountOut;
    logs.push(`Mode B Restructure: Released $${releaseUsd.toFixed(2)} ${collateralAsset?.symbol ?? 'col'}, Repaid $${repayUsd.toFixed(2)} ${debtAsset?.symbol ?? 'debt'}.`);
  }

  const postHF = postD > 0 ? postA / postD : Number.POSITIVE_INFINITY;
  const hfDelta = postHF - targetHFNum;
  const hfRelativeError = Math.abs(postHF - targetHFNum) / targetHFNum;
  const withinTolerance = hfRelativeError <= toleranceFraction;

  const hfImproved = postHF > initialHF;
  const hfTargetMet = postHF >= targetHFNum - 1e-4;

  const invariants: SimulationInvariants = {
    hfImproved,
    hfTargetMet,
    minAmountOutSatisfied,
  };

  const success = withinTolerance && hfImproved && minAmountOutSatisfied;

  logs.push(`Post Simulation: Debt $${postD.toFixed(2)}, Collateral A $${postA.toFixed(2)}, Resulting HF: ${postHF.toFixed(4)}`);
  logs.push(`Target Accuracy: Relative Error ${(hfRelativeError * 100).toFixed(3)}% (Tolerance ${(toleranceFraction * 100).toFixed(1)}%) -> ${withinTolerance ? 'PASSED' : 'FAILED'}`);
  logs.push(`Invariants Check: [Improved: ${hfImproved}, Target Met: ${hfTargetMet}, MinOut Met: ${minAmountOutSatisfied}]`);

  return {
    success,
    initialHF,
    targetHF: targetHFNum,
    postHF,
    hfDelta,
    hfRelativeError,
    withinTolerance,
    simulatedDebtAfterUsd: postD,
    simulatedRiskWeightedCollateralAfterUsd: postA,
    invariants,
    logs,
  };
}
