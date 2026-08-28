import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotToUserPosition } from '../src/real/adapter.ts';
import type { PositionSnapshot } from '../../../types.ts';

function fakeSnapshot(): PositionSnapshot {
  return {
    user: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    blockNumber: 1n,
    timestamp: 0,
    collateral: [
      {
        asset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        symbol: 'WETH',
        decimals: 18,
        balance: 10_000000000000000000n,
        priceUsd: 251491075416n, // 8dp -> $2514.91
        valueUsd: 25149.11,
        ltBps: 8300,
        liquidationBonusBps: 10500,
        usedAsCollateral: true,
        aToken: '0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8',
      },
      {
        // Not collateral-enabled: must be excluded from the adapter's output.
        asset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        symbol: 'USDC',
        decimals: 6,
        balance: 1_000000n,
        priceUsd: 100000000n,
        valueUsd: 1,
        ltBps: 8600,
        liquidationBonusBps: 10500,
        usedAsCollateral: false,
        aToken: '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c',
      },
    ],
    debt: [
      {
        asset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        symbol: 'USDC',
        decimals: 6,
        balance: 19_000000000n,
        priceUsd: 100000000n,
        valueUsd: 19000,
        variableDebtToken: '0x72E95b8931767C79bA4EeE721354d6E99a61D004',
      },
    ],
    totalCollateralUsd: 25150.11,
    weightedCollateralUsd: 20873.76,
    totalDebtUsd: 19000,
    healthFactor: 1.0986,
    onChainHealthFactor: 1.0986,
  };
}

test('snapshotToUserPosition converts price/lt units and excludes non-collateral legs', () => {
  const pos = snapshotToUserPosition(fakeSnapshot());

  assert.equal(pos.collaterals.length, 1); // USDC (usedAsCollateral=false) excluded
  const weth = pos.collaterals[0]!;
  assert.equal(weth.symbol, 'WETH');
  assert.ok(Math.abs(weth.priceUsd - 2514.91075416) < 1e-6);
  assert.ok(Math.abs(weth.lt - 0.83) < 1e-9);
  assert.equal(weth.balanceUsd, 25149.11);
  assert.equal(weth.approvalRemainingUsd, 25149.11); // default: fully approved

  assert.equal(pos.debts.length, 1);
  assert.equal(pos.debts[0]!.debtUsd, 19000);
  assert.equal(pos.totalRiskWeightedCollateralUsd, 20873.76);
  assert.equal(pos.currentHF, 1.0986);
});

test('snapshotToUserPosition honors an explicit approval override', () => {
  const pos = snapshotToUserPosition(fakeSnapshot(), {
    approvalRemainingUsdByAsset: {
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 500,
    },
  });

  assert.equal(pos.collaterals[0]!.approvalRemainingUsd, 500);
});
