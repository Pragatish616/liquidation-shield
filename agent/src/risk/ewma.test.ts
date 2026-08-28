import { describe, it, expect } from 'vitest';
import {
  logReturns,
  ewmaVariance,
  ewmaVolatility,
  sigmaPerSecond,
  computeSigmaPerSec,
  type PricePoint,
} from './ewma';

describe('logReturns', () => {
  it('computes log returns of a 5-point series', () => {
    const returns = logReturns([100, 102, 101, 105, 103]);
    expect(returns).toHaveLength(4);
    expect(returns[0]).toBeCloseTo(0.019803, 6);
    expect(returns[1]).toBeCloseTo(-0.009852, 6);
    expect(returns[2]).toBeCloseTo(0.038840, 6);
    expect(returns[3]).toBeCloseTo(-0.019231, 6);
  });
});

describe('ewmaVariance / ewmaVolatility — hand-computed 5-point fixture, lambda=0.9', () => {
  // Hand-computed reference series (also cross-checked with an independent
  // script — see build notes): prices = [100, 102, 101, 105, 103].
  const returns = logReturns([100, 102, 101, 105, 103]);
  const lambda = 0.9;

  it('matches the hand-computed EWMA variance', () => {
    expect(ewmaVariance(returns, lambda)).toBeCloseTo(0.00046649, 8);
  });

  it('volatility is the sqrt of variance', () => {
    expect(ewmaVolatility(returns, lambda)).toBeCloseTo(0.0215983, 6);
  });

  it('returns 0 for an empty return series', () => {
    expect(ewmaVariance([], lambda)).toBe(0);
  });
});

describe('sigmaPerSecond', () => {
  it('scales a per-sample sigma down by sqrt(sampleIntervalSec)', () => {
    const sigmaHourly = 0.02;
    const sigmaSec = sigmaPerSecond(sigmaHourly, 3600);
    expect(sigmaSec).toBeCloseTo(0.02 / 60, 10);
    // round-trip: scaling back up by sqrt(3600) must recover the hourly sigma
    expect(sigmaSec * Math.sqrt(3600)).toBeCloseTo(sigmaHourly, 10);
  });

  it('throws on a non-positive interval', () => {
    expect(() => sigmaPerSecond(0.01, 0)).toThrow();
  });
});

describe('computeSigmaPerSec', () => {
  // These fixtures deliberately use short (5-point) series to keep the math
  // hand-traceable, so they pass an explicit low minPoints override to opt
  // out of the default reliability guard (see the dedicated minPoints
  // describe block below for that guard's own tests).

  it('computes a positive per-second sigma from aligned collateral/debt series', () => {
    const t0 = 1_700_000_000;
    const step = 3600; // hourly samples
    const collateral: PricePoint[] = [3000, 3050, 3010, 3120, 3080].map((price, i) => ({
      t: t0 + i * step,
      price,
    }));
    const debt: PricePoint[] = [1, 1, 1, 1, 1].map((price, i) => ({ t: t0 + i * step, price }));

    const sigmaPerSec = computeSigmaPerSec(collateral, debt, 0.9, 3);
    expect(sigmaPerSec).toBeGreaterThan(0);
    // sanity: per-second sigma must be tiny relative to the per-hour sigma
    // it was derived from (scales down by sqrt(3600) = 60).
    expect(sigmaPerSec).toBeLessThan(0.01);
  });

  it('throws on mismatched series lengths', () => {
    const t0 = 0;
    const collateral: PricePoint[] = [1, 2, 3].map((price, i) => ({ t: t0 + i, price }));
    const debt: PricePoint[] = [1, 2].map((price, i) => ({ t: t0 + i, price }));
    expect(() => computeSigmaPerSec(collateral, debt, 0.97, 3)).toThrow(/length mismatch/);
  });

  it('throws a clear error on same-length but misaligned timestamps', () => {
    const t0 = 1_700_000_000;
    const step = 3600;
    const collateral: PricePoint[] = [3000, 3050, 3010, 3120, 3080].map((price, i) => ({
      t: t0 + i * step,
      price,
    }));
    // debt series has the same length but its 3rd timestamp (index 2) is off by one second
    const debt: PricePoint[] = [1, 1, 1, 1, 1].map((price, i) => ({
      t: t0 + i * step + (i === 2 ? 1 : 0),
      price,
    }));

    expect(() => computeSigmaPerSec(collateral, debt, 0.97, 3)).toThrow(/index 2/);
    expect(() => computeSigmaPerSec(collateral, debt, 0.97, 3)).toThrow(
      new RegExp(`collateral.t=${t0 + 2 * step}.*debt.t=${t0 + 2 * step + 1}`),
    );
  });

  it('does not throw when timestamps are well-aligned', () => {
    const t0 = 1_700_000_000;
    const step = 3600;
    const collateral: PricePoint[] = [3000, 3050, 3010, 3120, 3080].map((price, i) => ({
      t: t0 + i * step,
      price,
    }));
    const debt: PricePoint[] = [1, 1, 1, 1, 1].map((price, i) => ({ t: t0 + i * step, price }));

    expect(() => computeSigmaPerSec(collateral, debt, 0.9, 3)).not.toThrow();
  });

  describe('minPoints reliability guard', () => {
    function series(n: number, t0 = 1_700_000_000, step = 3600): PricePoint[] {
      return Array.from({ length: n }, (_, i) => ({
        t: t0 + i * step,
        price: 3000 + (i % 7) * 10, // small deterministic wiggle, never zero/negative
      }));
    }
    function flat(n: number, t0 = 1_700_000_000, step = 3600): PricePoint[] {
      return Array.from({ length: n }, (_, i) => ({ t: t0 + i * step, price: 1 }));
    }

    it('throws by default on a series shorter than 30 points, naming actual vs required', () => {
      const collateral = series(10);
      const debt = flat(10);
      expect(() => computeSigmaPerSec(collateral, debt)).toThrow(
        /insufficient price history.*got 10 points, need at least 30/,
      );
    });

    it('succeeds by default on a series with >= 30 points', () => {
      const collateral = series(30);
      const debt = flat(30);
      expect(() => computeSigmaPerSec(collateral, debt)).not.toThrow();
    });

    it('honors an explicit lower minPoints override', () => {
      const collateral = series(10);
      const debt = flat(10);
      expect(() => computeSigmaPerSec(collateral, debt, 0.97, 5)).not.toThrow();
    });

    it('still enforces a higher explicit minPoints override', () => {
      const collateral = series(10);
      const debt = flat(10);
      expect(() => computeSigmaPerSec(collateral, debt, 0.97, 50)).toThrow(
        /got 10 points, need at least 50/,
      );
    });
  });
});
