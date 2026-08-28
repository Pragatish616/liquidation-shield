import type { Position } from '../health.ts';
import { healthFactor } from '../health.ts';

export interface CrashTick {
  step: number;          // 0, 1, 2, ...
  symbol: string;        // 'WETH' / 'USDC' / 'WBTC' / 'wstETH'
  priceBefore: number;
  priceAfter: number;
  hfBefore: number;
  hfAfter: number;
}

// Apply N equal-sized multiplicative drops to a collateral or debt symbol's price.
// percentPerStep is positive (e.g. 0.02 for -2% per step).
// Mutates the position in place and returns the per-tick audit trail.
export function crashCollateral(
  pos: Position,
  symbol: string,
  percentPerStep: number,
  steps: number
): CrashTick[] {
  if (steps <= 0) {
    throw new Error('steps must be greater than 0');
  }
  if (percentPerStep < 0 || percentPerStep >= 1) {
    throw new Error('percentPerStep must be in [0, 1)');
  }

  const colLeg = pos.collaterals.find((c) => c.symbol.toUpperCase() === symbol.toUpperCase());
  const debtLeg = pos.debts.find((d) => d.symbol.toUpperCase() === symbol.toUpperCase());

  if (!colLeg && !debtLeg) {
    throw new Error(`Symbol ${symbol} not found in position collaterals or debts`);
  }

  const ticks: CrashTick[] = [];

  for (let i = 0; i < steps; i++) {
    const priceBefore = colLeg ? colLeg.priceUsd : debtLeg!.priceUsd;
    const hfBefore = healthFactor(pos);

    if (colLeg) {
      colLeg.priceUsd = priceBefore * (1 - percentPerStep);
    } else if (debtLeg) {
      debtLeg.priceUsd = priceBefore * (1 + percentPerStep);
    }

    const priceAfter = colLeg ? colLeg.priceUsd : debtLeg!.priceUsd;
    const hfAfter = healthFactor(pos);

    ticks.push({
      step: i,
      symbol,
      priceBefore,
      priceAfter,
      hfBefore,
      hfAfter,
    });
  }

  return ticks;
}

// Convenience: crash WETH (the worked-example collateral).
export function crashWETH(pos: Position, percentPerStep: number, steps: number): CrashTick[] {
  return crashCollateral(pos, 'WETH', percentPerStep, steps);
}

// Convenience: crash USDC (the worked-example debt).
// Note: crashing the debt asset increases D, which reduces HF — useful for the "thin market" demo later.
export function crashUSDC(pos: Position, percentPerStep: number, steps: number): CrashTick[] {
  return crashCollateral(pos, 'USDC', percentPerStep, steps);
}

// Convenience: crash WBTC (for the WBTC-leg demo).
export function crashWBTC(pos: Position, percentPerStep: number, steps: number): CrashTick[] {
  return crashCollateral(pos, 'WBTC', percentPerStep, steps);
}

// Helper: recover (multiply price back up). Used by scenarios that need to restore HF after a crash.
export function recoverCollateral(
  pos: Position,
  symbol: string,
  percentPerStep: number,
  steps: number
): CrashTick[] {
  if (steps <= 0) {
    throw new Error('steps must be greater than 0');
  }
  if (percentPerStep < 0 || percentPerStep >= 1) {
    throw new Error('percentPerStep must be in [0, 1)');
  }

  const colLeg = pos.collaterals.find((c) => c.symbol.toUpperCase() === symbol.toUpperCase());
  const debtLeg = pos.debts.find((d) => d.symbol.toUpperCase() === symbol.toUpperCase());

  if (!colLeg && !debtLeg) {
    throw new Error(`Symbol ${symbol} not found in position collaterals or debts`);
  }

  const ticks: CrashTick[] = [];

  for (let i = 0; i < steps; i++) {
    const priceBefore = colLeg ? colLeg.priceUsd : debtLeg!.priceUsd;
    const hfBefore = healthFactor(pos);

    if (colLeg) {
      colLeg.priceUsd = priceBefore / (1 - percentPerStep);
    } else if (debtLeg) {
      debtLeg.priceUsd = priceBefore / (1 + percentPerStep);
    }

    const priceAfter = colLeg ? colLeg.priceUsd : debtLeg!.priceUsd;
    const hfAfter = healthFactor(pos);

    ticks.push({
      step: i,
      symbol,
      priceBefore,
      priceAfter,
      hfBefore,
      hfAfter,
    });
  }

  return ticks;
}
