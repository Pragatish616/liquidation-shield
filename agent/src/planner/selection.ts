import { type Address } from 'viem';
import { clampDeleverageAmount, type LimitingFactor } from './feasibility.js';
import {
  solveKappaFixedPoint,
  type FlashLoanProvider,
  type GasModelParams,
} from './costModel.js';
import { type IQuoter, type RouteQuoteResult } from './quoter.js';

export interface CollateralAsset {
  address: Address;
  symbol: string;
  decimals: number;
  priceUsd: number;
  lt: number; // e.g. 0.825 for WETH
  balance: bigint;
  balanceUsd: number;
  approvalRemainingUsd: number;
  aTokenAddress: Address;
}

export interface DebtAsset {
  address: Address;
  symbol: string;
  decimals: number;
  priceUsd: number;
  debt: bigint;
  debtUsd: number;
}

export interface UserPosition {
  user: Address;
  collaterals: CollateralAsset[];
  debts: DebtAsset[];
  totalCollateralUsd: number;
  totalRiskWeightedCollateralUsd: number; // A = Σ C_i · LT_i
  totalDebtUsd: number; // D = Σ D_k
  currentHF: number; // A / D
}

export interface SelectionPolicy {
  targetHF: number;
  overshootPct?: number | undefined; // e.g. 0.01 for 1%
  maxReleasePerTxUsd?: number | undefined; // Policy blast radius limit
  maxCostBps?: number | undefined; // Max allowable round-trip friction in bps (e.g. 500 = 5%)
  allowedCollaterals?: Address[] | undefined; // Optional whitelist
  allowedDebts?: Address[] | undefined; // Optional whitelist
  flashProvider?: FlashLoanProvider | undefined;
  urgency?: 'LOW' | 'MEDIUM' | 'HIGH' | undefined;
  gasParams?: GasModelParams | undefined;
}

export interface CandidateRouteEvaluation {
  collateral: CollateralAsset;
  debt: DebtAsset;
  feasible: boolean;
  rank: number;
  vMin: number;
  clampedReleaseUsd: number;
  releaseUnits: bigint;
  clampedRepayUsd: number;
  repayUnits: bigint;
  capitalBurnedUsd: number;
  kappa: number;
  kappaBps: number;
  gasUsd: number;
  totalCostUsd: number;
  priceImpactBps: number;
  postRemainingCollateralRatio: number;
  resultingHF: number;
  reachesTargetHF: boolean;
  isConstrained: boolean;
  limitingFactor: LimitingFactor;
  quote: RouteQuoteResult | null;
  reasonCode?: string;
  reasons: string[];
}

export interface SelectionResult {
  bestCandidate: CandidateRouteEvaluation | null;
  allCandidates: CandidateRouteEvaluation[];
  rankedTable: string;
  summary: string;
}

/**
 * Evaluates a single (collateral_j, debt_k) pair.
 */
export async function evaluatePairCandidate(
  position: UserPosition,
  collateral: CollateralAsset,
  debt: DebtAsset,
  policy: SelectionPolicy,
  quoter: IQuoter
): Promise<CandidateRouteEvaluation> {
  const reasons: string[] = [];

  // Whitelist check
  if (
    policy.allowedCollaterals &&
    !policy.allowedCollaterals.some(
      (a) => a.toLowerCase() === collateral.address.toLowerCase()
    )
  ) {
    return createInfeasibleCandidate(
      collateral,
      debt,
      'COLLATERAL_NOT_ALLOWED',
      [`Collateral ${collateral.symbol} is not in user policy allowed list.`]
    );
  }

  if (
    policy.allowedDebts &&
    !policy.allowedDebts.some(
      (a) => a.toLowerCase() === debt.address.toLowerCase()
    )
  ) {
    return createInfeasibleCandidate(
      collateral,
      debt,
      'DEBT_NOT_ALLOWED',
      [`Debt ${debt.symbol} is not in user policy allowed list.`]
    );
  }

  // 1. Solve the fixed-point (κ ↔ V) for this pair
  const fixedPoint = await solveKappaFixedPoint({
    A: position.totalRiskWeightedCollateralUsd,
    D: position.totalDebtUsd,
    targetHF: policy.targetHF,
    ltJ: collateral.lt,
    collateralToken: collateral.address,
    debtToken: debt.address,
    collateralPriceUsd: collateral.priceUsd,
    debtPriceUsd: debt.priceUsd,
    collateralDecimals: collateral.decimals,
    debtDecimals: debt.decimals,
    quoter,
    flashProvider: policy.flashProvider ?? 'AAVE',
    gasParams: policy.gasParams,
    maxCostBps: policy.maxCostBps,
    urgency: policy.urgency,
  });

  if (!fixedPoint.feasible || fixedPoint.releaseUsd <= 0) {
    return createInfeasibleCandidate(
      collateral,
      debt,
      'FIXED_POINT_INFEASIBLE',
      [fixedPoint.reason]
    );
  }

  // 2. Apply caps and clamps (§2.3)
  const clamped = clampDeleverageAmount(
    fixedPoint.releaseUsd,
    fixedPoint.kappa,
    {
      overshootPct: policy.overshootPct,
      collateralBalanceUsd: collateral.balanceUsd,
      maxReleasePerTxUsd: policy.maxReleasePerTxUsd ?? Number.POSITIVE_INFINITY,
      approvalRemainingUsd: collateral.approvalRemainingUsd,
      currentDebtUsd: debt.debtUsd,
    }
  );

  // 3. Compute units & post-intervention metrics
  const releaseUnits = BigInt(
    Math.round(
      (clamped.clampedReleaseUsd / collateral.priceUsd) *
        10 ** collateral.decimals
    )
  );
  const repayUnits = BigInt(
    Math.round((clamped.clampedRepayUsd / debt.priceUsd) * 10 ** debt.decimals)
  );

  // Real-world caps (balance, policy limit, approval allowance, debt cap)
  // can shrink the release/repay below what solveKappaFixedPoint originally
  // sized and quoted for. If we kept that stale, larger quote, its
  // minAmountOut would still target the ORIGINAL (larger) repay amount --
  // for an exact-output swap that's now asking for less output while still
  // requiring at least the old, higher output floor, a contradiction that
  // would revert on-chain. Re-quote for the actual clamped amount whenever
  // clamping changed it (relative epsilon, not absolute, so it also
  // triggers on small-position candidates where a few cents is material).
  let effectiveQuote = fixedPoint.quote;
  const repayShrunk =
    fixedPoint.repayUsd > 0 &&
    (fixedPoint.repayUsd - clamped.clampedRepayUsd) / fixedPoint.repayUsd > 1e-6;

  if (repayShrunk && clamped.clampedRepayUsd > 0) {
    try {
      effectiveQuote = await quoter.quoteRoute({
        tokenIn: collateral.address,
        tokenOut: debt.address,
        amountOut: repayUnits,
        tokenInPriceUsd: collateral.priceUsd,
        tokenOutPriceUsd: debt.priceUsd,
        tokenInDecimals: collateral.decimals,
        tokenOutDecimals: debt.decimals,
        urgency: policy.urgency,
      });
      reasons.push(
        `Re-quoted after clamping: release shrank from $${fixedPoint.releaseUsd.toFixed(2)} to $${clamped.clampedReleaseUsd.toFixed(2)}, so the original quote's minAmountOut (sized for the larger amount) was stale and has been refreshed.`,
      );
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return createInfeasibleCandidate(
        collateral,
        debt,
        'REQUOTE_AFTER_CLAMP_FAILED',
        [
          `Clamping shrank release to $${clamped.clampedReleaseUsd.toFixed(2)}, but re-quoting for the new amount failed: ${errMsg}`,
        ],
      );
    }
  }

  const postRemainingCollateralUsd = Math.max(
    0,
    collateral.balanceUsd - clamped.clampedReleaseUsd
  );
  const postRemainingCollateralRatio =
    collateral.balanceUsd > 0
      ? postRemainingCollateralUsd / collateral.balanceUsd
      : 0;

  // Recompute position HF after this intervention
  const postA = Math.max(
    0,
    position.totalRiskWeightedCollateralUsd -
      clamped.clampedReleaseUsd * collateral.lt
  );
  const postD = Math.max(0, position.totalDebtUsd - clamped.clampedRepayUsd);
  const resultingHF = postD > 0 ? postA / postD : Number.POSITIVE_INFINITY;

  reasons.push(fixedPoint.reason);
  reasons.push(clamped.diagnostics);

  const priceImpactBps = effectiveQuote?.priceImpactBps ?? 0;
  const totalCostUsd = clamped.capitalBurnedUsd + fixedPoint.gasUsd;

  return {
    collateral,
    debt,
    feasible: true,
    rank: 0, // Assigned after sorting all candidates
    vMin: clamped.vMin,
    clampedReleaseUsd: clamped.clampedReleaseUsd,
    releaseUnits,
    clampedRepayUsd: clamped.clampedRepayUsd,
    repayUnits,
    capitalBurnedUsd: clamped.capitalBurnedUsd,
    kappa: fixedPoint.kappa,
    kappaBps: fixedPoint.kappaBps,
    gasUsd: fixedPoint.gasUsd,
    totalCostUsd,
    priceImpactBps,
    postRemainingCollateralRatio,
    resultingHF,
    reachesTargetHF: clamped.reachesTargetHF,
    isConstrained: clamped.isConstrained,
    limitingFactor: clamped.limitingFactor,
    quote: effectiveQuote,
    reasons,
  };
}

function createInfeasibleCandidate(
  collateral: CollateralAsset,
  debt: DebtAsset,
  reasonCode: string,
  reasons: string[]
): CandidateRouteEvaluation {
  return {
    collateral,
    debt,
    feasible: false,
    rank: -1,
    vMin: 0,
    clampedReleaseUsd: 0,
    releaseUnits: 0n,
    clampedRepayUsd: 0,
    repayUnits: 0n,
    capitalBurnedUsd: 0,
    kappa: 0,
    kappaBps: 0,
    gasUsd: 0,
    totalCostUsd: 0,
    priceImpactBps: 0,
    postRemainingCollateralRatio: 1,
    resultingHF: 0,
    reachesTargetHF: false,
    isConstrained: false,
    limitingFactor: 'NONE',
    quote: null,
    reasonCode,
    reasons,
  };
}

/**
 * Evaluates and ranks all (collateral, debt) pairs for a user position (§3).
 *
 * Objective:
 *   minimise   capitalBurned(j, k) = V_j · κ_jk
 *   subject to H_t(1 − κ_jk) > LT_j
 *              V_j <= balance_j, allowance_j, policy caps
 *              repay_jk <= debt_k
 *
 * Tie-breakers (§3.3):
 *   1. Diversification: prefer higher post-intervention remaining collateral ratio
 *   2. Price impact: prefer shallower price impact (more headroom)
 *   3. Debt balance: prefer larger debt balance (fewer future interventions)
 *
 * @param position - User position with collaterals and debts
 * @param policy - Selection constraints and preferences
 * @param quoter - Route quoter
 * @returns SelectionResult with ranked candidates and formatted comparison table
 */
export async function selectBestIntervention(
  position: UserPosition,
  policy: SelectionPolicy,
  quoter: IQuoter
): Promise<SelectionResult> {
  const evaluations: CandidateRouteEvaluation[] = [];

  // Evaluate all (collateral, debt) pairs (bounded at top 4 collaterals x top 2 debts)
  const collaterals = position.collaterals.slice(0, 4);
  const debts = position.debts.slice(0, 2);

  for (const collateral of collaterals) {
    for (const debt of debts) {
      const evaluation = await evaluatePairCandidate(
        position,
        collateral,
        debt,
        policy,
        quoter
      );
      evaluations.push(evaluation);
    }
  }

  // Separate feasible vs infeasible candidates
  const feasibleList = evaluations.filter((e) => e.feasible);
  const infeasibleList = evaluations.filter((e) => !e.feasible);

  // Sort feasible candidates by primary objective and tie-breakers (§3.3)
  feasibleList.sort((a, b) => {
    // 0. A candidate whose release/repay got capped below vMin by a
    // real-world constraint (balance, policy limit, approval allowance,
    // debt cap) does not actually restore the position to targetHF -- it
    // just spent less because it did less. Releasing near-zero collateral
    // is "cheap" but useless, so a fully-working candidate must always
    // outrank a partial one regardless of cost; only rank by cost within
    // each group.
    if (a.reachesTargetHF !== b.reachesTargetHF) {
      return a.reachesTargetHF ? -1 : 1;
    }

    // 1. Primary: minimize capital burned (V * κ)
    const costDiff = a.capitalBurnedUsd - b.capitalBurnedUsd;
    if (Math.abs(costDiff) > 0.05) {
      // 5 cent threshold for clear cost difference
      return costDiff;
    }

    // 2. Tie-break 1: Portfolio diversification (preserve collateral balance)
    const ratioDiff =
      b.postRemainingCollateralRatio - a.postRemainingCollateralRatio;
    if (Math.abs(ratioDiff) > 0.02) {
      return ratioDiff;
    }

    // 3. Tie-break 2: Shallower price impact
    const impactDiff = a.priceImpactBps - b.priceImpactBps;
    if (impactDiff !== 0) {
      return impactDiff;
    }

    // 4. Tie-break 3: Largest debt balance
    return b.debt.debtUsd - a.debt.debtUsd;
  });

  // Assign ranks
  feasibleList.forEach((item, index) => {
    item.rank = index + 1;
  });
  infeasibleList.forEach((item) => {
    item.rank = -1;
  });

  const allCandidates = [...feasibleList, ...infeasibleList];
  const bestCandidate = feasibleList[0] ?? null;

  // Generate formatted ASCII ranking table (§3.3 & OVERVIEW.md §5)
  const rankedTable = formatRankedTable(allCandidates);

  const summary = bestCandidate
    ? `Selected Best Intervention: [${bestCandidate.collateral.symbol} -> ${bestCandidate.debt.symbol}] releasing $${bestCandidate.clampedReleaseUsd.toFixed(2)} (${bestCandidate.collateral.symbol}) to repay $${bestCandidate.clampedRepayUsd.toFixed(2)} (${bestCandidate.debt.symbol}) with friction cost $${bestCandidate.capitalBurnedUsd.toFixed(2)} (${(bestCandidate.kappa * 100).toFixed(2)}%).`
    : 'No feasible collateral-debt intervention route found matching policy.';

  return {
    bestCandidate,
    allCandidates,
    rankedTable,
    summary,
  };
}

/**
 * Formats a clean ASCII comparison table for CLI output and dashboard logging.
 */
export function formatRankedTable(
  candidates: CandidateRouteEvaluation[]
): string {
  const rows: string[] = [
    '=========================================================================================================',
    ' Rank | Collateral | Debt  |  LT   |  κ (bps)  |  V Req ($)  |  Repay ($)  | Capital Burned | Status     ',
    '------|------------|-------|-------|-----------|-------------|-------------|----------------|------------',
  ];

  for (const c of candidates) {
    if (c.feasible) {
      const rankStr = `${c.rank}`.padStart(4, ' ');
      const colStr = c.collateral.symbol.padEnd(10, ' ');
      const debtStr = c.debt.symbol.padEnd(5, ' ');
      const ltStr = c.collateral.lt.toFixed(3).padStart(5, ' ');
      const kappaStr = `${c.kappaBps} bps`.padStart(9, ' ');
      const vStr = `$${c.clampedReleaseUsd.toFixed(2)}`.padStart(11, ' ');
      const repayStr = `$${c.clampedRepayUsd.toFixed(2)}`.padStart(11, ' ');
      const burnStr = `$${c.capitalBurnedUsd.toFixed(2)}`.padStart(14, ' ');
      const statusStr = (c.rank === 1 ? 'BEST CHOICE' : 'Feasible').padEnd(10, ' ');

      rows.push(
        ` ${rankStr} | ${colStr} | ${debtStr} | ${ltStr} | ${kappaStr} | ${vStr} | ${repayStr} | ${burnStr} | ${statusStr} `
      );
    } else {
      const rankStr = ' -- '.padStart(4, ' ');
      const colStr = c.collateral.symbol.padEnd(10, ' ');
      const debtStr = c.debt.symbol.padEnd(5, ' ');
      const ltStr = c.collateral.lt.toFixed(3).padStart(5, ' ');
      const kappaStr = '  --     ';
      const vStr = '   --      ';
      const repayStr = '   --      ';
      const burnStr = '     --       ';
      const statusStr = (c.reasonCode ?? 'Infeasible').padEnd(10, ' ');

      rows.push(
        ` ${rankStr} | ${colStr} | ${debtStr} | ${ltStr} | ${kappaStr} | ${vStr} | ${repayStr} | ${burnStr} | ${statusStr} `
      );
    }
  }

  rows.push(
    '========================================================================================================='
  );

  return rows.join('\n');
}
