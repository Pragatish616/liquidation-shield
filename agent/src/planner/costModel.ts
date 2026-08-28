import { type Address } from 'viem';
import { sizeDeleverage, type DeleverageSizingResult } from './sizing.js';
import { isDeleverageFeasible } from './feasibility.js';
import { type IQuoter, type RouteQuoteResult } from './quoter.js';

export type FlashLoanProvider = 'AAVE' | 'BALANCER';

/** Flash loan premium rates: Aave = 0.05% (5 bps), Balancer = 0% */
export const FLASH_LOAN_PREMIUMS: Record<FlashLoanProvider, number> = {
  AAVE: 0.0005, // 5 bps
  BALANCER: 0.0, // 0 bps
};

export interface GasModelParams {
  /** Simulated or estimated gas units (default: 350,000) */
  gasEstimate?: bigint | undefined;
  /** Current base fee in Gwei (default: 20 Gwei) */
  baseFeeGwei?: number | undefined;
  /** Current ETH price in USD (default: $3,000) */
  ethPriceUsd?: number | undefined;
  /** Safety buffer multiplier (default: 1.25x per §4.4) */
  safetyMultiplier?: number | undefined;
}

export interface SolveKappaFixedPointParams {
  /** Risk-weighted collateral value A in USD */
  A: number;
  /** Total debt value D in USD */
  D: number;
  /** Target health factor H_t */
  targetHF: number;
  /** Liquidation threshold LT_j of the selected collateral asset */
  ltJ: number;
  /** Collateral token address */
  collateralToken: Address;
  /** Debt token address */
  debtToken: Address;
  /** Price of collateral in USD */
  collateralPriceUsd: number;
  /** Price of debt token in USD */
  debtPriceUsd: number;
  /** Decimals of collateral token */
  collateralDecimals: number;
  /** Decimals of debt token */
  debtDecimals: number;
  /** Quoter instance (live UniswapV3Quoter or SimulatedQuoter) */
  quoter: IQuoter;
  /** Chosen flash loan provider (default: 'AAVE') */
  flashProvider?: FlashLoanProvider | undefined;
  /** Explicit flash loan premium override (default: from provider) */
  flashPremiumFraction?: number | undefined;
  /** Gas estimation parameters */
  gasParams?: GasModelParams | undefined;
  /** Initial kappa seed for iteration (default: 0.005 = 50 bps) */
  kappaSeed?: number | undefined;
  /** Max iterations before capping (default: 5 per §3.2) */
  maxIterations?: number | undefined;
  /** Convergence tolerance (default: 1e-5) */
  tolerance?: number | undefined;
  /** Max allowable total cost in basis points before marking route infeasible (e.g. 500 bps = 5%) */
  maxCostBps?: number | undefined;
  /** Urgency level for slippage tolerance */
  urgency?: 'LOW' | 'MEDIUM' | 'HIGH' | undefined;
}

export interface FixedPointResult {
  /** True if fixed-point iteration converged and meets feasibility & cost policy */
  feasible: boolean;
  /** True if loop converged within maxIterations and tolerance */
  converged: boolean;
  /** Total number of iteration rounds executed */
  iterations: number;
  /** Final converged round-trip friction fraction κ */
  kappa: number;
  /** Total friction in basis points */
  kappaBps: number;
  /** Collateral release amount in USD */
  releaseUsd: number;
  /** Repayment amount in USD */
  repayUsd: number;
  /** Total friction loss in USD (V * κ) */
  capitalBurnedUsd: number;
  /** Total gas cost in USD */
  gasUsd: number;
  /** Flash loan fee in USD */
  flashFeeUsd: number;
  /** Swap friction in USD */
  swapCostUsd: number;
  /** Winning DEX route quote */
  quote: RouteQuoteResult | null;
  /** Diagnostic trace across iteration rounds */
  history: Array<{ round: number; kappa: number; releaseUsd: number; nextKappa: number }>;
  /** Status explanation */
  reason: string;
}

/**
 * Calculates estimated gas cost in USD with safety multiplier.
 *
 * Formula (§4.4):
 *   gasUsd = gasEstimate · baseFee · ethPriceUsd · multiplier
 */
export function estimateGasCostUsd(params?: GasModelParams): number {
  const gasEstimate = params?.gasEstimate ?? 350000n;
  const baseFeeGwei = params?.baseFeeGwei ?? 20;
  const ethPriceUsd = params?.ethPriceUsd ?? 3000;
  const multiplier = params?.safetyMultiplier ?? 1.25;

  const gasUnits = Number(gasEstimate);
  const baseFeeEth = (baseFeeGwei * 1e9) / 1e18; // Gwei to ETH
  const totalEth = gasUnits * baseFeeEth * multiplier;
  return totalEth * ethPriceUsd;
}

/**
 * Solves the circular dependency between execution friction κ and sizing amount V (§3.2).
 *
 * Formula:
 *   κ = flashPremium + swapFeeTier + slippage(V) + (gasUsd / V)
 *
 * Iterates up to 5 rounds, checking for convergence (|κ_next - κ| < 1e-5).
 * Guards against divergence on illiquid pairs and enforces policy.maxCostBps.
 *
 * @param params - SolveKappaFixedPointParams
 * @returns FixedPointResult
 */
export async function solveKappaFixedPoint(
  params: SolveKappaFixedPointParams
): Promise<FixedPointResult> {
  const flashPremium =
    params.flashPremiumFraction ??
    FLASH_LOAN_PREMIUMS[params.flashProvider ?? 'AAVE'];
  const maxIterations = params.maxIterations ?? 5;
  const tolerance = params.tolerance ?? 1e-5;
  const maxCostBps = params.maxCostBps ?? 500; // 500 bps = 5.0%
  const gasUsd = estimateGasCostUsd(params.gasParams);

  let kappa = params.kappaSeed ?? 0.005;
  let sizing: DeleverageSizingResult = {
    feasible: false,
    releaseUsd: 0,
    repayUsd: 0,
    capitalBurnedUsd: 0,
  };
  let bestQuote: RouteQuoteResult | null = null;
  let converged = false;
  let iteration = 0;
  const history: FixedPointResult['history'] = [];

  for (iteration = 0; iteration < maxIterations; iteration++) {
    // 1. Feasibility check with current kappa estimate
    if (!isDeleverageFeasible(params.targetHF, params.ltJ, kappa)) {
      return {
        feasible: false,
        converged: false,
        iterations: iteration + 1,
        kappa,
        kappaBps: Math.round(kappa * 10000),
        releaseUsd: 0,
        repayUsd: 0,
        capitalBurnedUsd: 0,
        gasUsd,
        flashFeeUsd: 0,
        swapCostUsd: 0,
        quote: null,
        history,
        reason: `Infeasible: friction κ (${(kappa * 100).toFixed(2)}%) violates feasibility condition H_t(1 - κ) > LT_j (${params.ltJ.toFixed(3)}).`,
      };
    }

    // 2. Size the intervention with current kappa estimate
    sizing = sizeDeleverage(
      params.A,
      params.D,
      params.targetHF,
      params.ltJ,
      kappa
    );

    if (!sizing.feasible || sizing.releaseUsd <= 0) {
      return {
        feasible: false,
        converged: false,
        iterations: iteration + 1,
        kappa,
        kappaBps: Math.round(kappa * 10000),
        releaseUsd: 0,
        repayUsd: 0,
        capitalBurnedUsd: 0,
        gasUsd,
        flashFeeUsd: 0,
        swapCostUsd: 0,
        quote: null,
        history,
        reason: sizing.reason ?? 'Position already healthy or sizing infeasible.',
      };
    }

    // 3. Query the route quoter for the exact required debt repayment
    const repayDebtUnits = BigInt(
      Math.round(
        (sizing.repayUsd / params.debtPriceUsd) * 10 ** params.debtDecimals
      )
    );

    let quote: RouteQuoteResult;
    try {
      quote = await params.quoter.quoteRoute({
        tokenIn: params.collateralToken,
        tokenOut: params.debtToken,
        amountOut: repayDebtUnits,
        tokenInPriceUsd: params.collateralPriceUsd,
        tokenOutPriceUsd: params.debtPriceUsd,
        tokenInDecimals: params.collateralDecimals,
        tokenOutDecimals: params.debtDecimals,
        urgency: params.urgency,
      });
      bestQuote = quote;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        feasible: false,
        converged: false,
        iterations: iteration + 1,
        kappa,
        kappaBps: Math.round(kappa * 10000),
        releaseUsd: sizing.releaseUsd,
        repayUsd: sizing.repayUsd,
        capitalBurnedUsd: sizing.capitalBurnedUsd,
        gasUsd,
        flashFeeUsd: 0,
        swapCostUsd: 0,
        quote: null,
        history,
        reason: `Quoting failed: ${errMsg}`,
      };
    }

    // 4. Update kappa: flash fee + effective swap friction + gas friction
    const gasFriction = gasUsd / sizing.releaseUsd;
    const nextKappa = flashPremium + quote.effectiveCostFraction + gasFriction;

    history.push({
      round: iteration + 1,
      kappa,
      releaseUsd: sizing.releaseUsd,
      nextKappa,
    });

    // Check divergence guard: if cost blows past policy max, reject route
    if (nextKappa * 10000 > maxCostBps) {
      return {
        feasible: false,
        converged: false,
        iterations: iteration + 1,
        kappa: nextKappa,
        kappaBps: Math.round(nextKappa * 10000),
        releaseUsd: sizing.releaseUsd,
        repayUsd: sizing.repayUsd,
        capitalBurnedUsd: sizing.releaseUsd * nextKappa,
        gasUsd,
        flashFeeUsd: sizing.releaseUsd * flashPremium,
        swapCostUsd: sizing.releaseUsd * quote.effectiveCostFraction,
        quote: bestQuote,
        history,
        reason: `Divergence / cost policy exceeded: round-trip cost ${(nextKappa * 100).toFixed(2)}% (${Math.round(nextKappa * 10000)} bps) exceeds policy max ${maxCostBps} bps.`,
      };
    }

    // Check convergence condition
    if (Math.abs(nextKappa - kappa) < tolerance) {
      kappa = nextKappa;
      converged = true;
      break;
    }

    kappa = nextKappa;
  }

  // Final sizing pass with converged kappa
  const finalSizing = sizeDeleverage(
    params.A,
    params.D,
    params.targetHF,
    params.ltJ,
    kappa
  );

  const flashFeeUsd = finalSizing.releaseUsd * flashPremium;
  const swapCostUsd = bestQuote
    ? finalSizing.releaseUsd * bestQuote.effectiveCostFraction
    : 0;

  // When the loop exhausts maxIterations without converging (no `break`),
  // the for-loop's own increment leaves `iteration` already equal to
  // maxIterations (it ran maxIterations times, for iteration = 0..maxIterations-1),
  // so `iteration + 1` over-reports by one round that never executed. Clamping
  // to maxIterations keeps the break-early case (iteration+1 already <= maxIterations)
  // unaffected while fixing the exhausted case.
  const reportedIterations = Math.min(iteration + 1, maxIterations);

  return {
    feasible: finalSizing.feasible,
    converged,
    iterations: reportedIterations,
    kappa,
    kappaBps: Math.round(kappa * 10000),
    releaseUsd: finalSizing.releaseUsd,
    repayUsd: finalSizing.repayUsd,
    capitalBurnedUsd: finalSizing.capitalBurnedUsd,
    gasUsd,
    flashFeeUsd,
    swapCostUsd,
    quote: bestQuote,
    history,
    reason: converged
      ? `Converged in ${reportedIterations} iterations to κ = ${(kappa * 100).toFixed(3)}% (${Math.round(kappa * 10000)} bps).`
      : `Reached max ${maxIterations} iterations with κ = ${(kappa * 100).toFixed(3)}%.`,
  };
}
