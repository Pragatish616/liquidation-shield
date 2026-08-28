/**
 * Centralized shared types. plan.md §3.3 / §5. Part 2 imports
 * RiskAssessment directly from here -- freeze this interface deliberately.
 */

import type { Address } from 'viem';

export type CollateralLeg = {
  asset: Address;
  symbol: string;
  decimals: number;
  balance: bigint; // aToken balance, underlying units
  priceUsd: bigint; // 8 decimals, from AaveOracle
  valueUsd: number; // convenience float for the solver
  ltBps: number; // liquidationThreshold, e.g. 8300 = 83%
  liquidationBonusBps: number; // e.g. 10500 -> 5% bonus
  usedAsCollateral: boolean;
  aToken: Address;
};

export type DebtLeg = {
  asset: Address;
  symbol: string;
  decimals: number;
  balance: bigint; // variable debt balance, underlying units
  priceUsd: bigint;
  valueUsd: number;
  variableDebtToken: Address;
};

export type PositionSnapshot = {
  user: Address;
  blockNumber: bigint;
  timestamp: number;
  collateral: CollateralLeg[];
  debt: DebtLeg[];
  totalCollateralUsd: number; // sum of all supplied asset values, collateral-enabled or not
  weightedCollateralUsd: number; // A = Sigma C_i * LT_i, collateral-enabled legs only
  totalDebtUsd: number; // D
  healthFactor: number; // A / D (Infinity if D == 0)
  onChainHealthFactor: number; // from getUserAccountData, for cross-check
};

export type Urgency = 'none' | 'watch' | 'act' | 'emergency';

export type RiskAssessment = {
  snapshot: PositionSnapshot;
  sigma: number; // per-second vol of the collateral/debt rate
  reactionWindowSec: number;
  pLiq: number; // over reactionWindow
  pLiq24h: number; // for the dashboard
  triggerHF: number;
  targetHF: number; // <- Ht consumed by Part 2
  urgency: Urgency;
  reasons: string[]; // human-readable, shown in dashboard + logs
};
