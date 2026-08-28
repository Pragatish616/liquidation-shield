import { describe, it, expect } from 'vitest';
import { hasPriceHistory, loadAlignedSeries } from './priceHistory';

describe('hasPriceHistory', () => {
  it('is true for cached symbols', () => {
    expect(hasPriceHistory('WETH')).toBe(true);
    expect(hasPriceHistory('USDC')).toBe(true);
  });

  it('is false for an uncached symbol', () => {
    expect(hasPriceHistory('USDG')).toBe(false);
  });
});

describe('loadAlignedSeries', () => {
  it('loads WETH/USDC aligned to common timestamps, dropping the unaligned trailing point', () => {
    const { a, b } = loadAlignedSeries('WETH', 'USDC');
    expect(a.length).toBeGreaterThan(2000);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]!.t).toBe(b[i]!.t);
    }
    // WETH trades at hundreds-to-thousands of USD; USDC near $1.
    expect(a[0]!.price).toBeGreaterThan(100);
    expect(b[0]!.price).toBeGreaterThan(0.9);
    expect(b[0]!.price).toBeLessThan(1.1);
  });

  it('throws a clear error for an uncached symbol', () => {
    expect(() => loadAlignedSeries('WETH', 'USDG')).toThrow(/no cached price history for USDG/);
  });
});
