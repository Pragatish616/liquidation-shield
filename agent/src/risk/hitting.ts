/**
 * Liquidation-hitting probability via the reflection principle for a
 * zero-drift GBM collateral/debt exchange rate. See plan.md §4.2.
 *
 * Canonical unit for sigma throughout this module and the rest of the
 * codebase is PER-SECOND (see plan.md §8). Callers holding an hourly (or
 * any other period) sigma must convert explicitly before calling:
 *   sigmaPerSec = sigmaPerPeriod / Math.sqrt(periodSeconds)
 */

import type { SigmaPerSec } from './ewma';

/** Branded liquidation probability. Construct via asPLiq(), never a bare `as` cast. */
export type PLiq = number & { readonly __brand: 'PLiq' };

export function asPLiq(n: number): PLiq {
  return n as PLiq;
}

/** Standard normal CDF via the Abramowitz-Stegun 7.1.26 erf approximation (max abs error ~1.5e-7). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/**
 * P(liquidation within horizonSec), given the current health factor and the
 * per-second volatility of the collateral/debt exchange rate.
 *
 * P_liq(T) = 2 * Φ( -ln(HF) / (sigmaPerSec * sqrt(T)) )
 */
export function pLiquidation(hf: number, sigmaPerSec: SigmaPerSec, horizonSec: number): PLiq {
  if (hf <= 1) return asPLiq(1);
  if (horizonSec <= 0) return asPLiq(0);
  if (sigmaPerSec <= 0) return asPLiq(0); // no volatility, driftless GBM never crosses a barrier below

  const b = Math.log(hf); // distance to barrier in log space, b > 0 since hf > 1
  const s = sigmaPerSec * Math.sqrt(horizonSec);
  return asPLiq(Math.min(1, 2 * normalCdf(-b / s)));
}
