#!/usr/bin/env node
import { type Address, getAddress } from 'viem';
import {
  generateInterventionPlan,
  simulatePlanExecution,
  type UserPosition,
  type CollateralAsset,
  type DebtAsset,
  KNOWN_TOKENS,
  SimulatedQuoter,
} from './planner/index.js';

async function main() {
  const args = process.argv.slice(2);
  const targetAddressRaw = args[0] ?? '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

  let userAddress: Address;
  try {
    userAddress = getAddress(targetAddressRaw);
  } catch {
    userAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
  }

  console.log('\n=========================================================================================================');
  console.log('                 AUTOMATED LIQUIDATION SHIELD — INTERVENTION PLANNER (PART 2 DECIDE)                      ');
  console.log('=========================================================================================================');
  console.log(`Target User Position: ${userAddress}\n`);

  // Default demonstration position matching OVERVIEW.md §5
  const collaterals: CollateralAsset[] = [
    {
      address: KNOWN_TOKENS.USDC,
      symbol: 'USDC',
      decimals: 6,
      priceUsd: 1.0,
      lt: 0.86,
      balance: 10000000000n, // $10,000 USDC
      balanceUsd: 10000,
      approvalRemainingUsd: 50000,
      aTokenAddress: '0x9bA00D6856a4eE463b7e0EC600E526D46C52163b' as Address,
    },
    {
      address: KNOWN_TOKENS.WETH,
      symbol: 'WETH',
      decimals: 18,
      priceUsd: 3000.0,
      lt: 0.825,
      balance: 10000000000000000000n, // 10 WETH ($30,000)
      balanceUsd: 30000,
      approvalRemainingUsd: 30000,
      aTokenAddress: '0x4d5F47FA6A74757f35C14fD3a6Ef8E3C973157fb' as Address,
    },
    {
      address: KNOWN_TOKENS.WBTC,
      symbol: 'WBTC',
      decimals: 8,
      priceUsd: 60000.0,
      lt: 0.78,
      balance: 50000000n, // 0.5 WBTC ($30,000)
      balanceUsd: 30000,
      approvalRemainingUsd: 30000,
      aTokenAddress: '0x078f358208685046a11C85e8ad32895DED33A249' as Address,
    },
    {
      address: KNOWN_TOKENS.wstETH,
      symbol: 'wstETH',
      decimals: 18,
      priceUsd: 3500.0,
      lt: 0.79,
      balance: 8000000000000000000n, // 8 wstETH ($28,000)
      balanceUsd: 28000,
      approvalRemainingUsd: 28000,
      aTokenAddress: '0x12B54025C112866c37a4d6f45266854F27F23dFE' as Address,
    },
  ];

  const debts: DebtAsset[] = [
    {
      address: KNOWN_TOKENS.USDC,
      symbol: 'USDC',
      decimals: 6,
      priceUsd: 1.0,
      debt: 19000000000n, // $19,000 USDC debt
      debtUsd: 19000,
    },
  ];

  const totalCollateralUsd = collaterals.reduce((sum, c) => sum + c.balanceUsd, 0);
  const totalRiskWeightedCollateralUsd = 24750; // Reference position A = 24,750
  const totalDebtUsd = 19000;
  const currentHF = totalRiskWeightedCollateralUsd / totalDebtUsd; // 1.3026

  const position: UserPosition = {
    user: userAddress,
    collaterals,
    debts,
    totalCollateralUsd,
    totalRiskWeightedCollateralUsd,
    totalDebtUsd,
    currentHF,
  };

  const targetHF = 1.35;
  const pLiq = 0.85; // 85% probability of liquidation over reaction window
  const quoter = new SimulatedQuoter(5, 5_000_000);

  console.log(`[1] POSITION STATE:`);
  console.log(`    Total Collateral:        $${totalCollateralUsd.toLocaleString()}`);
  console.log(`    Risk-Weighted Coll (A):  $${totalRiskWeightedCollateralUsd.toLocaleString()}`);
  console.log(`    Total Debt (D):          $${totalDebtUsd.toLocaleString()}`);
  console.log(`    Current Health Factor:   ${currentHF.toFixed(4)} (Threshold: 1.000)`);
  console.log(`    Target Setpoint (H_t):   ${targetHF.toFixed(4)}`);
  console.log(`    P(Liquidation) Risk:     ${(pLiq * 100).toFixed(1)}%\n`);

  console.log(`[2] COLLATERAL & ROUTE CANDIDATES RANKING TABLE:`);
  const plan = await generateInterventionPlan(position, {
    targetHF,
    pLiq,
    quoter,
    selectionPolicy: {
      targetHF,
      maxCostBps: 500,
      gasParams: { gasEstimate: 350000n, baseFeeGwei: 20, ethPriceUsd: 3000 },
    },
  });

  console.log(plan.rankedTable);
  console.log();

  console.log(`[3] CHOSEN INTERVENTION PLAN OBJECT:`);
  console.log(`    Mode:                    ${plan.mode}`);
  console.log(`    Collateral Asset:        ${plan.collateralAsset}`);
  console.log(`    Release Amount:          ${plan.releaseAmount.toString()} units`);
  console.log(`    Debt Asset:              ${plan.debtAsset}`);
  console.log(`    Repay Amount:            ${plan.repayAmount.toString()} units`);
  console.log(`    Flash Loan Provider:     ${plan.flashProvider} (${plan.flashAmount.toString()} units)`);
  console.log(`    Flash Loan Premium:      ${plan.flashPremium.toString()} units`);
  console.log(`    On-Chain minAmountOut:   ${plan.minAmountOut.toString()} units`);
  console.log(`    On-Chain targetHF (1e18):${plan.targetHF.toString()}`);
  console.log(`    Transaction Deadline:    ${plan.deadline.toString()}\n`);

  console.log(`[4] ECONOMIC VIABILITY VERDICT:`);
  console.log(`    Verdict:                 [ ${plan.verdict} ]`);
  console.log(`    Reason Code:             ${plan.reasonCode}`);
  console.log(`    Expected Loss If Idle:   $${plan.expectedLossIfIdleUsd.toFixed(2)}`);
  console.log(`    Total Action Cost:       $${(plan.capitalBurnedUsd + plan.gasUsd).toFixed(2)} ($${plan.capitalBurnedUsd.toFixed(2)} friction + $${plan.gasUsd.toFixed(2)} gas)`);
  console.log(`    Net Economic Benefit:    $${plan.netBenefitUsd.toFixed(2)}`);
  console.log(`    Decision Trace:          ${plan.reasons[0]}\n`);

  console.log(`[5] ATOMIC SIMULATION DRY-RUN HARNESS:`);
  const sim = simulatePlanExecution(position, plan, 0.005);
  for (const log of sim.logs) {
    console.log(`    | ${log}`);
  }

  console.log(`\n    Simulation Result:       ${sim.success ? 'PASSED (HF landed within 0.5% tolerance)' : 'FAILED'}`);
  console.log('=========================================================================================================\n');
}

main().catch((err) => {
  console.error('Planner CLI error:', err);
  process.exit(1);
});
