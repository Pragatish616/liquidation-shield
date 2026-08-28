export type Side = 'collateral' | 'debt';

export interface Leg {
  symbol: string;
  amount: number;
  priceUsd: number;
  liquidationThreshold?: number; // required for collateral, ignored for debt
  kappa?: number;                // round-trip cost fraction (collateral only)
}

export interface Position {
  collaterals: Leg[];
  debts: Leg[];
}

export interface PlanCandidate {
  symbol: string;
  V: number;             // USD value of collateral to release
  R: number;             // USD value of debt to repay (= V * (1 - kappa))
  kappa: number;
  LT: number;
  feasible: boolean;
  capitalBurned: number; // V * kappa
}

export interface InterventionPlan {
  mode: 'MODE2_FLASH' | 'MODE1_EXTERNAL' | 'HOLD';
  chosen?: PlanCandidate;
  ranked: PlanCandidate[];
  targetHF: number;
  currentHF: number;
  reason?: string;
}

export interface ViabilityResult {
  act: boolean;
  netBenefit: number;
  E_no_action: number;
  E_action: number;
  closeFactor: number;
  liquidationBonus: number;
}

export function healthFactor(pos: Position): number {
  const A = pos.collaterals.reduce(
    (sum, c) => sum + c.amount * c.priceUsd * (c.liquidationThreshold ?? 0),
    0
  );
  const D = pos.debts.reduce(
    (sum, d) => sum + d.amount * d.priceUsd,
    0
  );
  if (D === 0) return Infinity;
  return A / D;
}

export function mode1Repay(pos: Position, targetHF: number): number {
  const A = pos.collaterals.reduce(
    (sum, c) => sum + c.amount * c.priceUsd * (c.liquidationThreshold ?? 0),
    0
  );
  const D = pos.debts.reduce(
    (sum, d) => sum + d.amount * d.priceUsd,
    0
  );
  const requiredD = A / targetHF;
  const repay = D - requiredD;
  return repay > 0 ? repay : 0;
}

export function mode2Vmin(pos: Position, targetHF: number, kappa: number, LTj: number): number {
  const A = pos.collaterals.reduce(
    (sum, c) => sum + c.amount * c.priceUsd * (c.liquidationThreshold ?? 0),
    0
  );
  const D = pos.debts.reduce(
    (sum, d) => sum + d.amount * d.priceUsd,
    0
  );
  const denom = targetHF * (1 - kappa) - LTj;
  if (denom <= 0) return Infinity;
  const num = targetHF * D - A;
  return num / denom;
}

export function isFeasible(targetHF: number, kappa: number, LTj: number): boolean {
  return targetHF * (1 - kappa) > LTj;
}

export function rankCollateral(pos: Position, targetHF: number): PlanCandidate[] {
  const candidates: PlanCandidate[] = pos.collaterals.map((c) => {
    const LT = c.liquidationThreshold ?? 0;
    const kappa = c.kappa ?? 0;
    const feasible = isFeasible(targetHF, kappa, LT);

    if (!feasible) {
      return {
        symbol: c.symbol,
        V: 0,
        R: 0,
        kappa,
        LT,
        feasible: false,
        capitalBurned: Infinity,
      };
    }

    const V = mode2Vmin(pos, targetHF, kappa, LT);
    const R = V * (1 - kappa);
    const capitalBurned = V * kappa;

    return {
      symbol: c.symbol,
      V,
      R,
      kappa,
      LT,
      feasible: true,
      capitalBurned,
    };
  });

  return candidates.sort((a, b) => {
    if (a.feasible && !b.feasible) return -1;
    if (!a.feasible && b.feasible) return 1;
    return a.capitalBurned - b.capitalBurned;
  });
}

export function viability(
  pos: Position,
  planObj: InterventionPlan,
  pLiq: number,
  gasUsd: number,
  theta: number = 0
): ViabilityResult {
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

  const E_no_action = pLiq * closeFactor * D * liquidationBonus;

  const chosen = planObj.chosen;
  const E_action = (chosen && chosen.feasible) ? chosen.capitalBurned + gasUsd : Infinity;
  const netBenefit = E_no_action - E_action;
  const act = netBenefit > theta;

  return {
    act,
    netBenefit,
    E_no_action,
    E_action,
    closeFactor,
    liquidationBonus,
  };
}

export function plan(
  pos: Position,
  targetHF: number,
  pLiq: number,
  gasUsd: number,
  theta: number = 0
): InterventionPlan {
  const currentHF = healthFactor(pos);
  const ranked = rankCollateral(pos, targetHF);

  const best = ranked.find((candidate) => candidate.feasible);

  if (!best) {
    return {
      mode: 'HOLD',
      ranked,
      targetHF,
      currentHF,
      reason: 'no feasible collateral',
    };
  }

  const tempPlan: InterventionPlan = {
    mode: 'MODE2_FLASH',
    chosen: best,
    ranked,
    targetHF,
    currentHF,
  };

  const v = viability(pos, tempPlan, pLiq, gasUsd, theta);

  if (!v.act) {
    return {
      mode: 'HOLD',
      chosen: best,
      ranked,
      targetHF,
      currentHF,
      reason: `intervention cost $${v.E_action.toFixed(2)} exceeds expected loss $${v.E_no_action.toFixed(2)} - theta ${theta}`,
    };
  }

  return {
    mode: 'MODE2_FLASH',
    chosen: best,
    ranked,
    targetHF,
    currentHF,
  };
}
