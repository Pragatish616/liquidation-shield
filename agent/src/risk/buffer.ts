/**
 * Dynamic safety buffer — the setpoint (targetHF), the trigger HF, and
 * urgency classification. See plan.md §4.3-4.4.
 *
 * Hₜ = 1 + max( floorBuffer, z · sigmaPerSec · sqrt(reactionWindowSec) ) · oracleStalenessMultiplier
 * clamped to [minTargetHF, maxTargetHF].
 *
 * HF_trigger = 1 + (Hₜ − 1) · triggerFraction
 *
 * This is the mechanism that satisfies the PS's "dynamic safety buffer, not
 * a fixed threshold" requirement — it widens when volatility rises or the
 * reaction window (worst-case time until the next intervention opportunity)
 * grows.
 */

import type { SigmaPerSec } from './ewma';
import type { PLiq } from './hitting';

export type RiskPolicy = {
  /** confidence multiplier on the volatility term, e.g. 2.0 ≈ 97.7% one-sided */
  z: number;
  /** worst-case seconds until the next intervention opportunity: keeper interval + block time + congestion allowance */
  reactionWindowSec: number;
  /** small multiplier > 1 covering oracle staleness (Chainlink heartbeat/deviation lag) */
  oracleStalenessMultiplier: number;
  /** never target a buffer below this, whatever the model says */
  floorBuffer: number;
  minTargetHF: number;
  maxTargetHF: number;
  /** trigger fires once this fraction of the buffer above 1.0 has been lost */
  triggerFraction: number;
  /**
   * Horizon (seconds) that pLiq is computed over for urgency classification.
   * The 0.5%/5% thresholds below come from plan.md §4.2's sanity table, which
   * is scaled for 1h-24h horizons -- they are meaningless applied to a
   * pLiq computed over the ~300s reaction window (that pLiq is always
   * near-zero regardless of real risk, which is why urgency used to only
   * ever land on 'none' or 'emergency').
   */
  urgencyHorizonSec: number;
  urgencyThresholds: {
    watchPLiq: number;
    actPLiq: number;
    emergencyHF: number;
  };
};

// Calibrated against the real measured sigma in data/prices/ (WETH/USDC,
// sigmaPerSec ~7.7e-5 -- see buffer.test.ts). floorBuffer and minTargetHF are
// safety floors, but they must stay BELOW the model's typical output under
// realistic-to-elevated volatility, or the "dynamic" buffer just returns the
// floor at every reading, unconditionally. reactionWindowSec is deliberately
// the worst case (keeper interval + block time + congestion allowance), not
// the best case -- see plan.md §4.3.
export const DEFAULT_POLICY: RiskPolicy = {
  z: 2.0,
  reactionWindowSec: 3600,
  oracleStalenessMultiplier: 1.05,
  floorBuffer: 0.02,
  minTargetHF: 1.02,
  maxTargetHF: 2.0,
  triggerFraction: 0.6,
  urgencyHorizonSec: 86400,
  urgencyThresholds: {
    watchPLiq: 0.005,
    actPLiq: 0.05,
    emergencyHF: 1.02,
  },
};

export function targetHealthFactor(sigmaPerSec: SigmaPerSec, policy: RiskPolicy = DEFAULT_POLICY): number {
  const volTerm = policy.z * sigmaPerSec * Math.sqrt(policy.reactionWindowSec);
  const buffer = Math.max(policy.floorBuffer, volTerm);
  const raw = 1 + buffer * policy.oracleStalenessMultiplier;
  return Math.min(policy.maxTargetHF, Math.max(policy.minTargetHF, raw));
}

export function triggerHealthFactor(targetHF: number, policy: RiskPolicy = DEFAULT_POLICY): number {
  return 1 + (targetHF - 1) * policy.triggerFraction;
}

export type Urgency = 'none' | 'watch' | 'act' | 'emergency';

export function classifyUrgency(
  hf: number,
  pLiq: PLiq,
  policy: RiskPolicy = DEFAULT_POLICY,
): Urgency {
  if (hf < policy.urgencyThresholds.emergencyHF) return 'emergency';
  if (pLiq >= policy.urgencyThresholds.actPLiq) return 'act';
  if (pLiq >= policy.urgencyThresholds.watchPLiq) return 'watch';
  return 'none';
}
