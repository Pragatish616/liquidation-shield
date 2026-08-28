import { describe, it, expect } from 'vitest';
import {
  targetHealthFactor,
  triggerHealthFactor,
  classifyUrgency,
  DEFAULT_POLICY,
  type RiskPolicy,
} from './buffer';
import { asSigmaPerSec } from './ewma';
import { asPLiq } from './hitting';

describe('targetHealthFactor — dynamic buffer requirement', () => {
  it('strictly increases as sigma increases, holding everything else fixed', () => {
    const policy: RiskPolicy = { ...DEFAULT_POLICY, reactionWindowSec: 3600 };
    const t1 = targetHealthFactor(asSigmaPerSec(0.001), policy);
    const t2 = targetHealthFactor(asSigmaPerSec(0.002), policy);
    const t3 = targetHealthFactor(asSigmaPerSec(0.003), policy);
    expect(t2).toBeGreaterThan(t1);
    expect(t3).toBeGreaterThan(t2);
  });

  it('strictly increases as reactionWindowSec increases, holding everything else fixed', () => {
    const base: RiskPolicy = { ...DEFAULT_POLICY };
    const t1 = targetHealthFactor(asSigmaPerSec(0.002), { ...base, reactionWindowSec: 600 });
    const t2 = targetHealthFactor(asSigmaPerSec(0.002), { ...base, reactionWindowSec: 3600 });
    const t3 = targetHealthFactor(asSigmaPerSec(0.002), { ...base, reactionWindowSec: 14_400 });
    expect(t2).toBeGreaterThan(t1);
    expect(t3).toBeGreaterThan(t2);
  });

  it('doubling reactionWindowSec visibly widens targetHF (acceptance criterion 4)', () => {
    const base: RiskPolicy = { ...DEFAULT_POLICY, reactionWindowSec: 300 };
    const doubled: RiskPolicy = { ...base, reactionWindowSec: 600 };
    const before = targetHealthFactor(asSigmaPerSec(0.002), base);
    const after = targetHealthFactor(asSigmaPerSec(0.002), doubled);
    expect(after).toBeGreaterThan(before);
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
    const target = targetHealthFactor(asSigmaPerSec(0.002), DEFAULT_POLICY);
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
