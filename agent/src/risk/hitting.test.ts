import { describe, it, expect } from 'vitest';
import { pLiquidation, normalCdf } from './hitting';
import { asSigmaPerSec, type SigmaPerSec } from './ewma';

const HOUR = 3600;

/** Convert an hourly-sampled sigma into the module's canonical per-second unit. */
function sigmaPerSecFromHourly(sigmaHourly: number): SigmaPerSec {
  return asSigmaPerSec(sigmaHourly / Math.sqrt(HOUR));
}

describe('normalCdf', () => {
  it('is 0.5 at 0', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
  });
  it('approaches 0 and 1 in the tails', () => {
    expect(normalCdf(-6)).toBeCloseTo(0, 6);
    expect(normalCdf(6)).toBeCloseTo(1, 6);
  });
  it('matches known values', () => {
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
});

describe('pLiquidation — fixture table (plan.md §4.2)', () => {
  it.each([
    [1.30, 0.01, HOUR, 0.0],
    [1.02, 0.02, HOUR, 0.3221],
    [1.10, 0.03, 6 * HOUR, 0.1946],
    [1.05, 0.05, 24 * HOUR, 0.8421],
  ])('hf=%s sigmaHourly=%s horizonSec=%s -> P=%s', (hf, sigmaHourly, horizonSec, expected) => {
    const sigmaPerSec = sigmaPerSecFromHourly(sigmaHourly);
    expect(pLiquidation(hf, sigmaPerSec, horizonSec)).toBeCloseTo(expected, 3);
  });
});

describe('pLiquidation — boundary and monotonicity properties', () => {
  it('P -> 1 as HF -> 1 (from above)', () => {
    const sigmaPerSec = sigmaPerSecFromHourly(0.02);
    expect(pLiquidation(1.0001, sigmaPerSec, HOUR)).toBeGreaterThan(0.9);
  });

  it('P = 1 when HF <= 1 (already liquidatable)', () => {
    expect(pLiquidation(1.0, asSigmaPerSec(0.001), HOUR)).toBe(1);
    expect(pLiquidation(0.95, asSigmaPerSec(0.001), HOUR)).toBe(1);
  });

  it('P -> 0 as sigma -> 0', () => {
    expect(pLiquidation(1.3, asSigmaPerSec(1e-9), HOUR)).toBeCloseTo(0, 6);
    expect(pLiquidation(1.3, asSigmaPerSec(0), HOUR)).toBe(0);
  });

  it('is monotonically increasing in horizon T, holding HF and sigma fixed', () => {
    const sigmaPerSec = sigmaPerSecFromHourly(0.02);
    const p1 = pLiquidation(1.1, sigmaPerSec, HOUR);
    const p2 = pLiquidation(1.1, sigmaPerSec, 6 * HOUR);
    const p3 = pLiquidation(1.1, sigmaPerSec, 24 * HOUR);
    expect(p2).toBeGreaterThan(p1);
    expect(p3).toBeGreaterThan(p2);
  });

  it('is monotonically increasing in sigma, holding HF and T fixed', () => {
    const p1 = pLiquidation(1.1, sigmaPerSecFromHourly(0.01), HOUR);
    const p2 = pLiquidation(1.1, sigmaPerSecFromHourly(0.03), HOUR);
    const p3 = pLiquidation(1.1, sigmaPerSecFromHourly(0.05), HOUR);
    expect(p2).toBeGreaterThan(p1);
    expect(p3).toBeGreaterThan(p2);
  });

  it('is monotonically decreasing in HF, holding sigma and T fixed', () => {
    // Use a longer horizon so all three probabilities stay well above the
    // erf approximation's float-underflow floor and the inequality is meaningful.
    const sigmaPerSec = sigmaPerSecFromHourly(0.05);
    const p1 = pLiquidation(1.02, sigmaPerSec, 24 * HOUR);
    const p2 = pLiquidation(1.05, sigmaPerSec, 24 * HOUR);
    const p3 = pLiquidation(1.10, sigmaPerSec, 24 * HOUR);
    expect(p1).toBeGreaterThan(p2);
    expect(p2).toBeGreaterThan(p3);
  });
});
