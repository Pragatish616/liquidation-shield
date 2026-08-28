import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Position } from '../src/health.ts';
import {
  makeWorkedExample,
  makeSmallPosition,
  makeMultiCollateral,
} from '../src/mock/position.ts';
import { quoteRoute, quoteAllRoutes } from '../src/planner/quote.ts';
import { planPosition, planWithCounterfactual } from '../src/planner/planner.ts';

// --- quote.ts tests ---

// 1. quoteRoute('USDC', 'USDC') === 0
test('1. quoteRoute returns 0 when collateral and debt are the same', () => {
  assert.equal(quoteRoute('USDC', 'USDC'), 0);
});

// 2. quoteRoute('USDC', 'WETH') === 0.0055
test('2. quoteRoute USDC → debt = 0.0055', () => {
  assert.equal(quoteRoute('USDC', 'WETH'), 0.0055);
});

// 3. quoteRoute('WETH', 'USDC') === 0.0105
test('3. quoteRoute WETH → USDC = 0.0105', () => {
  assert.equal(quoteRoute('WETH', 'USDC'), 0.0105);
});

// 4. quoteRoute('WBTC', 'USDC') === 0.0125
test('4. quoteRoute WBTC → USDC = 0.0125', () => {
  assert.equal(quoteRoute('WBTC', 'USDC'), 0.0125);
});

// 5. quoteRoute('wstETH', 'USDC') === 0.0165
test('5. quoteRoute wstETH → USDC = 0.0165', () => {
  assert.equal(quoteRoute('wstETH', 'USDC'), 0.0165);
});

// 6. quoteAllRoutes attaches κ to all 4 collateral legs in makeMultiCollateral()
test('6. quoteAllRoutes returns κ for every collateral', () => {
  const pos = makeMultiCollateral();
  const quotes = quoteAllRoutes(pos, 'USDC');
  assert.equal(quotes['USDC'], 0);
  assert.equal(quotes['WETH'], 0.0105);
  assert.equal(quotes['WBTC'], 0.0125);
  assert.equal(quotes['wstETH'], 0.0165);
});

// 7. quoteRoute throws on empty symbol
test('7. quoteRoute throws on empty symbol', () => {
  assert.throws(() => quoteRoute('', 'USDC'));
  assert.throws(() => quoteRoute('  ', 'USDC'));
});


// --- planner.ts tests ---

// 8. planPosition(makeMultiCollateral(), 1.35, 0.05, 5, 'USDC').mode === 'MODE2_FLASH'
test('8. planPosition picks MODE2_FLASH for healthy-but-trending multi-collateral', () => {
  const pos = makeMultiCollateral();
  const p = planPosition(pos, 1.35, 0.05, 5, 'USDC');
  assert.equal(p.mode, 'MODE2_FLASH');
});

// 9. planPosition(makeMultiCollateral(), 1.35, 0.05, 5, 'USDC').chosen?.symbol === 'USDC'
test('9. planPosition chooses USDC over WETH', () => {
  const pos = makeMultiCollateral();
  const p = planPosition(pos, 1.35, 0.05, 5, 'USDC');
  assert.equal(p.chosen?.symbol, 'USDC');
});

// 10. planPosition(makeMultiCollateral(), 1.35, 0.05, 5, 'USDC').chosen?.capitalBurned ≈ $10.26 (±0.2)
test('10. planPosition USDC capitalBurned ≈ $10.26', () => {
  const pos = makeMultiCollateral();
  const p = planPosition(pos, 1.35, 0.05, 5, 'USDC');
  const burned = p.chosen?.capitalBurned ?? 0;
  assert.ok(Math.abs(burned - 10.26) < 0.2, `Expected ~10.26, got ${burned}`);
});

// 11. planPosition(makeSmallPosition(), 1.35, 0.001, 15, 'USDC').mode === 'HOLD'
test('11. planPosition holds on small position when intervention cost exceeds expected loss', () => {
  const pos = makeSmallPosition();
  const p = planPosition(pos, 1.35, 0.001, 15, 'USDC');
  assert.equal(p.mode, 'HOLD');
});

// 12. planPosition(makeSmallPosition(), 1.35, 0.001, 15, 'USDC').reason is non-empty and contains a number
test('12. planPosition HOLD reason is non-empty and contains a number', () => {
  const pos = makeSmallPosition();
  const p = planPosition(pos, 1.35, 0.001, 15, 'USDC');
  assert.ok(typeof p.reason === 'string' && p.reason.length > 0);
  assert.ok(p.reason.includes('$') || /\d/.test(p.reason));
});

// 13. planWithCounterfactual returns expectedLossNoAction > 0 for the worked example
test('13. planWithCounterfactual returns positive expected loss no-action', () => {
  const pos = makeWorkedExample();
  const res = planWithCounterfactual(pos, 1.35, 0.05, 5, 'USDC');
  assert.ok(res.counterfactual.expectedLossNoAction > 0);
});

// 14. planPosition does NOT mutate the caller's position
test('14. planPosition is non-mutating', () => {
  const pos = makeWorkedExample();
  const initialPrice = pos.collaterals[0].priceUsd;
  planPosition(pos, 1.35, 0.05, 5, 'USDC');
  assert.equal(pos.collaterals[0].priceUsd, initialPrice);
});

// 15. planPosition(makeWorkedExample(), 1.35, 0.05, 5, 'USDC').chosen?.capitalBurned is finite and < 50
test('15. planPosition capital burned is sane', () => {
  const pos = makeWorkedExample();
  const p = planPosition(pos, 1.35, 0.05, 5, 'USDC');
  const burned = p.chosen?.capitalBurned ?? Infinity;
  assert.ok(Number.isFinite(burned) && burned < 50, `Expected finite < 50, got ${burned}`);
});
