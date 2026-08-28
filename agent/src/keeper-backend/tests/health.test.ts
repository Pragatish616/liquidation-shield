import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Position } from '../src/health.ts';
import {
  healthFactor,
  mode1Repay,
  mode2Vmin,
  isFeasible,
  rankCollateral,
  plan,
  viability,
} from '../src/health.ts';

const workedExample: Position = {
  collaterals: [
    { symbol: 'USDC',  amount: 0,  priceUsd: 1,     liquidationThreshold: 0.86,  kappa: 0.0055 },
    { symbol: 'WETH',  amount: 10, priceUsd: 3000,  liquidationThreshold: 0.825, kappa: 0.0105 },
    { symbol: 'WBTC',  amount: 0,  priceUsd: 60000, liquidationThreshold: 0.78,  kappa: 0.0125 },
    { symbol: 'wstETH',amount: 0,  priceUsd: 3300,  liquidationThreshold: 0.79,  kappa: 0.0165 },
  ],
  debts: [
    { symbol: 'USDC', amount: 19000, priceUsd: 1 },
  ],
};

const multiCollateral: Position = workedExample;

const smallPosition: Position = {
  collaterals: [
    { symbol: 'WETH', amount: 0.1, priceUsd: 3000, liquidationThreshold: 0.825, kappa: 0.0105 },
  ],
  debts: [
    { symbol: 'USDC', amount: 400, priceUsd: 1 },
  ],
};

test('1. healthFactor(workedExample) ≈ 1.3026', () => {
  const hf = healthFactor(workedExample);
  assert.ok(Math.abs(hf - 1.3026) < 1e-3, `Expected ~1.3026, got ${hf}`);
});

test('2. healthFactor(multiCollateral) ≈ 1.3026', () => {
  const hf = healthFactor(multiCollateral);
  assert.ok(Math.abs(hf - 1.3026) < 1e-3, `Expected ~1.3026, got ${hf}`);
});

test('3. mode2Vmin(workedExample, 1.35, 0.0105, 0.825) for WETH ≈ 1761.86', () => {
  const v = mode2Vmin(workedExample, 1.35, 0.0105, 0.825);
  assert.ok(Math.abs(v - 1761.86) < 1.0, `Expected ~1761.86, got ${v}`);
});

test('4. isFeasible(1.35, 0.0105, 0.825) (WETH) is true', () => {
  assert.equal(isFeasible(1.35, 0.0105, 0.825), true);
});

test('5. isFeasible(1.35, 0.0165, 0.79) (wstETH) is true', () => {
  assert.equal(isFeasible(1.35, 0.0165, 0.79), true);
});

test('6. isFeasible(1.35, 0.0055, 0.86) (USDC) is true', () => {
  assert.equal(isFeasible(1.35, 0.0055, 0.86), true);
});

test('7. isFeasible fails when H_t*(1-κ) <= LT_j', () => {
  assert.equal(isFeasible(0.8, 0.0055, 0.86), false);
});

test('8. rankCollateral(multiCollateral, 1.35)[0].symbol === "USDC"', () => {
  const ranked = rankCollateral(multiCollateral, 1.35);
  assert.equal(ranked[0].symbol, 'USDC');
});

test('9. rankCollateral(multiCollateral, 1.35)[0].capitalBurned ≈ 10.26', () => {
  const ranked = rankCollateral(multiCollateral, 1.35);
  assert.ok(Math.abs(ranked[0].capitalBurned - 10.26) < 0.2, `Expected ~10.26, got ${ranked[0].capitalBurned}`);
});

test('10. plan(workedExample, 1.35, 0.05, 5).mode === "MODE2_FLASH"', () => {
  const p = plan(workedExample, 1.35, 0.05, 5);
  assert.equal(p.mode, 'MODE2_FLASH');
});

test('11. plan(workedExample, 1.35, 0.05, 5).chosen?.symbol === "USDC"', () => {
  const p = plan(workedExample, 1.35, 0.05, 5);
  assert.equal(p.chosen?.symbol, 'USDC');
});

test('12. plan(smallPosition, 1.35, 0.001, 15).mode === "HOLD"', () => {
  const p = plan(smallPosition, 1.35, 0.001, 15);
  assert.equal(p.mode, 'HOLD');
});

test('13. plan(smallPosition, 1.35, 0.001, 15).reason contains "$" or number', () => {
  const p = plan(smallPosition, 1.35, 0.001, 15);
  assert.ok(typeof p.reason === 'string' && p.reason.length > 0, 'Reason must be non-empty');
  assert.ok(p.reason.includes('$') || /\d/.test(p.reason), `Reason missing $ or number: ${p.reason}`);
});

test('14. viability(workedExample, planForWorked, 0.05, 5).act === true', () => {
  const planForWorked = plan(workedExample, 1.35, 0.05, 5);
  const v = viability(workedExample, planForWorked, 0.05, 5);
  assert.equal(v.act, true);
});

test('15. viability(smallPosition, planForSmall, 0.001, 15).act === false', () => {
  const planForSmall = plan(smallPosition, 1.35, 0.001, 15);
  const v = viability(smallPosition, planForSmall, 0.001, 15);
  assert.equal(v.act, false);
});
