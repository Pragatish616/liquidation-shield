import { describe, it, expect } from 'vitest';
import { type Address } from 'viem';
import {
  evaluateViability,
  calculateCloseFactor,
  type ViabilityInputs,
} from './viability.js';
import {
  type CandidateRouteEvaluation,
  type UserPosition,
  type CollateralAsset,
  type DebtAsset,
} from './selection.js';
import { KNOWN_TOKENS } from './quoter.js';

describe('Viability Gate & Overrides (viability.ts)', () => {
  const dummyCollateral: CollateralAsset = {
    address: KNOWN_TOKENS.WETH,
    symbol: 'WETH',
    decimals: 18,
    priceUsd: 3000,
    lt: 0.825,
    balance: 10000000000000000000n,
    balanceUsd: 30000,
    approvalRemainingUsd: 30000,
    aTokenAddress: '0x4d5F47FA6A74757f35C14fD3a6Ef8E3C973157fb' as Address,
  };

  const dummyDebt: DebtAsset = {
    address: KNOWN_TOKENS.USDC,
    symbol: 'USDC',
    decimals: 6,
    priceUsd: 1,
    debt: 19000000000n,
    debtUsd: 19000,
  };

  const basePosition: UserPosition = {
    user: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' as Address,
    collaterals: [dummyCollateral],
    debts: [dummyDebt],
    totalCollateralUsd: 30000,
    totalRiskWeightedCollateralUsd: 24750,
    totalDebtUsd: 19000,
    currentHF: 1.3026,
  };

  const baseCandidate: CandidateRouteEvaluation = {
    collateral: dummyCollateral,
    debt: dummyDebt,
    feasible: true,
    rank: 1,
    vMin: 1761.86,
    clampedReleaseUsd: 1761.86,
    releaseUnits: 587286666666666666n,
    clampedRepayUsd: 1743.36,
    repayUnits: 1743360000n,
    // capitalBurnedUsd is the all-in cost (kappa's gasFriction term already
    // folds in the $26.25 gasUsd below -- $18.50 swap/flash friction +
    // $26.25 gas = $44.75). gasUsd stays a separate field for display only.
    capitalBurnedUsd: 44.75,
    kappa: 0.0105,
    kappaBps: 105,
    gasUsd: 26.25,
    totalCostUsd: 44.75,
    priceImpactBps: 100,
    postRemainingCollateralRatio: 0.941,
    resultingHF: 1.35,
    reachesTargetHF: true,
    isConstrained: false,
    limitingFactor: 'NONE',
    quote: null,
    maxAmountIn: 587286666666666666n,
    reasons: ['Valid route quote'],
  };

  describe('Dynamic Close Factor (§5)', () => {
    it('returns 1.0 (100%) when HF < 0.95 or total debt < $2,000 (dust bound)', () => {
      expect(calculateCloseFactor(0.92, 10000)).toBe(1.0); // HF < 0.95
      expect(calculateCloseFactor(1.10, 1500)).toBe(1.0); // D < $2,000
      expect(calculateCloseFactor(1.20, 19000)).toBe(0.5); // Normal position
    });
  });

  describe('Acceptance Criteria §10.4: Small Position ($300 debt) on High Gas Returns HOLD', () => {
    it('returns HOLD with arithmetic explanation showing expected loss < intervention cost', () => {
      const smallPosition: UserPosition = {
        ...basePosition,
        totalDebtUsd: 300,
        currentHF: 1.08,
      };

      const smallCandidate: CandidateRouteEvaluation = {
        ...baseCandidate,
        clampedReleaseUsd: 100,
        // All-in: $1.05 swap/flash friction + $25.00 gas = $26.05.
        capitalBurnedUsd: 26.05,
        gasUsd: 25.0, // High gas cost ($25) relative to position size
        totalCostUsd: 26.05,
      };

      const inputs: ViabilityInputs = {
        position: smallPosition,
        candidate: smallCandidate,
        pLiq: 0.40, // 40% probability of liquidation
        liquidationBonus: 1.05, // 5% liquidation bonus
      };

      const result = evaluateViability(inputs);

      expect(result.verdict).toBe('HOLD');
      expect(result.isOverride).toBe(false);
      expect(result.reasonCode).toBe('INSUFFICIENT_NET_BENEFIT');

      // Expected loss: 0.40 * 1.0 (closeFactor for $300 dust) * 300 * 0.05 = $6.00
      expect(result.expectedLossIfIdleUsd).toBeCloseTo(6.00, 2);

      // Expected cost: capitalBurnedUsd, already all-in ($1.05 friction +
      // $25.00 gas = $26.05) -- must not be gasUsd added a second time.
      expect(result.expectedCostOfActionUsd).toBeCloseTo(26.05, 2);

      // Net benefit: $6.00 - $26.05 = -$20.05
      expect(result.netBenefitUsd).toBeCloseTo(-20.05, 2);

      // Human-readable explanation matches spec requirements
      expect(result.reasons[0]).toContain('held: expected liquidation loss $6.00 < intervention cost $26.05');
    });
  });

  describe('Acceptance Criteria §10.5: Crashed Position (HF = 0.98) Returns EXECUTE via Override', () => {
    it('executes immediately under critical HF < 1.0 override regardless of cost gate', () => {
      const crashedPosition: UserPosition = {
        ...basePosition,
        currentHF: 0.98, // Liquidatable position
      };

      // Candidate with very high cost that would fail a normal net benefit check
      const expensiveCandidate: CandidateRouteEvaluation = {
        ...baseCandidate,
        capitalBurnedUsd: 600, // all-in: $500 friction + $100 gas
        gasUsd: 100,
        totalCostUsd: 600,
      };

      const inputs: ViabilityInputs = {
        position: crashedPosition,
        candidate: expensiveCandidate,
        pLiq: 0.05, // Low pLiq would normally suggest HOLD
      };

      const result = evaluateViability(inputs);

      expect(result.verdict).toBe('EXECUTE');
      expect(result.isOverride).toBe(true);
      expect(result.overrideType).toBe('CRASHED_HF_EXECUTE');
      expect(result.reasonCode).toBe('CRITICAL_HF_OVERRIDE');
      expect(result.reasons[0]).toContain('Position is actively liquidatable. Executing emergency intervention immediately');
    });
  });

  describe('Hard Override 2: Cost Policy Exceeded (§5 Item 2)', () => {
    it('returns REFUSE when friction fraction exceeds policy maxCostBps', () => {
      const highCostCandidate: CandidateRouteEvaluation = {
        ...baseCandidate,
        kappa: 0.065, // 6.5% round trip cost
        kappaBps: 650, // 650 bps
      };

      const inputs: ViabilityInputs = {
        position: { ...basePosition, currentHF: 1.05 },
        candidate: highCostCandidate,
        pLiq: 0.90,
        policy: { maxCostBps: 500 }, // 500 bps (5.0%) max
      };

      const result = evaluateViability(inputs);

      expect(result.verdict).toBe('REFUSE');
      expect(result.isOverride).toBe(true);
      expect(result.overrideType).toBe('MAX_COST_REFUSE');
      expect(result.reasonCode).toBe('COST_POLICY_EXCEEDED');
      expect(result.reasons[0]).toContain('exceeds policy maximum 500 bps');
    });
  });

  describe('Hard Override 3: No Feasible Candidate (§5 Item 3)', () => {
    it('returns REFUSE with machine-readable reason when candidate is null or infeasible', () => {
      const inputs: ViabilityInputs = {
        position: { ...basePosition, currentHF: 1.05 },
        candidate: null,
        pLiq: 0.80,
      };

      const result = evaluateViability(inputs);

      expect(result.verdict).toBe('REFUSE');
      expect(result.isOverride).toBe(true);
      expect(result.overrideType).toBe('NO_FEASIBLE_ROUTE_REFUSE');
      expect(result.reasonCode).toBe('NO_FEASIBLE_ROUTE');
    });
  });

  describe('Normal Viable Execution (§5)', () => {
    it('returns EXECUTE when expected loss significantly exceeds intervention cost', () => {
      const inputs: ViabilityInputs = {
        position: { ...basePosition, currentHF: 1.05 }, // Pre-liquidation warning zone
        candidate: baseCandidate,
        pLiq: 0.85, // 85% probability of hitting threshold
        liquidationBonus: 1.05,
      };

      const result = evaluateViability(inputs);

      expect(result.verdict).toBe('EXECUTE');
      expect(result.isOverride).toBe(false);
      expect(result.reasonCode).toBe('POSITIVE_NET_BENEFIT');

      // Expected loss: 0.85 * 0.5 * 19000 * 0.05 = $403.75
      expect(result.expectedLossIfIdleUsd).toBeCloseTo(403.75, 2);

      // Expected cost: capitalBurnedUsd, already all-in ($18.50 friction +
      // $26.25 gas = $44.75) -- must not be gasUsd added a second time.
      expect(result.expectedCostOfActionUsd).toBeCloseTo(44.75, 2);

      // Net benefit: $403.75 - $44.75 = $359.00
      expect(result.netBenefitUsd).toBeCloseTo(359.00, 2);
    });
  });
});
