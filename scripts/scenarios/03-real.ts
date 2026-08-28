/**
 * Real end-to-end keeper tick: reads a real position from the live fork
 * via Part 1, plans an intervention via Part 2's real planner, and logs
 * the decision through keeper-backend's existing store -- same log format
 * as 01-save.ts / 02-refuse.ts, so the dashboard reads it unchanged.
 *
 * Requires the pinned Anvil fork running (`pnpm fork`) and a seeded
 * position (`pnpm seed`).
 */
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { realTickOnce } from '../../agent/src/keeper-backend/src/real/realTick.ts';
import { readDecisions } from '../../agent/src/keeper-backend/src/keeper/store.ts';

const user =
  (process.argv[2] as `0x${string}` | undefined) ??
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'; // Step 4's seeded WETH/USDC position

const logPath = resolve('decision-real.log.json');
if (existsSync(logPath)) unlinkSync(logPath);

console.log('=== Demo 03 — Real Part 1/2 keeper tick ===');
console.log(`User: ${user}`);

await realTickOnce({ user, logPath });

const records = readDecisions(logPath);
for (const r of records) {
  console.log(`[${r.kind}] hf=${r.hf?.toFixed(4)} targetHF=${r.targetHF?.toFixed(4)}` +
    (r.chosenSymbol ? ` chosen=${r.chosenSymbol}` : '') +
    (r.capitalBurned !== undefined ? ` capitalBurned=$${r.capitalBurned.toFixed(2)}` : '') +
    (r.reason ? ` reason=${r.reason}` : '') +
    (r.txHash ? ` tx=${r.txHash}` : ''));
}
console.log(`Records logged: ${records.length}`);
