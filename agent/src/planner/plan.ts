import { type Address, type Hex } from 'viem';
import {
  selectBestIntervention,
  type UserPosition,
  type SelectionPolicy,
  type CandidateRouteEvaluation,
} from './selection.js';
import {
  evaluateViability,
  type ViabilityPolicy,
  type ViabilityResult,
} from './viability.js';
import { sizeExternalRepay } from './sizing.js';
import { type IQuoter } from './quoter.js';
import { FLASH_LOAN_PREMIUMS, type FlashLoanProvider } from './costModel.js';

export type InterventionMode = 'DELEVERAGE' | 'EXTERNAL_REPAY';

/**
 * Complete InterventionPlan object matching §6 on-chain and off-chain interface.
 */
export interface InterventionPlan {
  /** User account address being protected */
  user: Address;
  /** Restructuring mode: DELEVERAGE via flash loan or EXTERNAL_REPAY */
  mode: InterventionMode;
  /** Collateral asset underlying address (0x0 for external repay) */
  collateralAsset: Address;
  /** aToken address corresponding to collateral (for permit/transferFrom) */
  aToken: Address;
  /** Exact amount of collateral underlying units to release */
  releaseAmount: bigint;
  /** Debt asset address to be repaid */
  debtAsset: Address;
  /** Exact amount of debt asset units to repay */
  repayAmount: bigint;
  /** Flash loan provider protocol */
  flashProvider: FlashLoanProvider;
  /** Flash loan borrow amount in debt asset units (== repayAmount for flash mode) */
  flashAmount: bigint;
  /** Flash loan premium in debt asset units */
  flashPremium: bigint;
  /** Encoded forward Uniswap v3 path for execution swap */
  swapPath: Hex;
  /** Maximum collateral input the exact-output swap may spend (enforced
   *  on-chain) -- a quote-derived ceiling, always <= releaseAmount */
  maxAmountIn: bigint;
  /** Target Health Factor scaled by 1e18 (enforced on-chain) */
  targetHF: bigint;
  /** Expiration timestamp for transaction deadline (enforced on-chain) */
  deadline: bigint;

  // Diagnostics & decision provenance (off-chain):
  /** Round-trip friction in basis points */
  kappaBps: number;
  /** Capital burned / user friction loss in USD */
  capitalBurnedUsd: number;
  /** Estimated gas cost in USD */
  gasUsd: number;
  /** Expected liquidation loss if idle in USD */
  expectedLossIfIdleUsd: number;
  /** Net dollar benefit (expectedLoss - totalCost) */
  netBenefitUsd: number;
  /** Viability verdict: EXECUTE, HOLD, or REFUSE */
  verdict: 'EXECUTE' | 'HOLD' | 'REFUSE';
  /** Machine-readable decision code */
  reasonCode?: string;
  /** Human-readable explanation and trace */
  reasons: string[];
  /** Full ranked table of evaluated routes */
  ranking: CandidateRouteEvaluation[];
  /** Formatted ASCII table string for CLI/logging */
  rankedTable: string;
}

export interface PlanGenerationOptions {
  /** Target Health Factor setpoint (e.g. 1.35) */
  targetHF: number;
  /** Probability of liquidation from Part 1 risk model [0, 1] */
  pLiq: number;
  /** Quoter implementation */
  quoter: IQuoter;
  /** Selection and viability policies */
  selectionPolicy?: SelectionPolicy | undefined;
  /** Viability gate policy */
  viabilityPolicy?: ViabilityPolicy | undefined;
  /** Optional external reserve balance in USD (enables Mode A if covered) */
  externalReserveUsd?: number | undefined;
  /** Preferred flash loan provider (default: 'AAVE') */
  flashProvider?: FlashLoanProvider | undefined;
  /** Deadline window in seconds from now (default: 300 = 5 min) */
  deadlineSeconds?: number | undefined;
  /** Current Unix timestamp in seconds (default: Date.now() / 1000) */
  currentTimestamp?: number | undefined;
}

/**
 * Generates an end-to-end InterventionPlan from a UserPosition (§6).
 *
 * Evaluates Mode A (External Repay) if a funded reserve covers R_min,
 * or Mode B (Deleveraging via Flash Loan) through the selection and viability engines.
 *
 * @param position - UserPosition
 * @param options - PlanGenerationOptions
 * @returns Complete InterventionPlan
 */
export async function generateInterventionPlan(
  position: UserPosition,
  options: PlanGenerationOptions
): Promise<InterventionPlan> {
  const currentTimestamp =
    options.currentTimestamp ?? Math.floor(Date.now() / 1000);
  const deadlineSeconds = options.deadlineSeconds ?? 300;
  const deadline = BigInt(currentTimestamp + deadlineSeconds);
  const targetHFScaled = BigInt(Math.round(options.targetHF * 1e18));
  const flashProvider = options.flashProvider ?? 'AAVE';

  const defaultAddress: Address = '0x0000000000000000000000000000000000000000';
  const defaultHex: Hex = '0x';

  // Check Mode A: External Repay (§2.1)
  const externalSizing = sizeExternalRepay(
    position.totalRiskWeightedCollateralUsd,
    position.totalDebtUsd,
    options.targetHF
  );

  const primaryDebt = position.debts[0];

  if (
    options.externalReserveUsd !== undefined &&
    externalSizing.feasible &&
    options.externalReserveUsd >= externalSizing.repayUsd &&
    primaryDebt
  ) {
    // Mode A is covered by reserve
    const repayUnits = BigInt(
      Math.round(
        (externalSizing.repayUsd / primaryDebt.priceUsd) *
          10 ** primaryDebt.decimals
      )
    );

    const primaryCollateral = position.collaterals[0];

    return {
      user: position.user,
      mode: 'EXTERNAL_REPAY',
      collateralAsset: primaryCollateral?.address ?? defaultAddress,
      aToken: primaryCollateral?.aTokenAddress ?? defaultAddress,
      releaseAmount: 0n,
      debtAsset: primaryDebt.address,
      repayAmount: repayUnits,
      flashProvider: 'AAVE',
      flashAmount: 0n,
      flashPremium: 0n,
      swapPath: defaultHex,
      maxAmountIn: 0n,
      targetHF: targetHFScaled,
      deadline,
      kappaBps: 0,
      capitalBurnedUsd: 0,
      gasUsd: 15.0, // Low gas for simple repay
      expectedLossIfIdleUsd: 0,
      netBenefitUsd: externalSizing.repayUsd,
      verdict: 'EXECUTE',
      reasonCode: 'EXTERNAL_RESERVE_REPAY',
      reasons: [
        `Mode A External Repay funded by reserve ($${externalSizing.repayUsd.toFixed(2)} of $${options.externalReserveUsd.toFixed(2)} reserve used). Zero swap friction.`,
      ],
      ranking: [],
      rankedTable: 'Mode A (External Repay) selected: zero swap friction.',
    };
  }

  // Mode B: Flash Loan Deleveraging (§3 - §5)
  const selectionPolicy: SelectionPolicy = {
    targetHF: options.targetHF,
    flashProvider,
    ...options.selectionPolicy,
  };

  const selectionResult = await selectBestIntervention(
    position,
    selectionPolicy,
    options.quoter
  );

  const viabilityResult: ViabilityResult = evaluateViability({
    position,
    candidate: selectionResult.bestCandidate,
    pLiq: options.pLiq,
    liquidationBonus: selectionResult.bestCandidate?.collateral.liquidationBonus,
    policy: options.viabilityPolicy,
  });

  const best = selectionResult.bestCandidate;

  if (!best || !best.feasible || !best.quote) {
    // Infeasible / Refusal plan
    const firstCol = position.collaterals[0];
    const firstDebt = position.debts[0];

    return {
      user: position.user,
      mode: 'DELEVERAGE',
      collateralAsset: firstCol?.address ?? defaultAddress,
      aToken: firstCol?.aTokenAddress ?? defaultAddress,
      releaseAmount: 0n,
      debtAsset: firstDebt?.address ?? defaultAddress,
      repayAmount: 0n,
      flashProvider,
      flashAmount: 0n,
      flashPremium: 0n,
      swapPath: defaultHex,
      maxAmountIn: 0n,
      targetHF: targetHFScaled,
      deadline,
      kappaBps: 0,
      capitalBurnedUsd: 0,
      gasUsd: 0,
      expectedLossIfIdleUsd: viabilityResult.expectedLossIfIdleUsd,
      netBenefitUsd: viabilityResult.netBenefitUsd,
      verdict: viabilityResult.verdict,
      reasonCode: viabilityResult.reasonCode,
      reasons: viabilityResult.reasons,
      ranking: selectionResult.allCandidates,
      rankedTable: selectionResult.rankedTable,
    };
  }

  // Calculate flash premium in debt token units
  const flashPremiumRate = FLASH_LOAN_PREMIUMS[flashProvider];
  const flashPremiumUnits = BigInt(
    Math.round(Number(best.repayUnits) * flashPremiumRate)
  );

  return {
    user: position.user,
    mode: 'DELEVERAGE',
    collateralAsset: best.collateral.address,
    aToken: best.collateral.aTokenAddress,
    releaseAmount: best.releaseUnits,
    debtAsset: best.debt.address,
    repayAmount: best.repayUnits,
    flashProvider,
    flashAmount: best.repayUnits,
    flashPremium: flashPremiumUnits,
    swapPath: best.quote.route.forwardPathHex,
    maxAmountIn: best.maxAmountIn,
    targetHF: targetHFScaled,
    deadline,
    kappaBps: best.kappaBps,
    capitalBurnedUsd: best.capitalBurnedUsd,
    gasUsd: best.gasUsd,
    expectedLossIfIdleUsd: viabilityResult.expectedLossIfIdleUsd,
    netBenefitUsd: viabilityResult.netBenefitUsd,
    verdict: viabilityResult.verdict,
    reasonCode: viabilityResult.reasonCode,
    reasons: viabilityResult.reasons,
    ranking: selectionResult.allCandidates,
    rankedTable: selectionResult.rankedTable,
  };
}
