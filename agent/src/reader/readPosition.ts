/**
 * Build a full PositionSnapshot for a user in a small number of multicalls,
 * all pinned to the same block number (plan.md §3.2 -- reading across
 * blocks is how you get an HF that never quite matches).
 *
 * Two rounds, both pinned to `block`:
 *   1. account-level data (getUserAccountData, getUserEMode) + every listed
 *      reserve's getUserReserveData for this user, to find which reserves
 *      they actually touch.
 *   2. for only the touched reserves: full reserve config, token addresses,
 *      oracle price, and debt ceiling.
 * Round 2 is itself four same-shaped multicalls (config / tokens / price /
 * debt ceiling) rather than one interleaved call, so each result array
 * indexes directly against `touched[i]` -- no stride arithmetic.
 */

import { type Address, type PublicClient } from 'viem';
import { makePublicClient, resolveAaveAddresses } from './addresses';
import { poolAbi, poolDataProviderAbi, aaveOracleAbi } from './abis';
import { assertNotEMode, assertNotIsolationMode } from './emode';
import type { PositionSnapshot, CollateralLeg, DebtLeg } from '../types';

type ReserveToken = { address: Address; symbol: string };

let reservesCache: ReserveToken[] | null = null;

async function getAllReserves(
  client: PublicClient,
  poolDataProvider: Address,
): Promise<ReserveToken[]> {
  if (reservesCache) return reservesCache;
  const result = await client.readContract({
    address: poolDataProvider,
    abi: poolDataProviderAbi,
    functionName: 'getAllReservesTokens',
  });
  reservesCache = result.map((r) => ({ address: r.tokenAddress, symbol: r.symbol }));
  return reservesCache;
}

const MAX_UINT256 = 2n ** 256n - 1n;

export async function readPosition(
  user: Address,
  blockNumber?: bigint,
  client: PublicClient = makePublicClient(),
): Promise<PositionSnapshot> {
  const { pool, poolDataProvider, oracle } = await resolveAaveAddresses(client);
  const block = blockNumber ?? (await client.getBlockNumber());
  const reserves = await getAllReserves(client, poolDataProvider);

  const [accountData, userEMode, userReserveResults] = await Promise.all([
    client.readContract({
      address: pool,
      abi: poolAbi,
      functionName: 'getUserAccountData',
      args: [user],
      blockNumber: block,
    }),
    client.readContract({
      address: pool,
      abi: poolAbi,
      functionName: 'getUserEMode',
      args: [user],
      blockNumber: block,
    }),
    client.multicall({
      contracts: reserves.map(
        (r) =>
          ({
            address: poolDataProvider,
            abi: poolDataProviderAbi,
            functionName: 'getUserReserveData',
            args: [r.address, user],
          }) as const,
      ),
      allowFailure: false,
      blockNumber: block,
    }),
  ]);

  assertNotEMode(Number(userEMode));

  const touched: { reserve: ReserveToken; aTokenBalance: bigint; variableDebt: bigint; collateralEnabled: boolean }[] =
    [];
  reserves.forEach((reserve, i) => {
    const [aTokenBalance, , currentVariableDebt, , , , , , usageAsCollateralEnabled] = userReserveResults[i]!;
    if (aTokenBalance > 0n || currentVariableDebt > 0n) {
      touched.push({
        reserve,
        aTokenBalance,
        variableDebt: currentVariableDebt,
        collateralEnabled: usageAsCollateralEnabled,
      });
    }
  });

  const configResults =
    touched.length > 0
      ? await client.multicall({
          contracts: touched.map(
            ({ reserve }) =>
              ({
                address: poolDataProvider,
                abi: poolDataProviderAbi,
                functionName: 'getReserveConfigurationData',
                args: [reserve.address],
              }) as const,
          ),
          allowFailure: false,
          blockNumber: block,
        })
      : [];

  const tokenResults =
    touched.length > 0
      ? await client.multicall({
          contracts: touched.map(
            ({ reserve }) =>
              ({
                address: poolDataProvider,
                abi: poolDataProviderAbi,
                functionName: 'getReserveTokensAddresses',
                args: [reserve.address],
              }) as const,
          ),
          allowFailure: false,
          blockNumber: block,
        })
      : [];

  const priceResults =
    touched.length > 0
      ? await client.multicall({
          contracts: touched.map(
            ({ reserve }) =>
              ({
                address: oracle,
                abi: aaveOracleAbi,
                functionName: 'getAssetPrice',
                args: [reserve.address],
              }) as const,
          ),
          allowFailure: false,
          blockNumber: block,
        })
      : [];

  const debtCeilingResults =
    touched.length > 0
      ? await client.multicall({
          contracts: touched.map(
            ({ reserve }) =>
              ({
                address: poolDataProvider,
                abi: poolDataProviderAbi,
                functionName: 'getDebtCeiling',
                args: [reserve.address],
              }) as const,
          ),
          allowFailure: false,
          blockNumber: block,
        })
      : [];

  const collateral: CollateralLeg[] = [];
  const debt: DebtLeg[] = [];
  const collateralEnabledAssets: string[] = [];
  const debtCeilingByAsset = new Map<string, bigint>();

  touched.forEach((t, i) => {
    const [decimals, , liquidationThreshold, liquidationBonus] = configResults[i]!;
    const [aToken, , variableDebtToken] = tokenResults[i]!;
    const priceUsd = priceResults[i]!;
    const debtCeiling = debtCeilingResults[i]!;

    debtCeilingByAsset.set(t.reserve.address, debtCeiling);

    if (t.aTokenBalance > 0n) {
      const valueUsd = (Number(t.aTokenBalance) / 10 ** Number(decimals)) * (Number(priceUsd) / 1e8);
      collateral.push({
        asset: t.reserve.address,
        symbol: t.reserve.symbol,
        decimals: Number(decimals),
        balance: t.aTokenBalance,
        priceUsd,
        valueUsd,
        ltBps: Number(liquidationThreshold),
        liquidationBonusBps: Number(liquidationBonus),
        usedAsCollateral: t.collateralEnabled,
        aToken,
      });
      if (t.collateralEnabled) collateralEnabledAssets.push(t.reserve.address);
    }

    if (t.variableDebt > 0n) {
      const valueUsd = (Number(t.variableDebt) / 10 ** Number(decimals)) * (Number(priceUsd) / 1e8);
      debt.push({
        asset: t.reserve.address,
        symbol: t.reserve.symbol,
        decimals: Number(decimals),
        balance: t.variableDebt,
        priceUsd,
        valueUsd,
        variableDebtToken,
      });
    }
  });

  assertNotIsolationMode(collateralEnabledAssets, debtCeilingByAsset);

  const totalCollateralUsd = collateral.reduce((sum, c) => sum + c.valueUsd, 0);
  const weightedCollateralUsd = collateral
    .filter((c) => c.usedAsCollateral)
    .reduce((sum, c) => sum + c.valueUsd * (c.ltBps / 10_000), 0);
  const totalDebtUsd = debt.reduce((sum, d) => sum + d.valueUsd, 0);
  const healthFactor = totalDebtUsd > 0 ? weightedCollateralUsd / totalDebtUsd : Infinity;

  const onChainHF = accountData[5];
  const onChainHealthFactor = onChainHF === MAX_UINT256 ? Infinity : Number(onChainHF) / 1e18;

  const blockInfo = await client.getBlock({ blockNumber: block });

  return {
    user,
    blockNumber: block,
    timestamp: Number(blockInfo.timestamp),
    collateral,
    debt,
    totalCollateralUsd,
    weightedCollateralUsd,
    totalDebtUsd,
    healthFactor,
    onChainHealthFactor,
  };
}
