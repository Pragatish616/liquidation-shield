import { describe, it, expect } from 'vitest';
import {
  isDeleverageFeasible,
  checkDeleverageFeasibility,
  clampDeleverageAmount,
  type DeleverageLimits,
} from './feasibility.js';

describe('Feasibility Engine (feasibility.ts)', () => {
  describe('Feasibility Guard (§2.2: H_t(1 − κ) > LT)', () => {
    it('flags LT-0.90 collateral as infeasible for plan worked example (H_t=1.10, κ=0.20 -> bound 0.88)', () => {
      const targetHF = 1.10;
      const kappa = 0.20;
      const ltInfeasible = 0.90;

      // Boolean guard
      expect(isDeleverageFeasible(targetHF, ltInfeasible, kappa)).toBe(false);

      // Detailed diagnostics check
      const check = checkDeleverageFeasibility(targetHF, ltInfeasible, kappa);
      expect(check.feasible).toBe(false);
      expect(check.bound).toBeCloseTo(0.88, 4);
      expect(check.ltJ).toBe(0.90);
      expect(check.reason).toContain('Infeasible collateral');
      expect(check.reason).toContain('bound 0.8800 <= LT (0.9000)');
    });

    it('flags LT-0.85 collateral as feasible for same H_t=1.10, κ=0.20', () => {
      const targetHF = 1.10;
      const kappa = 0.20;
      const ltFeasible = 0.85;

      expect(isDeleverageFeasible(targetHF, ltFeasible, kappa)).toBe(true);

      const check = checkDeleverageFeasibility(targetHF, ltFeasible, kappa);
      expect(check.feasible).toBe(true);
      expect(check.bound).toBeCloseTo(0.88, 4);
      expect(check.ltJ).toBe(0.85);
      expect(check.reason).toContain('Feasible collateral');
    });

    it('evaluates spec examples from §2.2 correctly', () => {
      // H_t = 1.35, kappa = 1% -> bound = 1.3365
      const res1 = checkDeleverageFeasibility(1.35, 0.825, 0.01);
      expect(res1.feasible).toBe(true);
      expect(res1.bound).toBeCloseTo(1.3365, 4);

      // H_t = 1.05, kappa = 3% -> bound = 1.0185
      const res2 = checkDeleverageFeasibility(1.05, 0.825, 0.03);
      expect(res2.feasible).toBe(true);
      expect(res2.bound).toBeCloseTo(1.0185, 4);

      // Boundary condition: bound == LT exactly
      const resBoundary = checkDeleverageFeasibility(1.00, 0.80, 0.20); // 1.00 * 0.80 = 0.80 == LT
      expect(resBoundary.feasible).toBe(false);
    });
  });

  describe('Caps and Clamps (§2.3)', () => {
    const vMin = 1761.86;
    const kappa = 0.0105; // 1.05%

    const baseLimits: DeleverageLimits = {
      overshootPct: 0.01, // 1% overshoot
      collateralBalanceUsd: 30000,
      maxReleasePerTxUsd: 10000,
      approvalRemainingUsd: 10000,
      currentDebtUsd: 19000,
    };

    it('applies overshootPct when unconstrained', () => {
      const result = clampDeleverageAmount(vMin, kappa, baseLimits);

      const expectedTarget = vMin * 1.01; // ~1779.4786
      expect(result.vMin).toBe(vMin);
      expect(result.vTarget).toBeCloseTo(expectedTarget, 2);
      expect(result.clampedReleaseUsd).toBeCloseTo(expectedTarget, 2);
      expect(result.clampedRepayUsd).toBeCloseTo(expectedTarget * (1 - kappa), 2);
      expect(result.capitalBurnedUsd).toBeCloseTo(expectedTarget * kappa, 2);
      expect(result.isConstrained).toBe(false);
      expect(result.limitingFactor).toBe('NONE');
      expect(result.reachesTargetHF).toBe(true);
      expect(result.diagnostics).toContain('Unconstrained');
    });

    it('clamps by collateralBalanceUsd when balance is insufficient for full target', () => {
      const limits: DeleverageLimits = {
        ...baseLimits,
        collateralBalanceUsd: 1500, // less than vMin 1761.86
      };

      const result = clampDeleverageAmount(vMin, kappa, limits);
      expect(result.clampedReleaseUsd).toBe(1500);
      expect(result.isConstrained).toBe(true);
      expect(result.limitingFactor).toBe('COLLATERAL_BALANCE');
      expect(result.reachesTargetHF).toBe(false); // cannot fully reach targetHF
      expect(result.diagnostics).toContain('Severely constrained by COLLATERAL_BALANCE');
    });

    it('clamps by policy.maxReleasePerTxUsd (blast radius protection)', () => {
      const limits: DeleverageLimits = {
        ...baseLimits,
        maxReleasePerTxUsd: 1200,
      };

      const result = clampDeleverageAmount(vMin, kappa, limits);
      expect(result.clampedReleaseUsd).toBe(1200);
      expect(result.isConstrained).toBe(true);
      expect(result.limitingFactor).toBe('POLICY_MAX_RELEASE');
      expect(result.reachesTargetHF).toBe(false);
    });

    it('clamps by approvalRemainingUsd (aToken allowance granted to shield)', () => {
      const limits: DeleverageLimits = {
        ...baseLimits,
        approvalRemainingUsd: 1770, // above vMin 1761.86 but below vTarget 1779.48
      };

      const result = clampDeleverageAmount(vMin, kappa, limits);
      expect(result.clampedReleaseUsd).toBe(1770);
      expect(result.isConstrained).toBe(true);
      expect(result.limitingFactor).toBe('APPROVAL_ALLOWANCE');
      expect(result.reachesTargetHF).toBe(true); // >= vMin
      expect(result.diagnostics).toContain('still meets vMin');
    });

    it('enforces debt cap (repayUsd <= currentDebtUsd)', () => {
      const smallDebtLimits: DeleverageLimits = {
        ...baseLimits,
        currentDebtUsd: 500, // position only has $500 debt left
      };

      const result = clampDeleverageAmount(vMin, kappa, smallDebtLimits);
      const maxReleaseForDebt = 500 / (1 - kappa); // ~505.30
      expect(result.clampedReleaseUsd).toBeCloseTo(maxReleaseForDebt, 2);
      expect(result.clampedRepayUsd).toBeCloseTo(500, 2);
      expect(result.clampedRepayUsd).toBeLessThanOrEqual(500);
      expect(result.limitingFactor).toBe('DEBT_CAP');
    });
  });
});
