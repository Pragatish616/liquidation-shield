import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeMultiCollateral } from '../../agent/src/keeper-backend/src/mock/position.ts';
import { crashWETH } from '../../agent/src/keeper-backend/src/mock/crash.ts';
import { healthFactor } from '../../agent/src/keeper-backend/src/health.ts';
import type { KeeperOptions } from '../../agent/src/keeper-backend/src/keeper/loop.ts';
import { tickOnce } from '../../agent/src/keeper-backend/src/keeper/loop.ts';
import { readDecisions } from '../../agent/src/keeper-backend/src/keeper/store.ts';

async function main() {
  const logPath = resolve('decision-save.log.json');
  if (existsSync(logPath)) {
    unlinkSync(logPath);
  }

  const position = makeMultiCollateral();
  const initHF = healthFactor(position);

  const opts: KeeperOptions = {
    userId: 'demo-save',
    targetHF: 1.35,
    pLiq: 0.05,
    gasUsd: 5,
    debtSymbol: 'USDC',
    intervalMs: 12000,
    logPath,
    getPosition: () => position,
  };

  const hfTrajectory: number[] = [initHF];

  for (let i = 0; i < 6; i++) {
    crashWETH(position, 0.02, 1);
    hfTrajectory.push(healthFactor(position));
    await tickOnce(opts);
  }

  const records = readDecisions(logPath);
  const execRec = records.find((r) => r.kind === 'execute');
  const finalPreActHF = hfTrajectory[hfTrajectory.length - 1];

  console.log('=== Demo 01 — The save ===');
  console.log(`Initial HF:          ${initHF.toFixed(4)}`);
  console.log(`Final HF (pre-act):  ${finalPreActHF.toFixed(4)}`);
  console.log(`Trigger threshold:   ${opts.targetHF.toFixed(2)}`);
  console.log(`Decision:            ${execRec ? 'EXECUTE' : 'HOLD'}`);
  console.log(`Tx hash:             ${execRec?.txHash ?? 'N/A'}`);
  console.log(`Capital burned:      $${(execRec?.capitalBurned ?? 0).toFixed(2)}`);
  console.log('Expected loss avoided: ~$475 ($23.75 weighted)');
  const netBenefit = 23.75 - ((execRec?.capitalBurned ?? 0) + opts.gasUsd);
  console.log(`Net benefit:         $${netBenefit.toFixed(2)}`);
  console.log(`Records logged:      ${records.length}`);

  if (execRec && /^0x[0-9a-f]{64}$/.test(execRec.txHash ?? '')) {
    process.exit(0);
  } else {
    console.error('Scenario 01 failed: missing or invalid execute record');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error in scenario 01:', err);
  process.exit(1);
});
