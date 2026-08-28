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
import { generateInterventionPlan, SimulatedQuoter } from '../../../planner/index.ts';
import { snapshotToUserPosition, type AdapterOptions } from './adapter.ts';
import { appendDecision, readDecisions } from '../keeper/store.ts';
import { executeMock } from '../executor/executor.ts';

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
    pLiq: assessment.pLiq,
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
    });
    appendDecision(opts.logPath, {
      ts: Date.now(),
      userId,
      kind: 'refuse',
      hf,
      targetHF: assessment.targetHF,
      expectedLossNoAction: plan.expectedLossIfIdleUsd,
      expectedLossAction: plan.capitalBurnedUsd + plan.gasUsd,
      reason: plan.reasons[0] ?? plan.reasonCode ?? 'not viable',
    });
    return;
  }

  const chosenSymbol =
    plan.mode === 'DELEVERAGE'
      ? plan.ranking.find((c) => c.rank === 1)?.collateral.symbol
      : 'EXTERNAL_REPAY';

  appendDecision(opts.logPath, {
    ts: Date.now(),
    userId,
    kind: 'plan',
    hf,
    targetHF: assessment.targetHF,
    chosenSymbol,
    capitalBurned: plan.capitalBurnedUsd,
  });

  inFlightLock.add(userId);

  try {
    const receipt = await executeMock(userId, {
      symbol: chosenSymbol ?? plan.mode,
      V: Number(plan.releaseAmount),
      R: Number(plan.repayAmount),
      minOut: Number(plan.minAmountOut),
      deadline: Number(plan.deadline),
    });

    appendDecision(opts.logPath, {
      ts: Date.now(),
      userId,
      kind: 'execute',
      hf,
      targetHF: assessment.targetHF,
      chosenSymbol,
      capitalBurned: plan.capitalBurnedUsd,
      txHash: receipt.txHash,
    });
  } catch (err) {
    appendDecision(opts.logPath, {
      ts: Date.now(),
      userId,
      kind: 'simulate_fail',
      hf,
      targetHF: assessment.targetHF,
      reason: err instanceof Error ? err.message : String(err),
    });
  } finally {
    inFlightLock.delete(userId);
  }
}
