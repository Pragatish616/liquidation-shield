import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DecisionRecord } from '../src/keeper/store.ts';
import type { KeeperOptions } from '../src/keeper/loop.ts';
import { executeMock, nextNonce } from '../src/executor/executor.ts';
import { appendDecision, readDecisions } from '../src/keeper/store.ts';
import { runKeeper, tickOnce } from '../src/keeper/loop.ts';
import { makeWorkedExample, makeSmallPosition } from '../src/mock/position.ts';

function tempLog(): string {
  const dir = mkdtempSync(join(tmpdir(), 'shield-test-'));
  return join(dir, 'decision.log.json');
}

const defaultPayload = { symbol: 'USDC', V: 1865, R: 1855, minOut: 1855, deadline: 9999999999 };

// --- executor.ts ---

test('1. executeMock returns valid 64-hex txHash', async () => {
  const rx = await executeMock('user1', defaultPayload);
  assert.ok(/^0x[0-9a-f]{64}$/.test(rx.txHash), `Invalid txHash: ${rx.txHash}`);
});

test('2. executeMock blockNumber increments', async () => {
  const rx1 = await executeMock('user2', defaultPayload);
  const rx2 = await executeMock('user2', defaultPayload);
  assert.equal(rx2.blockNumber, rx1.blockNumber + 1);
});

test('3. nextNonce is per-user and monotonic', () => {
  const uA1 = nextNonce('userA');
  const uA2 = nextNonce('userA');
  const uB1 = nextNonce('userB');
  assert.equal(uA2, uA1 + 1);
  assert.equal(uB1, 0);
});

// --- store.ts ---

test('4. appendDecision creates file + parent dir', () => {
  const logPath = tempLog();
  const rec: DecisionRecord = { ts: Date.now(), userId: 'u1', kind: 'assess' };
  appendDecision(logPath, rec);
  const records = readDecisions(logPath);
  assert.equal(records.length, 1);
  assert.equal(records[0].userId, 'u1');
});

test('5. readDecisions returns [] for missing file', () => {
  const logPath = join(tmpdir(), 'non_existent_dir_12345', 'missing.log.json');
  const records = readDecisions(logPath);
  assert.deepEqual(records, []);
});

test('6. round-trip preserves order', () => {
  const logPath = tempLog();
  appendDecision(logPath, { ts: 1, userId: 'u1', kind: 'assess' });
  appendDecision(logPath, { ts: 2, userId: 'u1', kind: 'plan' });
  appendDecision(logPath, { ts: 3, userId: 'u1', kind: 'execute' });
  const records = readDecisions(logPath);
  assert.equal(records.length, 3);
  assert.equal(records[0].kind, 'assess');
  assert.equal(records[1].kind, 'plan');
  assert.equal(records[2].kind, 'execute');
});

test('7. readDecisions tolerates malformed lines', () => {
  const logPath = tempLog();
  appendDecision(logPath, { ts: 1, userId: 'u1', kind: 'assess' });
  writeFileSync(logPath, 'NOT_VALID_JSON\n', { flag: 'a' });
  appendDecision(logPath, { ts: 3, userId: 'u1', kind: 'execute' });

  const records = readDecisions(logPath);
  assert.equal(records.length, 2);
  assert.equal(records[0].kind, 'assess');
  assert.equal(records[1].kind, 'execute');
});

// --- loop.ts ---

test('8. tickOnce with worked example logs assess → plan → execute', async () => {
  const logPath = tempLog();
  const opts: KeeperOptions = {
    userId: 'uWorked',
    targetHF: 1.35,
    pLiq: 0.05,
    gasUsd: 5,
    debtSymbol: 'USDC',
    intervalMs: 12000,
    logPath,
    getPosition: () => makeWorkedExample(),
  };

  await tickOnce(opts);
  const records = readDecisions(logPath);
  assert.equal(records.length, 3);
  assert.equal(records[0].kind, 'assess');
  assert.equal(records[1].kind, 'plan');
  assert.equal(records[2].kind, 'execute');
});

test('9. tickOnce with small position logs assess → plan → refuse', async () => {
  const logPath = tempLog();
  const opts: KeeperOptions = {
    userId: 'uSmall',
    targetHF: 1.35,
    pLiq: 0.001,
    gasUsd: 15,
    debtSymbol: 'USDC',
    intervalMs: 12000,
    logPath,
    getPosition: () => makeSmallPosition(),
  };

  await tickOnce(opts);
  const records = readDecisions(logPath);
  assert.equal(records.length, 3);
  assert.equal(records[0].kind, 'assess');
  assert.equal(records[1].kind, 'plan');
  assert.equal(records[2].kind, 'refuse');
});

test('10. execute record contains a valid txHash', async () => {
  const logPath = tempLog();
  const opts: KeeperOptions = {
    userId: 'uTx',
    targetHF: 1.35,
    pLiq: 0.05,
    gasUsd: 5,
    debtSymbol: 'USDC',
    intervalMs: 12000,
    logPath,
    getPosition: () => makeWorkedExample(),
  };

  await tickOnce(opts);
  const records = readDecisions(logPath);
  const execRec = records.find((r) => r.kind === 'execute');
  assert.ok(execRec !== undefined);
  assert.ok(/^0x[0-9a-f]{64}$/.test(execRec.txHash ?? ''));
});

test('11. duplicate ticks are deduplicated', async () => {
  const logPath = tempLog();
  const opts: KeeperOptions = {
    userId: 'uDup',
    targetHF: 1.35,
    pLiq: 0.05,
    gasUsd: 5,
    debtSymbol: 'USDC',
    intervalMs: 12000,
    logPath,
    getPosition: () => makeWorkedExample(),
  };

  await tickOnce(opts);
  await tickOnce(opts);

  const records = readDecisions(logPath);
  const execRecords = records.filter((r) => r.kind === 'execute');
  assert.equal(execRecords.length, 1);
});

test('12. runKeeper stops cleanly when stop function is called', async () => {
  const logPath = tempLog();
  const opts: KeeperOptions = {
    userId: 'uRun',
    targetHF: 1.35,
    pLiq: 0.05,
    gasUsd: 5,
    debtSymbol: 'USDC',
    intervalMs: 100,
    logPath,
    getPosition: () => makeWorkedExample(),
  };

  const stop = runKeeper(opts);
  await new Promise((resolve) => setTimeout(resolve, 250));
  stop();

  const recordsBeforeStop = readDecisions(logPath).length;
  await new Promise((resolve) => setTimeout(resolve, 250));
  const recordsAfterStop = readDecisions(logPath).length;

  assert.equal(recordsAfterStop, recordsBeforeStop);
});
