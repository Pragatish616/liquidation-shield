import type { Position } from '../health.ts';

// Mock DEX quote. Given a (collateral → debt asset) route, returns the
// round-trip cost fraction κ. Deterministic per (symbolFrom, symbolTo) pair.
//
// κ table (locked from OVERVIEW §5):
//   USDC → debt asset: 0.0055   (deepest liquidity)
//   WETH → debt asset: 0.0105
//   WBTC → debt asset: 0.0125
//   wstETH → debt asset: 0.0165
//   anything else:      0.0150  (default, conservative)
//
// Returns 0 if the symbol is the same as the debt asset (no swap needed).
export function quoteRoute(collateralSymbol: string, debtSymbol: string): number {
  if (!collateralSymbol || collateralSymbol.trim() === '') {
    throw new Error('Collateral symbol cannot be empty or whitespace');
  }
  if (!debtSymbol || debtSymbol.trim() === '') {
    throw new Error('Debt symbol cannot be empty or whitespace');
  }

  const colUpper = collateralSymbol.trim().toUpperCase();
  const debtUpper = debtSymbol.trim().toUpperCase();

  if (colUpper === debtUpper) {
    return 0;
  }

  switch (colUpper) {
    case 'USDC':
      return 0.0055;
    case 'WETH':
      return 0.0105;
    case 'WBTC':
      return 0.0125;
    case 'WSTETH':
      return 0.0165;
    default:
      return 0.0150;
  }
}

// Convenience: returns κ for *every* collateral leg in the position, as
// { symbol → κ }. Used by the planner to attach κ to Legs before ranking.
export function quoteAllRoutes(pos: Position, debtSymbol: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const c of pos.collaterals) {
    result[c.symbol] = quoteRoute(c.symbol, debtSymbol);
  }
  return result;
}
