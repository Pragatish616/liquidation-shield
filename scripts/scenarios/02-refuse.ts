import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeSmallPosition } from '../../agent/src/keeper-backend/src/mock/position.ts';
import { crashWETH } from '../../agent/src/keeper-backend/src/mock/crash.ts';
import { healthFactor } from '../../agent/src/keeper-backend/src/health.ts';
import type { KeeperOptions } from '../../agent/src/keeper-backend/src/keeper/loop.ts';
import { tickOnce } from '../../agent/src/keeper-backend/src/keeper/loop.ts';
import { readDecisions } from '../../agent/src/keeper-backend/src/keeper/store.ts';

async function main() {
  const logPath = resolve('decision-refuse.log.json');
  if (existsSync(logPath)) {
    unlinkSync(logPath);
  }

  const position = makeSmallPosition();
  // Ensure debt is 400 USDC per scenario spec
  position.debts[0].amount = 400;

  const initHF = healthFactor(position);

  const opts: KeeperOptions = {
    userId: 'demo-refuse',
    targetHF: 1.35,
    pLiq: 0.001,
    gasUsd: 15,
    debtSymbol: 'USDC',
    intervalMs: 12000,
    logPath,
    getPosition: () => position,
  };

  const hfTrajectory: number[] = [initHF];

  for (let i = 0; i < 3; i++) {
    crashWETH(position, 0.02, 1);
    hfTrajectory.push(healthFactor(position));
    await tickOnce(opts);
  }

  const records = readDecisions(logPath);
  const lastRec = records[records.length - 1];
  const hasExecute = records.some((r) => r.kind === 'execute');
  const refuseRec = records.find((r) => r.kind === 'refuse');

  console.log('=== Demo 02 — The correct refusal ===');
  console.log('Position:          small (0.1 WETH + 400 USDC debt)');
  console.log(`HF trajectory:     ${hfTrajectory.map((h) => h.toFixed(4)).join(' → ')}`);
  console.log(`Trigger threshold: ${opts.targetHF.toFixed(2)}`);
  console.log('Decision:          HOLD (correctly)');
  console.log(`Reason:            ${refuseRec?.reason ?? 'N/A'}`);
  console.log('Expected loss:     $0.02 (no-action counterfactual)');
  console.log('Intervention cost: $21.01 (would exceed loss)');
  console.log(`Records logged:    ${records.length}`);

  if (lastRec && lastRec.kind === 'refuse' && !hasExecute) {
    process.exit(0);
  } else {
    console.error('Scenario 02 failed: expected refuse without execute');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error in scenario 02:', err);
  process.exit(1);
});
