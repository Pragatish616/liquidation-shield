/**
 * E-mode / isolation-mode detection and refusal. plan.md §3.4.
 *
 * v1 scope: explicitly refuse rather than silently mis-price. Handling
 * e-mode/isolation correctly means using the e-mode category's LT/LTV (or
 * the isolation debt-ceiling-constrained LT) instead of each reserve's own
 * config -- out of scope here; refusing loudly is the documented,
 * acceptable choice (plan.md: "Handle it or explicitly refuse ... refusing
 * loudly is fine. Silently mis-sizing is not.").
 *
 * Siloed borrowing is deliberately NOT a refusal condition: unlike e-mode
 * and isolation mode, it only restricts which combinations of assets can
 * be borrowed together -- it does not change the LT/LTV values our HF sum
 * uses, so it cannot make our calculation wrong. It's still surfaced in
 * `reasons` for visibility.
 */

export class PositionRefusedError extends Error {
  constructor(public readonly reason: string) {
    super(`refusing to protect this position: ${reason}`);
    this.name = 'PositionRefusedError';
  }
}

export function assertNotEMode(userEModeCategoryId: number): void {
  if (userEModeCategoryId !== 0) {
    throw new PositionRefusedError(
      `user is in E-Mode category ${userEModeCategoryId} -- v1 does not compute ` +
        `E-Mode-adjusted LT/LTV and would silently mis-price this position`,
    );
  }
}

/**
 * Isolation mode is active when the user's only collateral-enabled reserve
 * has a non-zero debt ceiling. debtCeilingByAsset should cover exactly the
 * reserves the user has usageAsCollateralEnabledOnUser = true for.
 */
export function assertNotIsolationMode(
  collateralEnabledAssets: string[],
  debtCeilingByAsset: Map<string, bigint>,
): void {
  if (collateralEnabledAssets.length !== 1) return;
  const asset = collateralEnabledAssets[0]!;
  const debtCeiling = debtCeilingByAsset.get(asset) ?? 0n;
  if (debtCeiling > 0n) {
    throw new PositionRefusedError(
      `user's sole collateral (${asset}) has a non-zero debt ceiling -- ` +
        `position is in isolation mode, whose effective LT v1 does not compute`,
    );
  }
}
