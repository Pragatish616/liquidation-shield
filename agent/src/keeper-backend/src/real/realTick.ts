/**
 * The real counterpart to ../keeper/loop.ts's tickOnce(): same decision
 * shape (assess -> plan -> refuse/execute, logged via the same
 * DecisionRecord store), but sourced from Part 1's real on-chain reader +
 * risk model and Part 2's real planner, instead of the mock Position/plan()
 * in ../health.ts and ../mock/position.ts.
 *
 * ../keeper/loop.ts is untouched -- this is an additive path, not a
 * replacement, so the existing mock-driven demo scenarios and their tests
 * keep working exactly as before.
 */

import type { Address } from 'viem';
import { assess } from '../../../risk/assess.ts';
import {
  generateInterventionPlan,
  SimulatedQuoter,
  type InterventionPlan,
  type UserPosition,
} from '../../../planner/index.ts';
import { snapshotToUserPosition, type AdapterOptions } from './adapter.ts';
import { appendDecision, readDecisions } from '../keeper/store.ts';
import { executeMock } from '../executor/executor.ts';

// InterventionPlan's own releaseAmount/repayAmount are raw token units, not
// USD -- for DELEVERAGE mode the winning candidate's clamped*Usd fields
// (already in USD) are the direct source; for EXTERNAL_REPAY there's no
// ranked candidate at all (see plan.ts), so repayUsd is derived the same
// way simulate.ts does it, from the debt asset's own price/decimals.
function planAmountsUsd(plan: InterventionPlan, position: UserPosition): { releaseUsd: number; repayUsd: number } {
  if (plan.mode === 'DELEVERAGE') {
    const best = plan.ranking.find((c) => c.rank === 1);
    return { releaseUsd: best?.clampedReleaseUsd ?? 0, repayUsd: best?.clampedRepayUsd ?? 0 };
  }
  const debtAsset = position.debts.find((d) => d.address.toLowerCase() === plan.debtAsset.toLowerCase());
  const repayUsd = debtAsset ? (Number(plan.repayAmount) / 10 ** debtAsset.decimals) * debtAsset.priceUsd : 0;
  return { releaseUsd: 0, repayUsd };
}

export interface RealKeeperOptions {
  user: Address;
  logPath: string;
  adapterOptions?: AdapterOptions;
}

// Own in-flight lock, separate from ../keeper/loop.ts's (module-private,
// mock-path-only) lock -- the real and mock paths are logically distinct
// keepers in this demo and never race against each other.
const inFlightLock = new Set<string>();

export function isRealTickInFlight(userId: string): boolean {
  return inFlightLock.has(userId);
}

export async function realTickOnce(opts: RealKeeperOptions): Promise<void> {
  const userId = opts.user;
  const ts = Date.now();

  const assessment = await assess(opts.user);
  const hf = assessment.snapshot.healthFactor;

  const existingRecords = readDecisions(opts.logPath);
  const userRecords = existingRecords.filter((r) => r.userId === userId);
  const lastRecord = userRecords.length > 0 ? userRecords[userRecords.length - 1] : undefined;

  appendDecision(opts.logPath, {
    ts,
    userId,
    kind: 'assess',
    hf,
    targetHF: assessment.targetHF,
    triggerHF: assessment.triggerHF,
    pLiq: assessment.pLiq,
    pLiq24h: assessment.pLiq24h,
    urgency: assessment.urgency,
    reasons: assessment.reasons,
  });

  if (isRealTickInFlight(userId)) {
    appendDecision(opts.logPath, {
      ts: Date.now(),
      userId,
      kind: 'refuse',
      hf,
      targetHF: assessment.targetHF,
      reason: 'in_flight_lock',
    });
    return;
  }

  if (lastRecord && lastRecord.kind === 'execute') {
    appendDecision(opts.logPath, {
      ts: Date.now(),
      userId,
      kind: 'refuse',
      hf,
      targetHF: assessment.targetHF,
      reason: 'already_executed',
    });
    return;
  }

  const position = snapshotToUserPosition(assessment.snapshot, opts.adapterOptions);
  const quoter = new SimulatedQuoter();

  const plan = await generateInterventionPlan(position, {
    targetHF: assessment.targetHF,
    pLiq: assessment.pLiq,
    quoter,
    gasParams: { ethPriceUsd: 3000 },
  });

  if (plan.verdict !== 'EXECUTE') {
    appendDecision(opts.logPath, {
      ts: Date.now(),
      userId,
      kind: 'plan',
      hf,
      targetHF: assessment.targetHF,
      verdict: plan.verdict,
      mode: plan.mode,
      reasons: plan.reasons,
    });
    appendDecision(opts.logPath, {
      ts: Date.now(),
      userId,
      kind: 'refuse',
      hf,
      targetHF: assessment.targetHF,
      expectedLossNoAction: plan.expectedLossIfIdleUsd,
      // capitalBurnedUsd is already all-in (kappa's own gasFriction term
      // folds gas in -- see costModel.ts) -- adding plan.gasUsd here would
      // double-count it, same bug already fixed in selection.ts/viability.ts.
      expectedLossAction: plan.capitalBurnedUsd,
      verdict: plan.verdict,
      mode: plan.mode,
      reasons: plan.reasons,
      reason: plan.reasons[0] ?? plan.reasonCode ?? 'not viable',
    });
    return;
  }

  const chosenSymbol =
    plan.mode === 'DELEVERAGE'
      ? plan.ranking.find((c) => c.rank === 1)?.collateral.symbol
      : 'EXTERNAL_REPAY';
  const { releaseUsd, repayUsd } = planAmountsUsd(plan, position);

  appendDecision(opts.logPath, {
    ts: Date.now(),
    userId,
    kind: 'plan',
    hf,
    targetHF: assessment.targetHF,
    chosenSymbol,
    releaseUsd,
    repayUsd,
    capitalBurned: plan.capitalBurnedUsd,
    verdict: plan.verdict,
    mode: plan.mode,
    reasons: plan.reasons,
  });

  inFlightLock.add(userId);

  try {
    const receipt = await executeMock(userId, {
      symbol: chosenSymbol ?? plan.mode,
      V: Number(plan.releaseAmount),
      R: Number(plan.repayAmount),
      minOut: Number(plan.maxAmountIn),
      deadline: Number(plan.deadline),
    });

    appendDecision(opts.logPath, {
      ts: Date.now(),
      userId,
      kind: 'execute',
      hf,
      targetHF: assessment.targetHF,
      chosenSymbol,
      releaseUsd,
      repayUsd,
      capitalBurned: plan.capitalBurnedUsd,
      verdict: plan.verdict,
      mode: plan.mode,
      reasons: plan.reasons,
      txHash: receipt.txHash,
    });
  } catch (err) {
    appendDecision(opts.logPath, {
      ts: Date.now(),
      userId,
      kind: 'simulate_fail',
      hf,
      targetHF: assessment.targetHF,
      verdict: plan.verdict,
      mode: plan.mode,
      reasons: plan.reasons,
      reason: err instanceof Error ? err.message : String(err),
    });
  } finally {
    inFlightLock.delete(userId);
  }
}
