import { describe, it, expect } from 'vitest';
import { type Address } from 'viem';
import { generateInterventionPlan } from './plan.js';
import { simulatePlanExecution } from './simulate.js';
import { type UserPosition } from './selection.js';
import { KNOWN_TOKENS, SimulatedQuoter } from './quoter.js';

describe('Simulation Dry-Run Harness (simulate.ts)', () => {
  const quoter = new SimulatedQuoter(5, 10_000_000);

  // 5 Seeded positions per §10.6
  const seededPositions: Array<{ name: string; position: UserPosition; targetHF: number }> = [
    {
      name: 'Seed 1: Standard WETH / USDC position (OVERVIEW §5)',
      targetHF: 1.35,
      position: {
        user: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' as Address,
        collaterals: [
          {
            address: KNOWN_TOKENS.WETH,
            symbol: 'WETH',
            decimals: 18,
            priceUsd: 3000,
            lt: 0.825,
            balance: 10000000000000000000n, // $30k
            balanceUsd: 30000,
            approvalRemainingUsd: 30000,
            aTokenAddress: '0x4d5F47FA6A74757f35C14fD3a6Ef8E3C973157fb' as Address,
          },
        ],
        debts: [
          {
            address: KNOWN_TOKENS.USDC,
            symbol: 'USDC',
            decimals: 6,
            priceUsd: 1,
            debt: 19000000000n, // $19k
            debtUsd: 19000,
          },
        ],
        totalCollateralUsd: 30000,
        totalRiskWeightedCollateralUsd: 24750,
        totalDebtUsd: 19000,
        currentHF: 24750 / 19000, // 1.3026
      },
    },
    {
      name: 'Seed 2: Large WBTC position with tighter target',
      targetHF: 1.25,
      position: {
        user: '0x28C6c06298d514Db089934071355E5743bf21d60' as Address,
        collaterals: [
          {
            address: KNOWN_TOKENS.WBTC,
            symbol: 'WBTC',
            decimals: 8,
            priceUsd: 60000,
            lt: 0.78,
            balance: 100000000n, // $60k
            balanceUsd: 60000,
            approvalRemainingUsd: 60000,
            aTokenAddress: '0x078f358208685046a11C85e8ad32895DED33A249' as Address,
          },
        ],
        debts: [
          {
            address: KNOWN_TOKENS.USDC,
            symbol: 'USDC',
            decimals: 6,
            priceUsd: 1,
            debt: 40000000000n, // $40k
            debtUsd: 40000,
          },
        ],
        totalCollateralUsd: 60000,
        totalRiskWeightedCollateralUsd: 46800,
        totalDebtUsd: 40000,
        currentHF: 46800 / 40000, // 1.17
      },
    },
    {
      name: 'Seed 3: Liquid Staking wstETH position',
      targetHF: 1.30,
      position: {
        user: '0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8' as Address,
        collaterals: [
          {
            address: KNOWN_TOKENS.wstETH,
            symbol: 'wstETH',
            decimals: 18,
            priceUsd: 3500,
            lt: 0.79,
            balance: 3000000000000000000n, // $10.5k
            balanceUsd: 10500,
            approvalRemainingUsd: 10500,
            aTokenAddress: '0x12B54025C112866c37a4d6f45266854F27F23dFE' as Address,
          },
        ],
        debts: [
          {
            address: KNOWN_TOKENS.USDC,
            symbol: 'USDC',
            decimals: 6,
            priceUsd: 1,
            debt: 7000000000n, // $7k
            debtUsd: 7000,
          },
        ],
        totalCollateralUsd: 10500,
        totalRiskWeightedCollateralUsd: 8295,
        totalDebtUsd: 7000,
        currentHF: 8295 / 7000, // 1.185
      },
    },
    {
      name: 'Seed 4: Multi-collateral position (WETH + USDC)',
      targetHF: 1.20,
      position: {
        user: '0x710b8d82582823616641208922C08A4E9Ea68058' as Address,
        collaterals: [
          {
            address: KNOWN_TOKENS.WETH,
            symbol: 'WETH',
            decimals: 18,
            priceUsd: 3000,
            lt: 0.825,
            balance: 20000000000000000000n, // $60k
            balanceUsd: 60000,
            approvalRemainingUsd: 60000,
            aTokenAddress: '0x4d5F47FA6A74757f35C14fD3a6Ef8E3C973157fb' as Address,
          },
          {
            address: KNOWN_TOKENS.USDC,
            symbol: 'USDC',
            decimals: 6,
            priceUsd: 1,
            lt: 0.86,
            balance: 25000000000n, // $25k
            balanceUsd: 25000,
            approvalRemainingUsd: 25000,
            aTokenAddress: '0x9bA00D6856a4eE463b7e0EC600E526D46C52163b' as Address,
          },
        ],
        debts: [
          {
            address: KNOWN_TOKENS.USDC,
            symbol: 'USDC',
            decimals: 6,
            priceUsd: 1,
            debt: 65000000000n, // $65k
            debtUsd: 65000,
          },
        ],
        totalCollateralUsd: 85000,
        totalRiskWeightedCollateralUsd: 49500 + 21500, // 71,000
        totalDebtUsd: 65000,
        currentHF: 71000 / 65000, // 1.092
      },
    },
    {
      name: 'Seed 5: Moderate $5k debt position',
      targetHF: 1.30,
      position: {
        user: '0x97e27727923D18096978B4313416371932433C42' as Address,
        collaterals: [
          {
            address: KNOWN_TOKENS.WETH,
            symbol: 'WETH',
            decimals: 18,
            priceUsd: 3000,
            lt: 0.825,
            balance: 2500000000000000000n, // $7.5k
            balanceUsd: 7500,
            approvalRemainingUsd: 7500,
            aTokenAddress: '0x4d5F47FA6A74757f35C14fD3a6Ef8E3C973157fb' as Address,
          },
        ],
        debts: [
          {
            address: KNOWN_TOKENS.USDC,
            symbol: 'USDC',
            decimals: 6,
            priceUsd: 1,
            debt: 5000000000n, // $5k
            debtUsd: 5000,
          },
        ],
        totalCollateralUsd: 7500,
        totalRiskWeightedCollateralUsd: 6187.5,
        totalDebtUsd: 5000,
        currentHF: 6187.5 / 5000, // 1.2375
      },
    },
  ];

  describe('Acceptance Criteria §10.6 & Checklist Item 11', () => {
    it('lands within 0.5% of target HF across all 5 seeded positions in dry-run simulation', async () => {
      for (const seeded of seededPositions) {
        const plan = await generateInterventionPlan(seeded.position, {
          targetHF: seeded.targetHF,
          pLiq: 0.85,
          quoter,
          selectionPolicy: {
            targetHF: seeded.targetHF,
            gasParams: { baseFeeGwei: 0 }, // Isolate swap mechanics
          },
        });

        expect(plan.verdict).toBe('EXECUTE');

        const sim = simulatePlanExecution(seeded.position, plan, 0.005); // 0.5% tolerance

        // Verification of invariant assertions
        expect(sim.success).toBe(true);
        expect(sim.withinTolerance).toBe(true);
        expect(sim.hfRelativeError).toBeLessThanOrEqual(0.005); // <= 0.5% error
        expect(sim.invariants.hfImproved).toBe(true);
        expect(sim.invariants.hfTargetMet).toBe(true);
        expect(sim.invariants.maxAmountInSatisfied).toBe(true);

        // Check closeness of resulting HF
        expect(sim.postHF).toBeCloseTo(seeded.targetHF, 2);
      }
    });
  });
});
