import { type CandidateRouteEvaluation, type UserPosition } from './selection.js';

export type ViabilityVerdict = 'EXECUTE' | 'HOLD' | 'REFUSE';

export type OverrideType =
  | 'CRASHED_HF_EXECUTE'
  | 'MAX_COST_REFUSE'
  | 'NO_FEASIBLE_ROUTE_REFUSE';

export interface ViabilityPolicy {
  /** Minimum dollar net benefit required to trigger proactive intervention (default: $0) */
  minNetBenefitUsd?: number | undefined;
  /** Maximum acceptable round-trip friction in basis points (e.g. 500 = 5.0%) */
  maxCostBps?: number | undefined;
}

export interface ViabilityInputs {
  /** Current user position */
  position: UserPosition;
  /** Best candidate route evaluation from selection engine (or null if none found) */
  candidate: CandidateRouteEvaluation | null;
  /** Probability of liquidation over reaction window P_liq(Δt) from Part 1 risk model [0, 1] */
  pLiq: number;
  /** Liquidation bonus multiplier (e.g. 1.05 for 5% bonus on stables/ETH, 1.10 for WBTC) */
  liquidationBonus?: number | undefined;
  /** Optional explicit close factor override (defaults dynamically: 1.0 if HF < 0.95 or D < $2,000, else 0.50) */
  closeFactor?: number | undefined;
  /** Policy constraints */
  policy?: ViabilityPolicy | undefined;
}

export interface ViabilityResult {
  /** Primary decision verdict: EXECUTE, HOLD, or REFUSE */
  verdict: ViabilityVerdict;
  /** Machine-readable reason code */
  reasonCode: string;
  /** Human-readable explanation and diagnostics */
  reasons: string[];
  /** Indicates whether decision was triggered by a hard override */
  isOverride: boolean;
  /** Specific override category if triggered */
  overrideType?: OverrideType;
  /** Expected loss if no action is taken: P_liq · closeFactor · D · (bonus − 1) */
  expectedLossIfIdleUsd: number;
  /** Total cost of intervention: capitalBurned + gas */
  expectedCostOfActionUsd: number;
  /** Net dollar benefit: expectedLossIfIdle − expectedCostOfAction */
  netBenefitUsd: number;
  /** Applied close factor (0.5 or 1.0) */
  closeFactor: number;
  /** Applied liquidation bonus multiplier (e.g. 1.05) */
  liquidationBonus: number;
  /** P_liq probability used in calculation */
  pLiq: number;
  /** Human-readable breakdown of the economic calculation */
  arithmeticExplanation: string;
}

/**
 * Calculates the dynamic close factor per Aave v3 protocol rules (§5).
 *
 * Rules:
 * - 1.0 (100% close factor) if HF < 0.95 or total debt < $2,000 (dust threshold)
 * - 0.5 (50% close factor) under normal healthy/pre-liquidation conditions
 */
export function calculateCloseFactor(currentHF: number, totalDebtUsd: number): number {
  if (currentHF < 0.95 || totalDebtUsd < 2000) {
    return 1.0;
  }
  return 0.5;
}

/**
 * Evaluates the economic viability of an intervention plan and applies hard overrides (§5).
 *
 * Formula:
 *   expectedLossIfIdle   = pLiq(Δt) · closeFactor · D · (liquidationBonus − 1)
 *   expectedCostOfAction = capitalBurnedUsd + gasUsd
 *   netBenefit           = expectedLossIfIdle − expectedCostOfAction
 *
 * Hard overrides (in strict order):
 *   1. HF < 1.0                                        ⟹ EXECUTE (Critical liquidatability override)
 *   2. capitalBurned / releaseUsd > policy.maxCostBps  ⟹ REFUSE (Intervention cost too high)
 *   3. No feasible (j, k) pair                         ⟹ REFUSE (No viable execution path)
 *   4. netBenefit <= policy.minNetBenefitUsd           ⟹ HOLD (Intervention cost exceeds loss prevented)
 *
 * @param inputs - ViabilityInputs
 * @returns ViabilityResult
 */
export function evaluateViability(inputs: ViabilityInputs): ViabilityResult {
  const { position, candidate, pLiq } = inputs;
  const currentHF = position.currentHF;
  const totalDebtUsd = position.totalDebtUsd;

  const liquidationBonus = inputs.liquidationBonus ?? 1.05; // 5% bonus default
  const bonusFraction = Math.max(0, liquidationBonus - 1.0); // e.g. 0.05
  const closeFactor =
    inputs.closeFactor ?? calculateCloseFactor(currentHF, totalDebtUsd);
  const minNetBenefitUsd = inputs.policy?.minNetBenefitUsd ?? 0;
  const maxCostBps = inputs.policy?.maxCostBps ?? 500; // 500 bps = 5.0%

  // 1. Economic calculations
  const expectedLossIfIdleUsd =
    pLiq * closeFactor * totalDebtUsd * bonusFraction;

  const expectedCostOfActionUsd = candidate
    ? candidate.capitalBurnedUsd + candidate.gasUsd
    : 0;

  const netBenefitUsd = expectedLossIfIdleUsd - expectedCostOfActionUsd;

  const arithmeticExplanation = `Expected liquidation loss: $${expectedLossIfIdleUsd.toFixed(2)} (P_liq ${(pLiq * 100).toFixed(1)}% × ${(closeFactor * 100).toFixed(0)}% close factor × $${totalDebtUsd.toFixed(0)} debt × ${(bonusFraction * 100).toFixed(1)}% bonus) vs Intervention cost: $${expectedCostOfActionUsd.toFixed(2)} ($${candidate?.capitalBurnedUsd.toFixed(2) ?? '0.00'} friction + $${candidate?.gasUsd.toFixed(2) ?? '0.00'} gas) ⟹ Net benefit: $${netBenefitUsd.toFixed(2)}`;

  // ==========================================
  // HARD OVERRIDES IN PRIORITY ORDER (§5)
  // ==========================================

  // OVERRIDE 1: HF < 1.0 ⟹ EXECUTE regardless of cost (immediate liquidation risk)
  if (currentHF < 1.0) {
    if (candidate && candidate.feasible) {
      return {
        verdict: 'EXECUTE',
        reasonCode: 'CRITICAL_HF_OVERRIDE',
        reasons: [
          `CRITICAL: Health factor (${currentHF.toFixed(4)}) is below 1.000. Position is actively liquidatable. Executing emergency intervention immediately regardless of cost gate.`,
          arithmeticExplanation,
        ],
        isOverride: true,
        overrideType: 'CRASHED_HF_EXECUTE',
        expectedLossIfIdleUsd,
        expectedCostOfActionUsd,
        netBenefitUsd,
        closeFactor,
        liquidationBonus,
        pLiq,
        arithmeticExplanation,
      };
    } else {
      // If position is crashed but no candidate route is feasible
      return {
        verdict: 'REFUSE',
        reasonCode: candidate?.reasonCode ?? 'NO_FEASIBLE_ROUTE',
        reasons: [
          `CRITICAL: Health factor (${currentHF.toFixed(4)}) is below 1.000, but no feasible deleverage/repay route exists to restore position to target HF.`,
          ...(candidate?.reasons ?? []),
        ],
        isOverride: true,
        overrideType: 'NO_FEASIBLE_ROUTE_REFUSE',
        expectedLossIfIdleUsd,
        expectedCostOfActionUsd,
        netBenefitUsd,
        closeFactor,
        liquidationBonus,
        pLiq,
        arithmeticExplanation,
      };
    }
  }

  // OVERRIDE 2: Route friction exceeds policy maxCostBps ⟹ REFUSE
  if (candidate && candidate.feasible && candidate.clampedReleaseUsd > 0) {
    const effectiveCostBps = candidate.kappaBps;
    if (effectiveCostBps > maxCostBps) {
      return {
        verdict: 'REFUSE',
        reasonCode: 'COST_POLICY_EXCEEDED',
        reasons: [
          `REFUSED: Intervention friction ${effectiveCostBps} bps (${(candidate.kappa * 100).toFixed(2)}%) exceeds policy maximum ${maxCostBps} bps (${(maxCostBps / 100).toFixed(2)}%). Trade is too expensive to be protective.`,
          arithmeticExplanation,
        ],
        isOverride: true,
        overrideType: 'MAX_COST_REFUSE',
        expectedLossIfIdleUsd,
        expectedCostOfActionUsd,
        netBenefitUsd,
        closeFactor,
        liquidationBonus,
        pLiq,
        arithmeticExplanation,
      };
    }
  }

  // OVERRIDE 3: No feasible candidate ⟹ REFUSE
  if (!candidate || !candidate.feasible) {
    return {
      verdict: 'REFUSE',
      reasonCode: candidate?.reasonCode ?? 'NO_FEASIBLE_ROUTE',
      reasons: [
        'REFUSED: No feasible collateral-debt intervention candidate found matching balance and allowance constraints.',
        ...(candidate?.reasons ?? []),
      ],
      isOverride: true,
      overrideType: 'NO_FEASIBLE_ROUTE_REFUSE',
      expectedLossIfIdleUsd,
      expectedCostOfActionUsd,
      netBenefitUsd,
      closeFactor,
      liquidationBonus,
      pLiq,
      arithmeticExplanation,
    };
  }

  // OVERRIDE 4: Standard Economic Viability Comparison
  if (netBenefitUsd > minNetBenefitUsd) {
    return {
      verdict: 'EXECUTE',
      reasonCode: 'POSITIVE_NET_BENEFIT',
      reasons: [
        `APPROVED: Net benefit of intervention ($${netBenefitUsd.toFixed(2)}) exceeds threshold ($${minNetBenefitUsd.toFixed(2)}).`,
        arithmeticExplanation,
      ],
      isOverride: false,
      expectedLossIfIdleUsd,
      expectedCostOfActionUsd,
      netBenefitUsd,
      closeFactor,
      liquidationBonus,
      pLiq,
      arithmeticExplanation,
    };
  } else {
    return {
      verdict: 'HOLD',
      reasonCode: 'INSUFFICIENT_NET_BENEFIT',
      reasons: [
        `held: expected liquidation loss $${expectedLossIfIdleUsd.toFixed(2)} < intervention cost $${expectedCostOfActionUsd.toFixed(2)} (net benefit $${netBenefitUsd.toFixed(2)})`,
        arithmeticExplanation,
      ],
      isOverride: false,
      expectedLossIfIdleUsd,
      expectedCostOfActionUsd,
      netBenefitUsd,
      closeFactor,
      liquidationBonus,
      pLiq,
      arithmeticExplanation,
    };
  }
}
