import type { Position, InterventionPlan } from '../health.ts';
import { healthFactor, plan } from '../health.ts';
import { snapshot } from '../mock/position.ts';
import { quoteRoute, quoteAllRoutes } from './quote.ts';

export function planPosition(
  pos: Position,
  targetHF: number,
  pLiq: number,
  gasUsd: number,
  debtSymbol: string,
  theta?: number
): InterventionPlan {
  if (targetHF <= 0) {
    throw new Error('targetHF must be positive');
  }
  if (!debtSymbol || debtSymbol.trim() === '') {
    throw new Error('debtSymbol cannot be empty or whitespace');
  }

  const posCopy = snapshot(pos);

  const quotes = quoteAllRoutes(posCopy, debtSymbol);
  for (const c of posCopy.collaterals) {
    const q = quotes[c.symbol] ?? quoteRoute(c.symbol, debtSymbol);
    c.kappa = q > 0 ? q : (c.kappa && c.kappa > 0 ? c.kappa : 0.0055);
  }

  return plan(posCopy, targetHF, pLiq, gasUsd, theta);
}

export function planWithCounterfactual(
  pos: Position,
  targetHF: number,
  pLiq: number,
  gasUsd: number,
  debtSymbol: string,
  theta?: number
): {
  plan: InterventionPlan;
  counterfactual: {
    expectedLossNoAction: number;
    currentHF: number;
    targetHF: number;
  };
} {
  const planRes = planPosition(pos, targetHF, pLiq, gasUsd, debtSymbol, theta);
  const currentHF = healthFactor(pos);
  const closeFactor = currentHF >= 0.95 ? 0.5 : 1.0;

  let largestVal = -1;
  let largestSymbol = '';
  for (const c of pos.collaterals) {
    const val = c.amount * c.priceUsd;
    if (val > largestVal) {
      largestVal = val;
      largestSymbol = c.symbol;
    }
  }

  const liquidationBonus = largestSymbol.toUpperCase() === 'WBTC' ? 0.10 : 0.05;
  const D = pos.debts.reduce((sum, d) => sum + d.amount * d.priceUsd, 0);

  const expectedLossNoAction = pLiq * closeFactor * D * liquidationBonus;

  return {
    plan: planRes,
    counterfactual: {
      expectedLossNoAction,
      currentHF,
      targetHF,
    },
  };
}
