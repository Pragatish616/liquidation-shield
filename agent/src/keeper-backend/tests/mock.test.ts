import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Position } from '../src/health.ts';
import { healthFactor } from '../src/health.ts';
import {
  makeWorkedExample,
  makeSmallPosition,
  makeMultiCollateral,
  snapshot,
} from '../src/mock/position.ts';
import {
  crashCollateral,
  crashWETH,
  crashUSDC,
  crashWBTC,
  recoverCollateral,
} from '../src/mock/crash.ts';

// 1. makeWorkedExample() yields HF 1.3026 (within ±1e-3)
test('workedExample HF ≈ 1.3026', () => {
  const pos = makeWorkedExample();
  const hf = healthFactor(pos);
  assert.ok(Math.abs(hf - 1.3026) < 1e-3, `Expected ~1.3026, got ${hf}`);
});

// 2. makeMultiCollateral() yields the same total HF (within ±1e-3)
test('multiCollateral HF ≈ 1.3026', () => {
  const pos = makeMultiCollateral();
  const hf = healthFactor(pos);
  assert.ok(Math.abs(hf - 1.3026) < 1e-3, `Expected ~1.3026, got ${hf}`);
});

// 3. makeSmallPosition() yields a different HF — small debt, HF > 10
test('smallPosition HF > 10', () => {
  const pos = makeSmallPosition();
  const hf = healthFactor(pos);
  assert.ok(hf > 10, `Expected HF > 10, got ${hf}`);
});

// 4. snapshot(pos) returns a deep-clone; mutating the clone does not affect the original
test('snapshot is a deep clone', () => {
  const original = makeWorkedExample();
  const clone = snapshot(original);
  clone.collaterals[0].priceUsd = 1000;
  assert.equal(original.collaterals[0].priceUsd, 3000);
});

// 5. crashWETH(workedExample, 0.02, 6) returns 6 ticks, each with strictly decreasing price and HF
test('crashWETH 6 steps × -2% yields 6 ticks with decreasing price and HF', () => {
  const pos = makeWorkedExample();
  const ticks = crashWETH(pos, 0.02, 6);
  assert.equal(ticks.length, 6);
  for (let i = 0; i < ticks.length; i++) {
    assert.equal(ticks[i].step, i);
    assert.ok(ticks[i].priceAfter < ticks[i].priceBefore, `Step ${i}: expected priceAfter < priceBefore`);
    assert.ok(ticks[i].hfAfter < ticks[i].hfBefore, `Step ${i}: expected hfAfter < hfBefore`);
  }
});

// 6. After -2%/step × 6, the workedExample's WETH price drops from 3000 to 3000 * 0.98^6 ≈ 2657.53 (within ±1)
test('crashWETH 6 steps lands WETH price at ≈ 2657.53', () => {
  const pos = makeWorkedExample();
  crashWETH(pos, 0.02, 6);
  const finalPrice = pos.collaterals[0].priceUsd;
  assert.ok(Math.abs(finalPrice - 2657.53) < 1.0, `Expected ~2657.53, got ${finalPrice}`);
});

// 7. After -2%/step × 6, HF drops below the trigger band (1.20). Assert HF < 1.20.
test('crashWETH 6 steps drops HF below 1.20 trigger', () => {
  const pos = makeWorkedExample();
  crashWETH(pos, 0.02, 6);
  const hf = healthFactor(pos);
  assert.ok(hf < 1.20, `Expected HF < 1.20, got ${hf}`);
});

// 8. crashUSDC(workedExample, 0.02, 6) increases D, decreasing HF (debt asset crash)
test('crashUSDC 6 steps increases debt and reduces HF', () => {
  const pos = makeWorkedExample();
  const initialHF = healthFactor(pos);
  const ticks = crashUSDC(pos, 0.02, 6);
  const finalHF = healthFactor(pos);
  assert.equal(ticks.length, 6);
  assert.ok(finalHF < initialHF, `Expected final HF (${finalHF}) < initial HF (${initialHF})`);
  assert.ok(pos.debts[0].priceUsd > 1.0, 'Debt price should increase on crashUSDC');
});

// 9. recoverCollateral(workedExample, 'WETH', 0.02, 6) reverses a prior 6-step crash within ±1 unit of original price
test('recoverCollateral reverses a prior crash', () => {
  const pos = makeWorkedExample();
  const initialPrice = pos.collaterals[0].priceUsd;
  crashWETH(pos, 0.02, 6);
  recoverCollateral(pos, 'WETH', 0.02, 6);
  const restoredPrice = pos.collaterals[0].priceUsd;
  assert.ok(Math.abs(restoredPrice - initialPrice) < 1.0, `Expected ~${initialPrice}, got ${restoredPrice}`);
});

// 10. crashCollateral on a symbol not in the position throws
test('crashCollateral on missing symbol throws', () => {
  const pos = makeWorkedExample();
  assert.throws(() => crashCollateral(pos, 'UNKNOWN_SYMBOL', 0.02, 6));
});
