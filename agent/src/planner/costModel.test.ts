import { describe, it, expect } from 'vitest';
import {
  FLASH_LOAN_PREMIUMS,
  estimateGasCostUsd,
  solveKappaFixedPoint,
} from './costModel.js';
import {
  KNOWN_TOKENS,
  SimulatedQuoter,
  generateRouteCandidates,
  type IQuoter,
  type QuoteRouteParams,
  type RouteQuoteResult,
} from './quoter.js';
import { recomputeHealthFactor } from './sizing.js';

/**
 * Mock quoter whose effectiveCostFraction alternates between two values on
 * successive calls, so consecutive kappa estimates never settle within the
 * 1e-5 convergence tolerance -- deliberately forces solveKappaFixedPoint to
 * exhaust maxIterations without ever converging, while staying well under
 * maxCostBps so the in-loop divergence guard never fires either. This is
 * the one code path (loop exhausted, never converged, never diverged) that
 * previously mis-reported `iterations` by one.
 */
class OscillatingCostQuoter implements IQuoter {
  private callCount = 0;

  async quoteRoute(params: QuoteRouteParams): Promise<RouteQuoteResult> {
    this.callCount++;
    const costFraction = this.callCount % 2 === 0 ? 0.010 : 0.011;
    const candidate = generateRouteCandidates(params.tokenIn, params.tokenOut)[0]!;

    const amountOutUsd =
      params.amountOut !== undefined
        ? (Number(params.amountOut) / 10 ** params.tokenOutDecimals) * params.tokenOutPriceUsd
        : 19000;
    const amountInUsd = amountOutUsd / (1 - costFraction);
    const amountOut = params.amountOut ?? 19000000000n;
    const amountIn = BigInt(
      Math.round((amountInUsd / params.tokenInPriceUsd) * 10 ** params.tokenInDecimals),
    );

    return {
      route: candidate,
      amountIn,
      amountOut,
      amountInUsd,
      amountOutUsd,
      gasEstimate: 200000n,
      ticksCrossed: 10,
      effectiveCostFraction: costFraction,
      priceImpactBps: Math.round(costFraction * 10000),
      slippageToleranceBps: 20,
      minAmountOut: (amountOut * 9980n) / 10000n,
      isThinLiquidity: false,
      diagnostics: 'Oscillating mock quote',
    };
  }
}

describe('Cost Model & Fixed-Point Solver (costModel.ts)', () => {
  const quoter = new SimulatedQuoter(5, 5_000_000); // 5 bps base fee, $5M pool depth

  describe('Flash Loan Premiums & Gas Estimation', () => {
    it('returns exact protocol flash loan premiums (Aave 5 bps, Balancer 0 bps)', () => {
      expect(FLASH_LOAN_PREMIUMS.AAVE).toBe(0.0005);
      expect(FLASH_LOAN_PREMIUMS.BALANCER).toBe(0.0);
    });

    it('estimates gas cost accurately with 1.25x safety multiplier (§4.4)', () => {
      // 350k gas @ 20 gwei, ETH @ $3,000 with 1.25x multiplier = $26.25
      const gasUsd = estimateGasCostUsd({
        gasEstimate: 350000n,
        baseFeeGwei: 20,
        ethPriceUsd: 3000,
        safetyMultiplier: 1.25,
      });

      expect(gasUsd).toBeCloseTo(26.25, 2);
    });
  });

  describe('κ ↔ V Fixed-Point Loop Convergence (§3.2 & §9 Item 6)', () => {
    it('converges in <= 5 iterations on the WETH reference position (§3.2)', async () => {
      const A = 24750;
      const D = 19000;
      const targetHF = 1.35;
      const ltWETH = 0.825;

      const result = await solveKappaFixedPoint({
        A,
        D,
        targetHF,
        ltJ: ltWETH,
        collateralToken: KNOWN_TOKENS.WETH,
        debtToken: KNOWN_TOKENS.USDC,
        collateralPriceUsd: 3000,
        debtPriceUsd: 1,
        collateralDecimals: 18,
        debtDecimals: 6,
        quoter,
        flashProvider: 'AAVE',
        gasParams: { gasEstimate: 350000n, baseFeeGwei: 20, ethPriceUsd: 3000 },
        maxIterations: 5,
      });

      expect(result.feasible).toBe(true);
      expect(result.converged).toBe(true);
      expect(result.iterations).toBeLessThanOrEqual(5);
      expect(result.releaseUsd).toBeGreaterThan(1600);
      expect(result.repayUsd).toBeGreaterThan(1600);

      // Recomputed HF matches targetHF
      const hfAfter = recomputeHealthFactor(
        A,
        D,
        result.releaseUsd,
        ltWETH,
        result.kappa
      );
      expect(hfAfter).toBeCloseTo(targetHF, 4);
    });

    it('converges in <= 5 iterations across 5 different test position sizes (§9 Item 6)', async () => {
      const debtSizes = [5000, 19000, 50000, 100000, 250000];

      for (const debt of debtSizes) {
        const initialHF = 1.15;
        const targetHF = 1.35;
        const lt = 0.80;
        const A = initialHF * debt;

        const result = await solveKappaFixedPoint({
          A,
          D: debt,
          targetHF,
          ltJ: lt,
          collateralToken: KNOWN_TOKENS.WETH,
          debtToken: KNOWN_TOKENS.USDC,
          collateralPriceUsd: 3000,
          debtPriceUsd: 1,
          collateralDecimals: 18,
          debtDecimals: 6,
          quoter,
          maxIterations: 5,
        });

        expect(result.feasible).toBe(true);
        expect(result.converged).toBe(true);
        expect(result.iterations).toBeLessThanOrEqual(5);

        // Verification of mathematical consistency
        const hfAfter = recomputeHealthFactor(
          A,
          debt,
          result.releaseUsd,
          lt,
          result.kappa
        );
        expect(hfAfter).toBeCloseTo(targetHF, 4);
      }
    });
  });

  describe('Divergence & Policy Guarding (§3.2 & §4.4)', () => {
    it('flags route as infeasible when small position makes gas friction exceed maxCostBps (§4.4)', async () => {
      // $500 debt position where $26.25 gas creates >5% friction
      const result = await solveKappaFixedPoint({
        A: 550,
        D: 500,
        targetHF: 1.35,
        ltJ: 0.80,
        collateralToken: KNOWN_TOKENS.WETH,
        debtToken: KNOWN_TOKENS.USDC,
        collateralPriceUsd: 3000,
        debtPriceUsd: 1,
        collateralDecimals: 18,
        debtDecimals: 6,
        quoter,
        maxCostBps: 500, // 5% max cost policy
      });

      expect(result.feasible).toBe(false);
      expect(result.reason).toContain('policy exceeded');
    });

    it('flags route as infeasible when thin liquidity causes excessive slippage', async () => {
      // Thin pool ($10k liquidity) causing massive price impact on $19k trade
      const illiquidQuoter = new SimulatedQuoter(30, 10_000);

      const result = await solveKappaFixedPoint({
        A: 24750,
        D: 19000,
        targetHF: 1.35,
        ltJ: 0.825,
        collateralToken: KNOWN_TOKENS.WETH,
        debtToken: KNOWN_TOKENS.USDC,
        collateralPriceUsd: 3000,
        debtPriceUsd: 1,
        collateralDecimals: 18,
        debtDecimals: 6,
        quoter: illiquidQuoter,
        maxCostBps: 300, // 3% max cost policy
      });

      expect(result.feasible).toBe(false);
      expect(result.converged).toBe(false);
      expect(result.reason).toContain('policy exceeded');
    });

    it('reports exactly maxIterations (not maxIterations + 1) when the loop exhausts without converging or diverging (regression)', async () => {
      const oscillatingQuoter = new OscillatingCostQuoter();

      const result = await solveKappaFixedPoint({
        A: 24750,
        D: 19000,
        targetHF: 1.35,
        ltJ: 0.825,
        collateralToken: KNOWN_TOKENS.WETH,
        debtToken: KNOWN_TOKENS.USDC,
        collateralPriceUsd: 3000,
        debtPriceUsd: 1,
        collateralDecimals: 18,
        debtDecimals: 6,
        quoter: oscillatingQuoter,
        maxIterations: 5,
        maxCostBps: 5000, // 50% -- generous enough that the 1.0-1.1% oscillation never trips it
      });

      // The oscillating quoter never lets consecutive kappa estimates settle
      // within tolerance, so the loop must run all 5 rounds without breaking.
      expect(result.converged).toBe(false);
      expect(result.iterations).toBe(5); // previously reported 6 (off-by-one)
      expect(result.reason).toContain('Reached max 5 iterations');
    });

    it('returns infeasible if position is already healthy', async () => {
      const result = await solveKappaFixedPoint({
        A: 30000, // HF = 30000 / 19000 = 1.579 > targetHF 1.35
        D: 19000,
        targetHF: 1.35,
        ltJ: 0.825,
        collateralToken: KNOWN_TOKENS.WETH,
        debtToken: KNOWN_TOKENS.USDC,
        collateralPriceUsd: 3000,
        debtPriceUsd: 1,
        collateralDecimals: 18,
        debtDecimals: 6,
        quoter,
      });

      expect(result.feasible).toBe(false);
      expect(result.releaseUsd).toBe(0);
      expect(result.reason).toContain('Already healthy');
    });
  });
});
