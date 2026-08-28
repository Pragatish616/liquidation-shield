import { describe, it, expect } from 'vitest';
import { type Address } from 'viem';
import {
  selectBestIntervention,
  evaluatePairCandidate,
  type UserPosition,
  type CollateralAsset,
  type DebtAsset,
  type SelectionPolicy,
} from './selection.js';
import {
  KNOWN_TOKENS,
  type IQuoter,
  type QuoteRouteParams,
  type RouteQuoteResult,
  generateRouteCandidates,
  SimulatedQuoter,
} from './quoter.js';
import { solveKappaFixedPoint } from './costModel.js';

/** Custom Mock Quoter that returns specific fees matching OVERVIEW.md §5 */
class MockComparisonQuoter implements IQuoter {
  private readonly assetCosts: Record<string, number> = {
    [KNOWN_TOKENS.USDC.toLowerCase()]: 0.0050, // 0.50% swap + 0.05% flash = 0.55% (55 bps)
    [KNOWN_TOKENS.WETH.toLowerCase()]: 0.0100, // 1.00% swap + 0.05% flash = 1.05% (105 bps)
    [KNOWN_TOKENS.WBTC.toLowerCase()]: 0.0120, // 1.20% swap + 0.05% flash = 1.25% (125 bps)
    [KNOWN_TOKENS.wstETH.toLowerCase()]: 0.0160, // 1.60% swap + 0.05% flash = 1.65% (165 bps)
  };

  async quoteRoute(params: QuoteRouteParams): Promise<RouteQuoteResult> {
    const costFraction = this.assetCosts[params.tokenIn.toLowerCase()] ?? 0.01;
    const candidates = generateRouteCandidates(params.tokenIn, params.tokenOut);
    const candidate = candidates[0]!;

    const amountOutUsd =
      params.amountOut !== undefined
        ? (Number(params.amountOut) / 10 ** params.tokenOutDecimals) * params.tokenOutPriceUsd
        : 19000;

    const amountInUsd = amountOutUsd / (1 - costFraction);
    const amountIn = BigInt(
      Math.round((amountInUsd / params.tokenInPriceUsd) * 10 ** params.tokenInDecimals)
    );
    const amountOut = params.amountOut ?? 19000000000n;

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
      diagnostics: 'Mock quote',
    };
  }
}

describe('Collateral & Debt Selection Engine (selection.ts)', () => {
  const quoter = new MockComparisonQuoter();

  // Position setup matching OVERVIEW.md §5:
  // Initial position: 10 WETH ($30k collateral, LT = 0.825 -> A = 24,750), $19,000 USDC debt
  const collaterals: CollateralAsset[] = [
    {
      address: KNOWN_TOKENS.USDC,
      symbol: 'USDC',
      decimals: 6,
      priceUsd: 1,
      lt: 0.86,
      balance: 50000000000n, // $50k USDC
      balanceUsd: 50000,
      approvalRemainingUsd: 50000,
      aTokenAddress: '0x9bA00D6856a4eE463b7e0EC600E526D46C52163b' as Address,
    },
    {
      address: KNOWN_TOKENS.WETH,
      symbol: 'WETH',
      decimals: 18,
      priceUsd: 3000,
      lt: 0.825,
      balance: 10000000000000000000n, // 10 WETH ($30k)
      balanceUsd: 30000,
      approvalRemainingUsd: 30000,
      aTokenAddress: '0x4d5F47FA6A74757f35C14fD3a6Ef8E3C973157fb' as Address,
    },
    {
      address: KNOWN_TOKENS.WBTC,
      symbol: 'WBTC',
      decimals: 8,
      priceUsd: 60000,
      lt: 0.78,
      balance: 100000000n, // 1 WBTC ($60k)
      balanceUsd: 60000,
      approvalRemainingUsd: 60000,
      aTokenAddress: '0x078f358208685046a11C85e8ad32895DED33A249' as Address,
    },
    {
      address: KNOWN_TOKENS.wstETH,
      symbol: 'wstETH',
      decimals: 18,
      priceUsd: 3500,
      lt: 0.79,
      balance: 10000000000000000000n, // 10 wstETH ($35k)
      balanceUsd: 35000,
      approvalRemainingUsd: 35000,
      aTokenAddress: '0x12B54025C112866c37a4d6f45266854F27F23dFE' as Address,
    },
  ];

  const debt: DebtAsset = {
    address: KNOWN_TOKENS.USDC,
    symbol: 'USDC',
    decimals: 6,
    priceUsd: 1,
    debt: 19000000000n, // $19,000 USDC
    debtUsd: 19000,
  };

  const position: UserPosition = {
    user: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' as Address,
    collaterals,
    debts: [debt],
    totalCollateralUsd: 30000,
    totalRiskWeightedCollateralUsd: 24750, // A = 24,750
    totalDebtUsd: 19000, // D = 19,000
    currentHF: 24750 / 19000, // 1.3026
  };

  const policy: SelectionPolicy = {
    targetHF: 1.35,
    maxCostBps: 500,
    gasParams: { baseFeeGwei: 0 }, // Zero gas to isolate pure sizing & swap friction
  };

  describe('4-Asset Selection Comparison (§3.3, §10.2, and OVERVIEW.md §5)', () => {
    it('ranks all 4 collaterals and selects USDC as argmin capitalBurned', async () => {
      const result = await selectBestIntervention(position, policy, quoter);

      expect(result.bestCandidate).not.toBeNull();
      expect(result.bestCandidate!.collateral.symbol).toBe('USDC');
      expect(result.bestCandidate!.rank).toBe(1);

      // Verify the 4 candidates in ranked order
      const rankedSymbols = result.allCandidates.map((c) => c.collateral.symbol);
      expect(rankedSymbols).toEqual(['USDC', 'WETH', 'WBTC', 'wstETH']);

      // 1. USDC: V ≈ $1,865, Burn ≈ $10.26
      const usdc = result.allCandidates[0]!;
      expect(Math.round(usdc.clampedReleaseUsd)).toBe(1865);
      expect(usdc.capitalBurnedUsd).toBeCloseTo(10.26, 1);
      expect(usdc.rank).toBe(1);

      // 2. WETH: V ≈ $1,762, Burn ≈ $18.50
      const weth = result.allCandidates[1]!;
      expect(Math.round(weth.clampedReleaseUsd)).toBe(1762);
      expect(weth.capitalBurnedUsd).toBeCloseTo(18.50, 1);
      expect(weth.rank).toBe(2);

      // 3. WBTC: V ≈ $1,627, Burn ≈ $20.34
      // Crucial insight from spec: WBTC requires the lowest V ($1,627) but ranks 3rd due to higher friction
      const wbtc = result.allCandidates[2]!;
      expect(Math.round(wbtc.clampedReleaseUsd)).toBe(1627);
      expect(wbtc.capitalBurnedUsd).toBeCloseTo(20.34, 1);
      expect(wbtc.clampedReleaseUsd).toBeLessThan(usdc.clampedReleaseUsd);
      expect(wbtc.clampedReleaseUsd).toBeLessThan(weth.clampedReleaseUsd);
      expect(wbtc.capitalBurnedUsd).toBeGreaterThan(weth.capitalBurnedUsd);
      expect(wbtc.rank).toBe(3);

      // 4. wstETH: V ≈ $1,674, Burn ≈ $27.62
      const wsteth = result.allCandidates[3]!;
      expect(Math.round(wsteth.clampedReleaseUsd)).toBe(1674);
      expect(wsteth.capitalBurnedUsd).toBeCloseTo(27.62, 1);
      expect(wsteth.rank).toBe(4);

      // Print and verify ASCII table format
      expect(result.rankedTable).toContain('Rank | Collateral | Debt');
      expect(result.rankedTable).toContain('USDC');
      expect(result.rankedTable).toContain('WETH');
      expect(result.rankedTable).toContain('WBTC');
      expect(result.rankedTable).toContain('wstETH');
      expect(result.rankedTable).toContain('BEST CHOICE');
    });
  });

  describe('Policy Whitelisting & Infeasible Pair Handling (§3.3 & §10.3)', () => {
    it('excludes collaterals not in user whitelist with stated reason', async () => {
      const restrictedPolicy: SelectionPolicy = {
        ...policy,
        allowedCollaterals: [KNOWN_TOKENS.WETH], // Only WETH allowed
      };

      const result = await selectBestIntervention(position, restrictedPolicy, quoter);

      // WETH must be selected because USDC is whitelisted out
      expect(result.bestCandidate!.collateral.symbol).toBe('WETH');
      expect(result.bestCandidate!.rank).toBe(1);

      // USDC, WBTC, wstETH should be marked infeasible
      const usdc = result.allCandidates.find((c) => c.collateral.symbol === 'USDC')!;
      expect(usdc.feasible).toBe(false);
      expect(usdc.reasonCode).toBe('COLLATERAL_NOT_ALLOWED');
    });

    it('marks thin liquidity / high cost pairs as infeasible', async () => {
      const tightPolicy: SelectionPolicy = {
        ...policy,
        maxCostBps: 110, // 1.10% max cost policy -> excludes WBTC (1.25%) and wstETH (1.65%)
      };

      const result = await selectBestIntervention(position, tightPolicy, quoter);

      const feasibleSymbols = result.allCandidates.filter((c) => c.feasible).map((c) => c.collateral.symbol);
      expect(feasibleSymbols).toEqual(['USDC', 'WETH']);

      const wbtc = result.allCandidates.find((c) => c.collateral.symbol === 'WBTC')!;
      expect(wbtc.feasible).toBe(false);
      expect(wbtc.reasonCode).toBe('FIXED_POINT_INFEASIBLE');
    });
  });

  describe('Multi-Debt Position Handling', () => {
    it('evaluates all (collateral, debt) combinations when user has multiple borrow assets', async () => {
      const multiDebtPosition: UserPosition = {
        ...position,
        debts: [
          debt, // $19,000 USDC
          {
            address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' as Address,
            symbol: 'USDT',
            decimals: 6,
            priceUsd: 1,
            debt: 5000000000n, // $5,000 USDT
            debtUsd: 5000,
          },
        ],
      };

      const result = await selectBestIntervention(multiDebtPosition, policy, quoter);
      // 4 collaterals x 2 debts = 8 evaluated pairs
      expect(result.allCandidates.length).toBe(8);
      expect(result.bestCandidate).not.toBeNull();
    });
  });

  describe('Ranking Prefers Functional Candidates Over Cheap-But-Useless Ones (regression)', () => {
    it('never selects a severely-capped candidate that cannot reach targetHF just because it is cheap', async () => {
      // USDC is normally the argmin-cost winner here (see the 4-asset test
      // above: burn ~$10.26 vs WETH's ~$18.50). Crippling its approval to
      // $5 makes it release almost nothing -- capitalBurnedUsd near zero,
      // which would win a pure cost sort -- but it does essentially none of
      // the job (reachesTargetHF: false). WETH, fully approved, must win.
      const crippledCollaterals = collaterals.map((c) =>
        c.symbol === 'USDC' ? { ...c, approvalRemainingUsd: 5 } : c,
      );
      const crippledPosition: UserPosition = { ...position, collaterals: crippledCollaterals };

      const result = await selectBestIntervention(crippledPosition, policy, quoter);

      const usdc = result.allCandidates.find((c) => c.collateral.symbol === 'USDC')!;
      expect(usdc.feasible).toBe(true); // clamped, not an error
      expect(usdc.reachesTargetHF).toBe(false);
      expect(usdc.capitalBurnedUsd).toBeLessThan(0.1); // would win on cost alone

      expect(result.bestCandidate).not.toBeNull();
      expect(result.bestCandidate!.collateral.symbol).not.toBe('USDC');
      expect(result.bestCandidate!.reachesTargetHF).toBe(true);
      expect(result.bestCandidate!.rank).toBe(1);

      // The crippled candidate is still reported (for diagnostics/ranking
      // table visibility) but must rank behind every fully-working one.
      const usdcRank = result.allCandidates.findIndex((c) => c.collateral.symbol === 'USDC');
      const bestRank = result.allCandidates.findIndex(
        (c) => c.collateral.symbol === result.bestCandidate!.collateral.symbol,
      );
      expect(usdcRank).toBeGreaterThan(bestRank);
    });
  });

  describe('Stale Quote After Clamping (regression)', () => {
    // vMin for WETH here is ~$1,761.86 (see sizing.test.ts's worked example).
    // A tight maxReleasePerTxUsd well below that forces clampDeleverageAmount
    // to shrink the release far below what solveKappaFixedPoint originally
    // sized and quoted for.
    const simQuoter = new SimulatedQuoter(5, 5_000_000);
    const constrainedPolicy: SelectionPolicy = {
      targetHF: 1.35,
      maxCostBps: 500,
      maxReleasePerTxUsd: 500, // well below the ~$1,761.86 unclamped vMin
      gasParams: { baseFeeGwei: 0 },
    };

    it('re-quotes for the clamped amount so minAmountOut stays consistent with the actual repay amount', async () => {
      const weth = collaterals.find((c) => c.symbol === 'WETH')!;

      const candidate = await evaluatePairCandidate(
        position,
        weth,
        debt,
        constrainedPolicy,
        simQuoter,
      );

      expect(candidate.feasible).toBe(true);
      expect(candidate.isConstrained).toBe(true);
      expect(candidate.limitingFactor).toBe('POLICY_MAX_RELEASE');
      // Confirms clamping actually kicked in (release capped well below vMin).
      expect(candidate.clampedReleaseUsd).toBeCloseTo(500, 2);
      expect(candidate.reachesTargetHF).toBe(false);

      // The critical on-chain-safety invariant: the swap's guaranteed
      // minimum output must never exceed the amount we're actually asking
      // the flash-loan repayment to use, or the transaction cannot succeed.
      expect(candidate.quote).not.toBeNull();
      expect(candidate.repayUnits).toBeGreaterThanOrEqual(candidate.quote!.minAmountOut);

      // The quote's own target output should match the CLAMPED repay units,
      // proving it was re-derived for the actual amount rather than reused
      // from the original (larger) unclamped sizing pass.
      expect(candidate.quote!.amountOut).toBe(candidate.repayUnits);

      expect(candidate.reasons.some((r) => r.includes('Re-quoted after clamping'))).toBe(true);
    });

    it('does NOT re-quote when clamping does not change the amount (no wasted quoter call)', async () => {
      const weth = collaterals.find((c) => c.symbol === 'WETH')!;

      function makeCountingQuoter(): { quoter: IQuoter; count: () => number } {
        let calls = 0;
        return {
          quoter: {
            async quoteRoute(params: QuoteRouteParams): Promise<RouteQuoteResult> {
              calls++;
              return simQuoter.quoteRoute(params);
            },
          },
          count: () => calls,
        };
      }

      const unconstrainedPolicy: SelectionPolicy = {
        targetHF: 1.35,
        maxCostBps: 500,
        gasParams: { baseFeeGwei: 0 },
      };

      // Baseline: however many times solveKappaFixedPoint alone calls the
      // quoter while converging, with no clamping involved at all.
      const baseline = makeCountingQuoter();
      await solveKappaFixedPoint({
        A: position.totalRiskWeightedCollateralUsd,
        D: position.totalDebtUsd,
        targetHF: unconstrainedPolicy.targetHF,
        ltJ: weth.lt,
        collateralToken: weth.address,
        debtToken: debt.address,
        collateralPriceUsd: weth.priceUsd,
        debtPriceUsd: debt.priceUsd,
        collateralDecimals: weth.decimals,
        debtDecimals: debt.decimals,
        quoter: baseline.quoter,
        maxCostBps: unconstrainedPolicy.maxCostBps,
        gasParams: unconstrainedPolicy.gasParams,
      });

      // Full path: evaluatePairCandidate under the SAME unconstrained
      // policy (so clamping changes nothing) should call the quoter
      // exactly as many times as the fixed-point solver alone did --
      // proving no extra re-quote call was made.
      const full = makeCountingQuoter();
      const candidate = await evaluatePairCandidate(
        position,
        weth,
        debt,
        unconstrainedPolicy,
        full.quoter,
      );

      expect(candidate.feasible).toBe(true);
      expect(candidate.isConstrained).toBe(false);
      expect(candidate.reasons.some((r) => r.includes('Re-quoted after clamping'))).toBe(false);
      expect(full.count()).toBe(baseline.count());
    });
  });
});
