import { describe, it, expect } from 'vitest';
import { type Address } from 'viem';
import {
  generateInterventionPlan,
} from './plan.js';
import {
  type UserPosition,
  type CollateralAsset,
  type DebtAsset,
} from './selection.js';
import { KNOWN_TOKENS, SimulatedQuoter } from './quoter.js';

describe('Intervention Plan Assembly (plan.ts)', () => {
  const quoter = new SimulatedQuoter(5, 5_000_000);

  const colWETH: CollateralAsset = {
    address: KNOWN_TOKENS.WETH,
    symbol: 'WETH',
    decimals: 18,
    priceUsd: 3000,
    lt: 0.825,
    balance: 10000000000000000000n, // 10 WETH ($30k)
    balanceUsd: 30000,
    approvalRemainingUsd: 30000,
    aTokenAddress: '0x4d5F47FA6A74757f35C14fD3a6Ef8E3C973157fb' as Address,
  };

  const debtUSDC: DebtAsset = {
    address: KNOWN_TOKENS.USDC,
    symbol: 'USDC',
    decimals: 6,
    priceUsd: 1,
    debt: 19000000000n, // $19,000 USDC
    debtUsd: 19000,
  };

  const position: UserPosition = {
    user: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' as Address,
    collaterals: [colWETH],
    debts: [debtUSDC],
    totalCollateralUsd: 30000,
    totalRiskWeightedCollateralUsd: 24750,
    totalDebtUsd: 19000,
    currentHF: 24750 / 19000,
  };

  it('assembles a complete Mode B DELEVERAGE plan matching §6 specification', async () => {
    const plan = await generateInterventionPlan(position, {
      targetHF: 1.35,
      pLiq: 0.85,
      quoter,
      flashProvider: 'AAVE',
    });

    // 1. On-chain execution fields
    expect(plan.user).toBe(position.user);
    expect(plan.mode).toBe('DELEVERAGE');
    expect(plan.collateralAsset).toBe(KNOWN_TOKENS.WETH);
    expect(plan.aToken).toBe(colWETH.aTokenAddress);
    expect(plan.debtAsset).toBe(KNOWN_TOKENS.USDC);
    expect(plan.releaseAmount).toBeGreaterThan(0n);
    expect(plan.repayAmount).toBeGreaterThan(0n);
    expect(plan.flashProvider).toBe('AAVE');
    expect(plan.flashAmount).toBe(plan.repayAmount);
    expect(plan.flashPremium).toBeGreaterThan(0n);
    expect(plan.swapPath.startsWith('0x')).toBe(true);
    expect(plan.maxAmountIn).toBeGreaterThan(0n);
    expect(plan.targetHF).toBe(1350000000000000000n); // 1.35 * 1e18
    expect(plan.deadline).toBeGreaterThan(0n);

    // 2. Off-chain diagnostics
    expect(plan.kappaBps).toBeGreaterThan(0);
    expect(plan.capitalBurnedUsd).toBeGreaterThan(0);
    expect(plan.verdict).toBe('EXECUTE');
    expect(plan.ranking.length).toBeGreaterThan(0);
    expect(plan.rankedTable).toContain('Rank | Collateral | Debt');
  });

  it('assembles a Mode A EXTERNAL_REPAY plan when covered by external reserve (§2.1)', async () => {
    const plan = await generateInterventionPlan(position, {
      targetHF: 1.35,
      pLiq: 0.85,
      quoter,
      externalReserveUsd: 1000, // Reserve covers $666.67 R_min
    });

    expect(plan.mode).toBe('EXTERNAL_REPAY');
    expect(plan.releaseAmount).toBe(0n);
    expect(plan.swapPath).toBe('0x');
    expect(plan.maxAmountIn).toBe(0n);
    expect(plan.repayAmount).toBeGreaterThan(0n);
    expect(plan.verdict).toBe('EXECUTE');
    expect(plan.reasonCode).toBe('EXTERNAL_RESERVE_REPAY');
    expect(plan.capitalBurnedUsd).toBe(0); // Zero swap friction
  });

  describe('Gas Is Not Double-Counted End-to-End (regression)', () => {
    // Every other test in this suite (and selection.test.ts, simulate.test.ts)
    // sets gasParams: { baseFeeGwei: 0 } to isolate sizing/swap mechanics --
    // which also means none of them could ever have caught kappa's gas
    // friction term being summed a second time downstream. This test uses
    // the realistic DEFAULT gas params (350,000 gas, 20 gwei, $3,000 ETH,
    // 1.25x safety multiplier -- costModel.ts's own defaults, unmodified) so
    // gasUsd is genuinely nonzero end-to-end through costModel -> selection
    // -> viability, and asserts the actual dollar figures a user would see.
    it('reports capitalBurnedUsd and the derived total cost as the same all-in figure, not capitalBurnedUsd + gasUsd twice', async () => {
      const plan = await generateInterventionPlan(position, {
        targetHF: 1.35,
        pLiq: 0.85,
        quoter,
        flashProvider: 'AAVE',
        // No gasParams override -- realistic nonzero gas.
      });

      expect(plan.verdict).toBe('EXECUTE');
      expect(plan.gasUsd).toBeCloseTo(26.25, 2);

      // capitalBurnedUsd is the all-in friction figure (kappa's own
      // gasFriction term already folds gas in at the costModel.ts level).
      expect(plan.capitalBurnedUsd).toBeCloseTo(28.35, 2);

      // InterventionPlan doesn't expose expectedCostOfActionUsd directly,
      // but netBenefitUsd = expectedLossIfIdleUsd - expectedCostOfActionUsd
      // (viability.ts), so it can be recovered exactly. Before the fix this
      // was capitalBurnedUsd + gasUsd = 28.35 + 26.25 = $54.60; the correct,
      // non-double-counted figure is capitalBurnedUsd alone, $28.35.
      const impliedCostOfAction = plan.expectedLossIfIdleUsd - plan.netBenefitUsd;
      expect(impliedCostOfAction).toBeCloseTo(28.35, 2);
      expect(impliedCostOfAction).toBeCloseTo(plan.capitalBurnedUsd, 6);
      expect(impliedCostOfAction).not.toBeCloseTo(plan.capitalBurnedUsd + plan.gasUsd, 2);
    });
  });
});
