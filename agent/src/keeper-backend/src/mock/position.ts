import type { Position } from '../health.ts';

// Returns the OVERVIEW.md §5 worked example (10 WETH + 19k USDC debt)
export function makeWorkedExample(): Position {
  return {
    collaterals: [
      { symbol: 'WETH', amount: 10, priceUsd: 3000, liquidationThreshold: 0.825, kappa: 0.0105 },
    ],
    debts: [
      { symbol: 'USDC', amount: 19000, priceUsd: 1 },
    ],
  };
}

// Returns a small position used for the "correct refusal" scenario
// 0.1 WETH @ $3000 LT 0.825 κ 0.0105 + 20 USDC @ $1 (small debt, HF > 10)
export function makeSmallPosition(): Position {
  return {
    collaterals: [
      { symbol: 'WETH', amount: 0.1, priceUsd: 3000, liquidationThreshold: 0.825, kappa: 0.0105 },
    ],
    debts: [
      { symbol: 'USDC', amount: 20, priceUsd: 1 },
    ],
  };
}

// Returns a multi-collateral position used for the collateral-selection test
// USDC 5000 @ $1 LT 0.86 κ 0.0055
// WETH 10 @ $3000 LT 0.825 κ 0.0105
// WBTC 0.5 @ $60000 LT 0.78 κ 0.0125
// wstETH 5 @ $3300 LT 0.79 κ 0.0165
// debt: 19000 USDC @ $1
export function makeMultiCollateral(): Position {
  return {
    collaterals: [
      { symbol: 'USDC',  amount: 0,     priceUsd: 1,     liquidationThreshold: 0.86,  kappa: 0.0055 },
      { symbol: 'WETH',  amount: 10,    priceUsd: 3000,  liquidationThreshold: 0.825, kappa: 0.0105 },
      { symbol: 'WBTC',  amount: 0,     priceUsd: 60000, liquidationThreshold: 0.78,  kappa: 0.0125 },
      { symbol: 'wstETH',amount: 0,     priceUsd: 3300,  liquidationThreshold: 0.79,  kappa: 0.0165 },
    ],
    debts: [
      { symbol: 'USDC', amount: 19000, priceUsd: 1 },
    ],
  };
}

// Deep-clone a Position. Required because the crash feeder mutates in place
// and the keeper/test wants a snapshot at each tick.
export function snapshot(pos: Position): Position {
  return {
    collaterals: pos.collaterals.map((c) => ({ ...c })),
    debts: pos.debts.map((d) => ({ ...d })),
  };
}
