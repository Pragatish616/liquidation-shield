import { describe, it, expect } from 'vitest';
import {
  targetHealthFactor,
  triggerHealthFactor,
  classifyUrgency,
  DEFAULT_POLICY,
  type RiskPolicy,
} from './buffer';
import { asSigmaPerSec, computeSigmaPerSec } from './ewma';
import { asPLiq } from './hitting';
import { loadAlignedSeries } from './priceHistory';

// The real measured sigma (WETH/USDC, data/prices/) is ~7.7e-5 per-second.
// Earlier versions of these tests fed asSigmaPerSec(0.002) -- ~26x that
// value, and unreachable in practice -- which let every assertion here pass
// regardless of whether DEFAULT_POLICY's floorBuffer/minTargetHF were
// miscalibrated to swallow the model's real output. Deriving sigma from the
// committed cache is what actually catches that class of bug.
const { a: collateralSeries, b: debtSeries } = loadAlignedSeries('WETH', 'USDC');
const REAL_SIGMA = computeSigmaPerSec(collateralSeries, debtSeries);

// reactionWindowSec long enough that z*REAL_SIGMA*sqrt(T) clears
// DEFAULT_POLICY.floorBuffer (0.02) at REAL_SIGMA. Below this the model term
// is floor-pinned and every policy produces the same targetHF, which would
// make the monotonicity assertions below vacuous (equal, not strictly
// greater) instead of actually exercising the model.
const REALISTIC_WINDOW_SEC = 21_600; // 6h

describe('targetHealthFactor — dynamic buffer requirement', () => {
  it('strictly increases as sigma increases, holding everything else fixed', () => {
    const policy: RiskPolicy = { ...DEFAULT_POLICY, reactionWindowSec: REALISTIC_WINDOW_SEC };
    const t1 = targetHealthFactor(REAL_SIGMA, policy);
    const t2 = targetHealthFactor(asSigmaPerSec(REAL_SIGMA * 1.5), policy);
    const t3 = targetHealthFactor(asSigmaPerSec(REAL_SIGMA * 2), policy);
    expect(t2).toBeGreaterThan(t1);
    expect(t3).toBeGreaterThan(t2);
  });

  it('strictly increases as reactionWindowSec increases, holding everything else fixed', () => {
    const t1 = targetHealthFactor(REAL_SIGMA, { ...DEFAULT_POLICY, reactionWindowSec: 21_600 });
    const t2 = targetHealthFactor(REAL_SIGMA, { ...DEFAULT_POLICY, reactionWindowSec: 43_200 });
    const t3 = targetHealthFactor(REAL_SIGMA, { ...DEFAULT_POLICY, reactionWindowSec: 86_400 });
    expect(t2).toBeGreaterThan(t1);
    expect(t3).toBeGreaterThan(t2);
  });

  it('doubling reactionWindowSec visibly widens targetHF (acceptance criterion 4)', () => {
    const base: RiskPolicy = { ...DEFAULT_POLICY, reactionWindowSec: REALISTIC_WINDOW_SEC };
    const doubled: RiskPolicy = { ...base, reactionWindowSec: REALISTIC_WINDOW_SEC * 2 };
    const before = targetHealthFactor(REAL_SIGMA, base);
    const after = targetHealthFactor(REAL_SIGMA, doubled);
    expect(after).toBeGreaterThan(before);
  });

  it('at realistic sigma, is NOT pinned to the floor (regression guard)', () => {
    // DEFAULT_POLICY's actual production reactionWindowSec (3600s) with real
    // calm-market sigma floor-pins -- that's the floor doing its job in a
    // quiet market, and is asserted explicitly below. What must NOT happen
    // is the model being unable to ever escape the floor at any realistic
    // input: a 3x-real sigma is a modest, plausible stress-scenario bump
    // (crashes routinely move realized vol several-fold) and must move
    // targetHF off the floor under the real, unmodified DEFAULT_POLICY.
    const floorPinnedValue = 1 + DEFAULT_POLICY.floorBuffer * DEFAULT_POLICY.oracleStalenessMultiplier;
    expect(targetHealthFactor(REAL_SIGMA, DEFAULT_POLICY)).toBeCloseTo(floorPinnedValue, 10);

    const stressedSigma = asSigmaPerSec(REAL_SIGMA * 3);
    const result = targetHealthFactor(stressedSigma, DEFAULT_POLICY);
    expect(result).toBeGreaterThan(floorPinnedValue);
  });

  it('never drops below the floor buffer even at zero volatility', () => {
    const t = targetHealthFactor(asSigmaPerSec(0), DEFAULT_POLICY);
    expect(t).toBeGreaterThanOrEqual(1 + DEFAULT_POLICY.floorBuffer * 0.999);
  });

  it('clamps to [minTargetHF, maxTargetHF]', () => {
    const low = targetHealthFactor(asSigmaPerSec(0), DEFAULT_POLICY);
    expect(low).toBeGreaterThanOrEqual(DEFAULT_POLICY.minTargetHF);

    const extreme = targetHealthFactor(asSigmaPerSec(10), { ...DEFAULT_POLICY, reactionWindowSec: 3600 });
    expect(extreme).toBeLessThanOrEqual(DEFAULT_POLICY.maxTargetHF);
  });
});

describe('triggerHealthFactor', () => {
  it('is strictly below targetHF (deadband, prevents oscillation)', () => {
    const target = targetHealthFactor(REAL_SIGMA, {
      ...DEFAULT_POLICY,
      reactionWindowSec: REALISTIC_WINDOW_SEC,
    });
    const trigger = triggerHealthFactor(target, DEFAULT_POLICY);
    expect(trigger).toBeLessThan(target);
    expect(trigger).toBeGreaterThan(1);
  });

  it('matches the documented formula: 1 + (target-1)*fraction', () => {
    expect(triggerHealthFactor(1.35, DEFAULT_POLICY)).toBeCloseTo(1 + 0.35 * 0.6, 10);
  });
});

describe('classifyUrgency', () => {
  it('is none when pLiq is negligible and hf is healthy', () => {
    expect(classifyUrgency(1.3, asPLiq(0.001), DEFAULT_POLICY)).toBe('none');
  });

  it('is watch when pLiq crosses the watch threshold', () => {
    expect(classifyUrgency(1.3, asPLiq(0.01), DEFAULT_POLICY)).toBe('watch');
  });

  it('is act when pLiq crosses the act threshold', () => {
    expect(classifyUrgency(1.15, asPLiq(0.06), DEFAULT_POLICY)).toBe('act');
  });

  it('is emergency when hf drops below the emergency threshold regardless of pLiq', () => {
    expect(classifyUrgency(1.01, asPLiq(0.0), DEFAULT_POLICY)).toBe('emergency');
  });
});
