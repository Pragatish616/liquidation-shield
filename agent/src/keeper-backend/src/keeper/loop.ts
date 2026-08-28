import type { Position } from '../health.ts';
import { healthFactor } from '../health.ts';
import { planPosition } from '../planner/planner.ts';
import { executeMock } from '../executor/executor.ts';
import { appendDecision, readDecisions } from './store.ts';

export interface KeeperOptions {
  userId: string;                       // single-user demo
  targetHF: number;                     // setpoint, e.g. 1.35
  pLiq: number;                         // current P(liquidation) estimate, e.g. 0.05
  gasUsd: number;                       // e.g. 5
  debtSymbol: string;                   // e.g. 'USDC'
  intervalMs: number;                   // 12000 fixed for L4
  logPath: string;                      // e.g. 'project/backend/decision.log.json'
  getPosition: () => Position;          // callback so tests / scenarios can drive prices
}

const inFlightLock = new Set<string>();

export function isInFlight(userId: string): boolean {
  return inFlightLock.has(userId);
}

export async function tickOnce(opts: KeeperOptions): Promise<void> {
  const ts = Date.now();
  const pos = opts.getPosition();
  const hf = healthFactor(pos);

  // Check prior log records for this user BEFORE appending current assess record
  const existingRecords = readDecisions(opts.logPath);
  const userRecords = existingRecords.filter((r) => r.userId === opts.userId);
  const lastRecord = userRecords.length > 0 ? userRecords[userRecords.length - 1] : undefined;

  // 1. Log assess record
  appendDecision(opts.logPath, {
    ts,
    userId: opts.userId,
    kind: 'assess',
    hf,
    targetHF: opts.targetHF,
    pLiq: opts.pLiq,
  });

  // 2. Check in-flight lock
  if (isInFlight(opts.userId)) {
    appendDecision(opts.logPath, {
      ts: Date.now(),
      userId: opts.userId,
      kind: 'refuse',
      hf,
      targetHF: opts.targetHF,
      reason: 'in_flight_lock',
    });
    return;
  }

  // 3. Check for deduplication (prevent double execute if last logged record was execute)
  if (lastRecord && lastRecord.kind === 'execute') {
    appendDecision(opts.logPath, {
      ts: Date.now(),
      userId: opts.userId,
      kind: 'refuse',
      hf,
      targetHF: opts.targetHF,
      reason: 'already_executed',
    });
    return;
  }

  // 4. Run planner
  const planRes = planPosition(pos, opts.targetHF, opts.pLiq, opts.gasUsd, opts.debtSymbol);

  if (planRes.mode === 'HOLD' || !planRes.chosen) {
    appendDecision(opts.logPath, {
      ts: Date.now(),
      userId: opts.userId,
      kind: 'plan',
      hf,
      targetHF: opts.targetHF,
    });
    appendDecision(opts.logPath, {
      ts: Date.now(),
      userId: opts.userId,
      kind: 'refuse',
      hf,
      targetHF: opts.targetHF,
      reason: planRes.reason ?? 'intervention cost exceeds expected loss',
    });
    return;
  }

  // 5. Execute plan (MODE2_FLASH)
  const chosen = planRes.chosen;
  appendDecision(opts.logPath, {
    ts: Date.now(),
    userId: opts.userId,
    kind: 'plan',
    hf,
    targetHF: opts.targetHF,
    chosenSymbol: chosen.symbol,
    capitalBurned: chosen.capitalBurned,
  });

  inFlightLock.add(opts.userId);

  try {
    const payload = {
      symbol: chosen.symbol,
      V: chosen.V,
      R: chosen.R,
      minOut: chosen.R,
      deadline: Math.floor(Date.now() / 1000) + 300,
    };

    const receipt = await executeMock(opts.userId, payload);

    appendDecision(opts.logPath, {
      ts: Date.now(),
      userId: opts.userId,
      kind: 'execute',
      hf,
      targetHF: opts.targetHF,
      chosenSymbol: chosen.symbol,
      capitalBurned: chosen.capitalBurned,
      txHash: receipt.txHash,
    });
  } finally {
    inFlightLock.delete(opts.userId);
  }
}

export function runKeeper(opts: KeeperOptions): () => void {
  const intervalId = setInterval(() => {
    tickOnce(opts).catch(() => {});
  }, opts.intervalMs);

  return () => {
    clearInterval(intervalId);
  };
}
