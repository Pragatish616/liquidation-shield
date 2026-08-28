/**
 * Wire the reader + risk model into assess(user) -> RiskAssessment.
 * plan.md §5. Sigma is computed from the position's dominant collateral
 * and dominant debt leg's exchange rate (by USD value) -- collapsing a
 * multi-collateral position to a single effective rate is an explicit,
 * documented approximation (plan.md §4.2's caveats), not an oversight.
 */

import type { Address } from 'viem';
import { pathToFileURL } from 'node:url';
import { readPosition } from '../reader/readPosition';
import { computeSigmaPerSec, type SigmaPerSec } from './ewma';
import { loadAlignedSeries, hasPriceHistory } from './priceHistory';
import { pLiquidation } from './hitting';
import {
  targetHealthFactor,
  triggerHealthFactor,
  classifyUrgency,
  DEFAULT_POLICY,
  type RiskPolicy,
} from './buffer';
import { REACTION_WINDOW_SEC as ENV_REACTION_WINDOW_SEC, RISK_Z as ENV_RISK_Z } from '../config';
import type { RiskAssessment } from '../types';

const DAY_SEC = 86400;

function dominantLeg<T extends { symbol: string; valueUsd: number }>(legs: T[]): T {
  if (legs.length === 0) throw new Error('position has no legs to assess');
  return legs.reduce((max, leg) => (leg.valueUsd > max.valueUsd ? leg : max));
}

export async function assess(
  user: Address,
  policyOverrides?: Partial<RiskPolicy>,
  sigmaOverride?: SigmaPerSec,
): Promise<RiskAssessment> {
  const snapshot = await readPosition(user);
  const reasons: string[] = [];

  // Layering: RiskPolicy's own defaults < env (a runtime knob, no source
  // edit needed -- see plan.md §7 acceptance criterion 4) < explicit
  // policyOverrides argument (callers, e.g. a scenario script, get the
  // final say).
  const envOverrides: Partial<RiskPolicy> = {};
  if (ENV_REACTION_WINDOW_SEC !== undefined) envOverrides.reactionWindowSec = ENV_REACTION_WINDOW_SEC;
  if (ENV_RISK_Z !== undefined) envOverrides.z = ENV_RISK_Z;
  const policy: RiskPolicy = { ...DEFAULT_POLICY, ...envOverrides, ...policyOverrides };

  const collateralLeg = dominantLeg(snapshot.collateral);
  const debtLeg = dominantLeg(snapshot.debt);
  reasons.push(
    `dominant collateral leg: ${collateralLeg.symbol} ($${collateralLeg.valueUsd.toFixed(2)}), ` +
      `dominant debt leg: ${debtLeg.symbol} ($${debtLeg.valueUsd.toFixed(2)})`,
  );

  if (!hasPriceHistory(collateralLeg.symbol) || !hasPriceHistory(debtLeg.symbol)) {
    throw new Error(
      `no cached price history for ${collateralLeg.symbol}/${debtLeg.symbol} -- ` +
        `see data/prices/ (Step 7) and agent/src/risk/priceHistory.ts's PRICE_FILE_BY_SYMBOL`,
    );
  }

  const { a: collateralSeries, b: debtSeries } = loadAlignedSeries(collateralLeg.symbol, debtLeg.symbol);
  const modelSigma = computeSigmaPerSec(collateralSeries, debtSeries);
  reasons.push(
    `sigma (per-second, EWMA lambda=0.97 over ${collateralSeries.length} hourly ` +
      `${collateralLeg.symbol}/${debtLeg.symbol} samples): ${modelSigma.toExponential(4)}`,
  );

  // data/prices/ is a static cache -- it cannot react to a fork price crash,
  // so without this override the buffer can never widen during the live
  // demo (plan.md §4.1 option 3).
  const sigma = sigmaOverride ?? modelSigma;
  if (sigmaOverride !== undefined) {
    reasons.push(`sigma overridden by scenario: ${sigma.toExponential(4)} per-sec`);
  }

  const reactionWindowSec = policy.reactionWindowSec;

  const targetHF = targetHealthFactor(sigma, policy);
  const triggerHF = triggerHealthFactor(targetHF, policy);
  reasons.push(
    `targetHF=${targetHF.toFixed(4)}, triggerHF=${triggerHF.toFixed(4)} ` +
      `(reactionWindowSec=${reactionWindowSec}, z=${policy.z})`,
  );

  const pLiq = pLiquidation(snapshot.healthFactor, sigma, reactionWindowSec);
  const pLiq24h = pLiquidation(snapshot.healthFactor, sigma, DAY_SEC);
  reasons.push(
    `P(liquidation within ${reactionWindowSec}s) = ${(pLiq * 100).toFixed(4)}%, ` +
      `P(within 24h) = ${(pLiq24h * 100).toFixed(4)}%`,
  );

  // Urgency is classified over policy.urgencyHorizonSec, not the ~300s-4h
  // reaction window -- the watch/act thresholds are calibrated for a 1h-24h
  // horizon (plan.md §4.2's sanity table) and pLiq over the reaction window
  // alone is always near-zero, which is why urgency used to only ever land
  // on 'none' or 'emergency'.
  const pLiqUrgency = pLiquidation(snapshot.healthFactor, sigma, policy.urgencyHorizonSec);
  const urgency = classifyUrgency(snapshot.healthFactor, pLiqUrgency, policy);
  reasons.push(
    `urgency=${urgency} (HF=${snapshot.healthFactor.toFixed(4)}, driven by ` +
      `P(liquidation within ${policy.urgencyHorizonSec}s) = ${(pLiqUrgency * 100).toFixed(4)}%)`,
  );

  return {
    snapshot,
    sigma,
    reactionWindowSec,
    pLiq,
    pLiq24h,
    triggerHF,
    targetHF,
    urgency,
    reasons,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const user = process.argv[2] as Address | undefined;
  if (!user) {
    console.error('usage: tsx agent/src/risk/assess.ts <address>');
    process.exit(1);
  }
  const report = await assess(user);
  console.log(
    JSON.stringify(
      report,
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
      2,
    ),
  );
}
