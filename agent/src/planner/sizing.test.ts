import { describe, it, expect } from 'vitest';
import {
  sizeDeleverage,
  sizeExternalRepay,
  recomputeHealthFactor,
} from './sizing.js';

describe('Sizing Solver (sizing.ts)', () => {
  describe('Worked Example from OVERVIEW.md §5 and §10.1', () => {
    // Reference position: 10 WETH @ $3,000 ($30,000), LT = 0.825 -> A = 24,750
    // Total debt: $19,000 USDC -> D = 19,000
    // Current HF: 24,750 / 19,000 = 1.30263...
    // Target HF: 1.35
    // Friction kappa: 1.05% (0.0105)
    const A = 24750;
    const D = 19000;
    const targetHF = 1.35;
    const ltWETH = 0.825;
    const kappaWETH = 0.0105;

    it('reproduces Mode B deleveraging sizing for WETH (V ≈ $1,762, Repay ≈ $1,743, Burn ≈ $18.50)', () => {
      const result = sizeDeleverage(A, D, targetHF, ltWETH, kappaWETH);

      expect(result.feasible).toBe(true);
      // V_min = (1.35 * 19000 - 24750) / (1.35 * (1 - 0.0105) - 0.825)
      //       = 900 / 0.510825 = 1761.8558...
      expect(result.releaseUsd).toBeCloseTo(1761.86, 2);
      expect(Math.round(result.releaseUsd)).toBe(1762);

      // Repay = V * (1 - kappa) = 1761.8558 * 0.9895 = 1743.356...
      expect(result.repayUsd).toBeCloseTo(1743.36, 2);
      expect(Math.round(result.repayUsd)).toBe(1743);

      // Capital burned = V * kappa = 1761.8558 * 0.0105 = 18.499...
      expect(result.capitalBurnedUsd).toBeCloseTo(18.50, 2);

      // Recomputed HF should exactly equal 1.35
      const hfAfter = recomputeHealthFactor(A, D, result.releaseUsd, ltWETH, kappaWETH);
      expect(hfAfter).toBeCloseTo(targetHF, 6);
    });

    it('reproduces collateral selection comparison table from OVERVIEW.md §5', () => {
      // USDC: LT = 0.86, kappa = 0.55%
      const usdc = sizeDeleverage(A, D, targetHF, 0.86, 0.0055);
      expect(usdc.feasible).toBe(true);
      expect(Math.round(usdc.releaseUsd)).toBe(1865);
      expect(usdc.capitalBurnedUsd).toBeCloseTo(10.26, 2);

      // WBTC: LT = 0.78, kappa = 1.25%
      const wbtc = sizeDeleverage(A, D, targetHF, 0.78, 0.0125);
      expect(wbtc.feasible).toBe(true);
      expect(Math.round(wbtc.releaseUsd)).toBe(1627);
      expect(wbtc.capitalBurnedUsd).toBeCloseTo(20.34, 2);

      // wstETH: LT = 0.79, kappa = 1.65%
      const wsteth = sizeDeleverage(A, D, targetHF, 0.79, 0.0165);
      expect(wsteth.feasible).toBe(true);
      expect(Math.round(wsteth.releaseUsd)).toBe(1674);
      expect(wsteth.capitalBurnedUsd).toBeCloseTo(27.62, 2);

      // Verify that USDC burns least capital, even though WBTC requires least collateral released
      expect(wbtc.releaseUsd).toBeLessThan(wsteth.releaseUsd);
      expect(wbtc.releaseUsd).toBeLessThan(usdc.releaseUsd);
      expect(usdc.capitalBurnedUsd).toBeLessThan(wbtc.capitalBurnedUsd);
    });

    it('reproduces Mode A external repay sizing (R_min ≈ $666.67)', () => {
      const result = sizeExternalRepay(A, D, targetHF);
      expect(result.feasible).toBe(true);
      // R_min = 19000 - 24750 / 1.35 = 666.666...
      expect(result.repayUsd).toBeCloseTo(666.67, 2);

      // Recomputed HF: A / (D - R_min) == targetHF
      const hfAfter = A / (D - result.repayUsd);
      expect(hfAfter).toBeCloseTo(targetHF, 6);
    });
  });

  describe('Property Test (§9 Item 2): random valid parameters satisfy targetHF', () => {
    it('restores HF to targetHF within floating point tolerance across 1,000 random cases', () => {
      let testedCount = 0;
      for (let i = 0; testedCount < 1000 && i < 10000; i++) {
        // Random parameters within realistic DeFi ranges
        const debt = 500 + Math.random() * 100000; // $500 to $100k
        const lt = 0.65 + Math.random() * 0.20; // 0.65 to 0.85
        const kappa = 0.002 + Math.random() * 0.04; // 0.2% to 4.2%

        // Minimum HF to ensure repayUsd < debt: currentHF > LT / (1 - kappa)
        const minValidHF = lt / (1 - kappa) + 0.02;
        const currentHF = minValidHF + Math.random() * 0.30;
        const targetHF = currentHF + 0.05 + Math.random() * 0.30;

        // Check if denominator is positive (feasible)
        const denom = targetHF * (1 - kappa) - lt;
        if (denom <= 1e-4) {
          continue;
        }

        const A = currentHF * debt;
        const res = sizeDeleverage(A, debt, targetHF, lt, kappa);
        expect(res.feasible).toBe(true);
        expect(res.releaseUsd).toBeGreaterThan(0);
        expect(res.repayUsd).toBeGreaterThan(0);
        expect(res.repayUsd).toBeLessThan(debt); // Partial repayment
        expect(res.capitalBurnedUsd).toBeGreaterThan(0);

        // Recompute HF after intervention
        const hfAfter = recomputeHealthFactor(A, debt, res.releaseUsd, lt, kappa);
        expect(hfAfter).toBeCloseTo(targetHF, 5);
        testedCount++;
      }
      expect(testedCount).toBe(1000);
    });
  });

  describe('Already Healthy Positions', () => {
    it('returns feasible: false when current HF already >= targetHF in Mode B', () => {
      const A = 30000; // HF = 30000 / 19000 = 1.579
      const D = 19000;
      const targetHF = 1.35;
      const lt = 0.825;
      const kappa = 0.0105;

      const result = sizeDeleverage(A, D, targetHF, lt, kappa);
      expect(result.feasible).toBe(false);
      expect(result.releaseUsd).toBe(0);
      expect(result.repayUsd).toBe(0);
      expect(result.capitalBurnedUsd).toBe(0);
      expect(result.reason).toContain('Already healthy');
    });

    it('returns feasible: false when current HF already >= targetHF in Mode A', () => {
      const A = 30000;
      const D = 19000;
      const targetHF = 1.35;

      const result = sizeExternalRepay(A, D, targetHF);
      expect(result.feasible).toBe(false);
      expect(result.repayUsd).toBe(0);
      expect(result.reason).toContain('Already healthy');
    });
  });

  describe('Boundary & Edge Cases', () => {
    it('returns feasible: false when denominator <= 0 (H_t * (1 - κ) <= LT)', () => {
      // targetHF = 1.10, kappa = 0.20 -> bound = 0.88. LT = 0.90 -> denom = -0.02
      const result = sizeDeleverage(20000, 22000, 1.10, 0.90, 0.20);
      expect(result.feasible).toBe(false);
      expect(result.releaseUsd).toBe(0);
      expect(result.reason).toContain('Infeasible: denominator');
    });

    it('returns feasible: false for invalid inputs (negative/zero values)', () => {
      expect(sizeDeleverage(-100, 1000, 1.35, 0.80, 0.01).feasible).toBe(true); // A can be low
      expect(sizeDeleverage(1000, -100, 1.35, 0.80, 0.01).feasible).toBe(false);
      expect(sizeDeleverage(1000, 1000, 0, 0.80, 0.01).feasible).toBe(false);
      expect(sizeDeleverage(1000, 1000, 1.35, 1.5, 0.01).feasible).toBe(false); // LT >= 1
      expect(sizeDeleverage(1000, 1000, 1.35, 0.80, 1.2).feasible).toBe(false); // kappa >= 1

      expect(sizeExternalRepay(1000, -100, 1.35).feasible).toBe(false);
      expect(sizeExternalRepay(-100, 1000, 1.35).feasible).toBe(false);
    });
  });
});
