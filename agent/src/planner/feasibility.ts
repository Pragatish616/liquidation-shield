/**
 * Feasibility Engine & Clamping Guards for DeFi Liquidation Protection System
 *
 * Implements Part 2 ("DECIDE: The Intervention Planner"):
 * - §2.2 Feasibility condition: H_t(1 − κ_j) > LT_j
 * - §2.3 Caps and clamps:
 *     V = min( V_min · (1 + overshootPct),
 *              collateralBalanceUsd_j,
 *              policy.maxReleasePerTxUsd,
 *              approvalRemainingUsd_j )
 *     repayUsd <= currentDebt_k (debt cap)
 */

export interface FeasibilityCheckResult {
  /** True if releasing collateral asset j can mathematically increase Health Factor */
  feasible: boolean;
  /** Effective upper bound on liquidation threshold: H_t * (1 - κ_j) */
  bound: number;
  /** Liquidation threshold of collateral asset j */
  ltJ: number;
  /** Informative message on feasibility status */
  reason: string;
}

export interface DeleverageLimits {
  /**
   * Optional safety overshoot fraction (e.g. 0.01 for 1% overshoot, typically 0.5% - 2%).
   * Ensures on-chain post-check HF >= targetHF even with minor slippage variance.
   */
  overshootPct?: number | undefined;
  /** Available collateral balance in USD for asset j */
  collateralBalanceUsd: number;
  /** User-configured max USD release per transaction policy limit (blast radius) */
  maxReleasePerTxUsd: number;
  /** Remaining aToken approval allowance granted to the shield in USD */
  approvalRemainingUsd: number;
  /** Total outstanding debt in USD for the target debt asset k */
  currentDebtUsd: number;
}

export type LimitingFactor =
  | 'NONE'
  | 'COLLATERAL_BALANCE'
  | 'POLICY_MAX_RELEASE'
  | 'APPROVAL_ALLOWANCE'
  | 'DEBT_CAP';

export interface ClampedDeleverageResult {
  /** Raw minimum collateral release required without caps or overshoot */
  vMin: number;
  /** Target release amount after applying overshoot percentage */
  vTarget: number;
  /** Final clamped collateral release in USD after applying all real-world constraints */
  clampedReleaseUsd: number;
  /** Final repay amount in USD after applying all constraints */
  clampedRepayUsd: number;
  /** Capital burned in USD (friction loss = clampedReleaseUsd * κ_j) */
  capitalBurnedUsd: number;
  /** True if clamped amount satisfies the minimum requirement (clampedReleaseUsd >= vMin) */
  reachesTargetHF: boolean;
  /** True if any real-world cap restricted the target overshot amount */
  isConstrained: boolean;
  /** Primary limiting constraint that bound the release amount */
  limitingFactor: LimitingFactor;
  /** Human-readable explanation of clamping result */
  diagnostics: string;
}

/**
 * Checks whether deleveraging with collateral asset j is mathematically feasible.
 *
 * Implements §2.2:
 *   H_t(1 − κ_j) > LT_j
 *
 * If LT_j >= H_t(1 − κ_j), releasing collateral removes more risk-weighted collateral
 * than it reduces debt, thereby LOWERING the Health Factor instead of raising it.
 *
 * @param targetHF - Target Health Factor (H_t)
 * @param ltJ - Liquidation threshold of collateral asset j (LT_j)
 * @param kappaJ - Execution friction fraction (κ_j)
 * @returns FeasibilityCheckResult containing feasibility boolean, bound, and reason
 */
export function checkDeleverageFeasibility(
  targetHF: number,
  ltJ: number,
  kappaJ: number
): FeasibilityCheckResult {
  const bound = targetHF * (1 - kappaJ);
  const feasible = bound > ltJ;

  if (!feasible) {
    return {
      feasible: false,
      bound,
      ltJ,
      reason: `Infeasible collateral: target HF (${targetHF.toFixed(4)}) with friction κ (${(kappaJ * 100).toFixed(2)}%) yields bound ${bound.toFixed(4)} <= LT (${ltJ.toFixed(4)}). Releasing this collateral would decrease Health Factor.`,
    };
  }

  return {
    feasible: true,
    bound,
    ltJ,
    reason: `Feasible collateral: bound ${bound.toFixed(4)} > LT (${ltJ.toFixed(4)}).`,
  };
}

/**
 * Convenience boolean guard for §2.2 feasibility condition.
 *
 * @param targetHF - Target Health Factor (H_t)
 * @param ltJ - Liquidation threshold of collateral asset j (LT_j)
 * @param kappaJ - Execution friction fraction (κ_j)
 * @returns true if H_t(1 − κ_j) > LT_j
 */
export function isDeleverageFeasible(
  targetHF: number,
  ltJ: number,
  kappaJ: number
): boolean {
  return targetHF * (1 - kappaJ) > ltJ;
}

/**
 * Applies real-world caps and clamps to the raw minimum release amount V_min (§2.3).
 *
 * Enforces:
 *   V = min( V_min · (1 + overshootPct),
 *            collateralBalanceUsd_j,
 *            policy.maxReleasePerTxUsd,
 *            approvalRemainingUsd_j,
 *            currentDebt_k / (1 - κ_j) )
 *   repayUsd = min( V · (1 - κ_j), currentDebt_k )
 *
 * @param vMin - Raw minimum collateral release amount in USD from sizing solver
 * @param kappaJ - Execution friction fraction (κ_j)
 * @param limits - DeleverageLimits containing balance, policy, allowance, and debt caps
 * @returns ClampedDeleverageResult with final amounts, constraint status, and diagnostics
 */
export function clampDeleverageAmount(
  vMin: number,
  kappaJ: number,
  limits: DeleverageLimits
): ClampedDeleverageResult {
  const overshootPct = limits.overshootPct ?? 0;
  const vTarget = vMin * (1 + overshootPct);

  // Maximum collateral to release based on total debt available (debt cap)
  const maxReleaseFromDebt =
    kappaJ < 1 ? limits.currentDebtUsd / (1 - kappaJ) : Number.POSITIVE_INFINITY;

  // Candidate caps
  const caps: Array<{ factor: LimitingFactor; limit: number }> = [
    { factor: 'COLLATERAL_BALANCE', limit: limits.collateralBalanceUsd },
    { factor: 'POLICY_MAX_RELEASE', limit: limits.maxReleasePerTxUsd },
    { factor: 'APPROVAL_ALLOWANCE', limit: limits.approvalRemainingUsd },
    { factor: 'DEBT_CAP', limit: maxReleaseFromDebt },
  ];

  let clampedReleaseUsd = vTarget;
  let limitingFactor: LimitingFactor = 'NONE';

  for (const cap of caps) {
    if (cap.limit < clampedReleaseUsd) {
      clampedReleaseUsd = cap.limit;
      limitingFactor = cap.factor;
    }
  }

  // Ensure non-negative release
  clampedReleaseUsd = Math.max(0, clampedReleaseUsd);

  // Calculate actual repay, strictly bounded by currentDebtUsd
  const rawRepay = clampedReleaseUsd * (1 - kappaJ);
  const clampedRepayUsd = Math.min(rawRepay, limits.currentDebtUsd);

  // Capital burned by friction
  const capitalBurnedUsd = clampedReleaseUsd * kappaJ;

  const reachesTargetHF = clampedReleaseUsd >= vMin - 1e-6;
  const isConstrained = limitingFactor !== 'NONE';

  let diagnostics: string;
  if (!isConstrained) {
    diagnostics = `Unconstrained: target release $${vTarget.toFixed(2)} (${(overshootPct * 100).toFixed(1)}% overshoot) satisfies all caps.`;
  } else if (reachesTargetHF) {
    diagnostics = `Constrained by ${limitingFactor}: release clamped to $${clampedReleaseUsd.toFixed(2)} (still meets vMin $${vMin.toFixed(2)}).`;
  } else {
    diagnostics = `Severely constrained by ${limitingFactor}: release clamped to $${clampedReleaseUsd.toFixed(2)}, below required vMin $${vMin.toFixed(2)} (partial deleverage).`;
  }

  return {
    vMin,
    vTarget,
    clampedReleaseUsd,
    clampedRepayUsd,
    capitalBurnedUsd,
    reachesTargetHF,
    isConstrained,
    limitingFactor,
    diagnostics,
  };
}
