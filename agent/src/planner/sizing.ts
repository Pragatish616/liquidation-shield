/**
 * Sizing Solver for DeFi Liquidation Protection System
 *
 * Implements Part 2 ("DECIDE: The Intervention Planner") §2.1 sizing formulas:
 *
 * Mathematical Reference:
 * - A: Risk-weighted collateral value (USD) = Σ (collateral_i × price_i × LT_i)
 * - D: Total debt value (USD) = Σ (debt_j × price_j)
 * - H_t: Target health factor setpoint (targetHF)
 * - LT_j: Liquidation threshold of selected collateral asset j (ltJ)
 * - κ_j: Total round-trip execution friction fraction (kappaJ)
 *        (flash premium + swap fee + slippage + gas / V)
 *
 * Mode A — External Repay (§2.1):
 *   R_min = D − A / H_t
 *
 * Mode B — Flash Loan Deleverage (§2.1):
 *   Health Factor after releasing V collateral and repaying R = V(1 - κ_j):
 *          A − V · LT_j
 *   H_t = ──────────────
 *         D − V(1 − κ_j)
 *
 *   Solving for V:
 *                H_t · D − A
 *   V_min,j = ──────────────────
 *             H_t(1 − κ_j) − LT_j
 */

export interface DeleverageSizingResult {
  /** Whether deleveraging using collateral j is mathematically feasible and needed */
  feasible: boolean;
  /** Collateral USD value to release (V_min) */
  releaseUsd: number;
  /** Debt USD value to repay (R = V * (1 - κ)) */
  repayUsd: number;
  /** Friction loss / capital burned by the user (V * κ) */
  capitalBurnedUsd: number;
  /** Informational message on status or reason for infeasibility */
  reason?: string;
}

export interface ExternalRepaySizingResult {
  /** Whether external repayment is needed */
  feasible: boolean;
  /** Amount of external debt asset (USD) to repay (R_min) */
  repayUsd: number;
  /** Informational message on status */
  reason?: string;
}

/**
 * Sizes the minimum collateral release required to restore the health factor to targetHF
 * using flash-loan assisted deleveraging (Mode B).
 *
 * Formula (§2.1):
 *                 H_t · D − A
 *   V_min,j = ──────────────────
 *             H_t(1 − κ_j) − LT_j
 *
 * @param A - Current risk-weighted collateral value in USD (A = Σ C_i · LT_i)
 * @param D - Current total debt value in USD (D)
 * @param targetHF - Target Health Factor (H_t)
 * @param ltJ - Liquidation threshold of collateral asset j (LT_j, e.g. 0.825 for WETH)
 * @param kappaJ - Total execution friction fraction (κ_j, e.g. 0.0105 for 1.05%)
 * @returns DeleverageSizingResult with releaseUsd, repayUsd, capitalBurnedUsd
 */
export function sizeDeleverage(
  A: number,
  D: number,
  targetHF: number,
  ltJ: number,
  kappaJ: number
): DeleverageSizingResult {
  // Input validation
  if (targetHF <= 0 || D <= 0 || ltJ <= 0 || ltJ >= 1 || kappaJ < 0 || kappaJ >= 1) {
    return {
      feasible: false,
      releaseUsd: 0,
      repayUsd: 0,
      capitalBurnedUsd: 0,
      reason: 'Invalid input parameters (targetHF, D, ltJ, or kappaJ out of valid bounds)',
    };
  }

  // Denominator: H_t(1 − κ_j) − LT_j
  const denom = targetHF * (1 - kappaJ) - ltJ;

  // Feasibility guard: if denom <= 0 (with small numerical epsilon), releasing collateral lowers HF
  if (denom <= 1e-9) {
    return {
      feasible: false,
      releaseUsd: 0,
      repayUsd: 0,
      capitalBurnedUsd: 0,
      reason: `Infeasible: denominator ${denom.toFixed(6)} <= 0 (H_t * (1 - κ) <= LT_j). Collateral release would decrease HF.`,
    };
  }

  // Numerator: H_t · D − A
  const numerator = targetHF * D - A;

  // Sizing: V_min = numerator / denom
  const releaseUsd = numerator / denom;

  // If releaseUsd <= 0, position is already at or above targetHF
  if (releaseUsd <= 0) {
    return {
      feasible: false,
      releaseUsd: 0,
      repayUsd: 0,
      capitalBurnedUsd: 0,
      reason: 'Already healthy: current risk-weighted collateral already satisfies targetHF.',
    };
  }

  // Repayment amount: R = V · (1 − κ_j)
  const repayUsd = releaseUsd * (1 - kappaJ);

  // Capital burned by user friction: V · κ_j
  const capitalBurnedUsd = releaseUsd * kappaJ;

  return {
    feasible: true,
    releaseUsd,
    repayUsd,
    capitalBurnedUsd,
  };
}

/**
 * Sizes the minimum external repayment required to restore the health factor to targetHF
 * without releasing collateral (Mode A).
 *
 * Formula (§2.1):
 *   R_min = D − A / H_t
 *
 * @param A - Current risk-weighted collateral value in USD (A = Σ C_i · LT_i)
 * @param D - Current total debt value in USD (D)
 * @param targetHF - Target Health Factor (H_t)
 * @returns ExternalRepaySizingResult with repayUsd
 */
export function sizeExternalRepay(
  A: number,
  D: number,
  targetHF: number
): ExternalRepaySizingResult {
  if (targetHF <= 0 || D <= 0 || A <= 0) {
    return {
      feasible: false,
      repayUsd: 0,
      reason: 'Invalid input parameters (targetHF, D, or A <= 0)',
    };
  }

  // R_min = D − A / H_t
  const repayUsd = D - A / targetHF;

  if (repayUsd <= 0) {
    return {
      feasible: false,
      repayUsd: 0,
      reason: 'Already healthy: current collateral already satisfies targetHF without repayment.',
    };
  }

  return {
    feasible: true,
    repayUsd,
  };
}

/**
 * Recomputes the Health Factor resulting from releasing V collateral and repaying R = V(1 - κ_j).
 *
 * Formula (§2.1):
 *          A − V · LT_j
 *   HF = ──────────────
 *        D − V(1 − κ_j)
 *
 * @param A - Initial risk-weighted collateral value in USD
 * @param D - Initial total debt value in USD
 * @param releaseUsd - Collateral value released in USD (V)
 * @param ltJ - Liquidation threshold of released collateral asset (LT_j)
 * @param kappaJ - Execution friction fraction (κ_j)
 * @returns Recomputed Health Factor
 */
export function recomputeHealthFactor(
  A: number,
  D: number,
  releaseUsd: number,
  ltJ: number,
  kappaJ: number
): number {
  const numerator = A - releaseUsd * ltJ;
  const denominator = D - releaseUsd * (1 - kappaJ);
  if (denominator <= 0) {
    return Number.POSITIVE_INFINITY; // Debt completely paid off
  }
  return numerator / denominator;
}
