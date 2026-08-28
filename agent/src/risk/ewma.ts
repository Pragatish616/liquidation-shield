/**
 * EWMA volatility estimator over the collateral/debt exchange rate.
 * See plan.md §4.1. Canonical output unit is PER-SECOND sigma (plan.md §8) —
 * callers get sigmaPerSec directly from computeSigmaPerSec, never a raw
 * per-sample sigma, to avoid the classic per-second/per-hour mixup.
 */

export type PricePoint = { t: number; price: number }; // t = unix seconds

export function logReturns(series: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) {
    out.push(Math.log(series[i] / series[i - 1]));
  }
  return out;
}

/**
 * sigma^2_t = lambda * sigma^2_{t-1} + (1-lambda) * r_t^2
 * Seeded with the first squared return (no prior variance available).
 */
export function ewmaVariance(returns: number[], lambda: number): number {
  if (returns.length === 0) return 0;
  let variance = returns[0] * returns[0];
  for (let i = 1; i < returns.length; i++) {
    variance = lambda * variance + (1 - lambda) * returns[i] * returns[i];
  }
  return variance;
}

export function ewmaVolatility(returns: number[], lambda: number): number {
  return Math.sqrt(ewmaVariance(returns, lambda));
}

/** Scale a sigma sampled every `sampleIntervalSec` seconds to the canonical per-second unit. */
export function sigmaPerSecond(sigmaPerSample: number, sampleIntervalSec: number): number {
  if (sampleIntervalSec <= 0) throw new Error('sampleIntervalSec must be positive');
  return sigmaPerSample / Math.sqrt(sampleIntervalSec);
}

function ratioSeries(collateral: PricePoint[], debt: PricePoint[]): number[] {
  if (collateral.length !== debt.length) {
    throw new Error(
      `collateral/debt price series length mismatch: ${collateral.length} vs ${debt.length}`,
    );
  }
  for (let i = 0; i < collateral.length; i++) {
    if (collateral[i].t !== debt[i].t) {
      throw new Error(
        `collateral/debt price series misaligned at index ${i}: ` +
          `collateral.t=${collateral[i].t} vs debt.t=${debt[i].t}`,
      );
    }
  }
  return collateral.map((c, i) => c.price / debt[i].price);
}

function medianSampleIntervalSec(points: PricePoint[]): number {
  const intervals: number[] = [];
  for (let i = 1; i < points.length; i++) intervals.push(points[i].t - points[i - 1].t);
  intervals.sort((a, b) => a - b);
  return intervals[Math.floor(intervals.length / 2)];
}

/**
 * Compute the canonical per-second sigma of the collateral/debt exchange
 * rate from two aligned (same length, same timestamps) price histories.
 * lambda defaults to 0.97 per plan.md §4.1's 1-minute-grid recommendation;
 * pass a different lambda if your series is sampled on a different grid.
 */
export function computeSigmaPerSec(
  collateral: PricePoint[],
  debt: PricePoint[],
  lambda = 0.97,
): number {
  if (collateral.length < 3) {
    throw new Error('need at least 3 price points to estimate volatility');
  }
  const ratios = ratioSeries(collateral, debt);
  const returns = logReturns(ratios);
  const sigmaSample = ewmaVolatility(returns, lambda);
  const sampleIntervalSec = medianSampleIntervalSec(collateral);
  return sigmaPerSecond(sigmaSample, sampleIntervalSec);
}
