/**
 * Seed a controllable Aave v3 borrower on the local fork. plan.md §2.2(b).
 *
 * Usage:
 *   tsx scripts/seedPosition.ts --collateral WETH --amount 10 --debt USDC --debtAmount 19000
 *
 * Uses Anvil's default account #0 (well-known "test test test ... junk"
 * mnemonic key -- public, zero real value, safe to hardcode for a local
 * fork only). Wraps ETH into WETH via WETH's own deposit(), so it needs no
 * cheatcode/storage-write tricks.
 */

import { createWalletClient, http, parseUnits, formatUnits, type Address } from 'viem';
import { mainnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { pathToFileURL } from 'node:url';
import { AaveV3Ethereum } from '@bgd-labs/aave-address-book';
import { LOCAL_RPC_URL } from '../agent/src/config';
import { makePublicClient, resolveAaveAddresses } from '../agent/src/reader/addresses';
import { poolDataProviderAbi } from '../agent/src/reader/abis';

// Anvil default account #0 -- publicly known test key, local fork only.
const SEED_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

const wethAbi = [
  { type: 'function', name: 'deposit', stateMutability: 'payable', inputs: [], outputs: [] },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

const poolWriteAbi = [
  {
    type: 'function',
    name: 'supply',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'onBehalfOf', type: 'address' },
      { name: 'referralCode', type: 'uint16' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setUserUseReserveAsCollateral',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'useAsCollateral', type: 'bool' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'borrow',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'interestRateMode', type: 'uint256' },
      { name: 'referralCode', type: 'uint16' },
      { name: 'onBehalfOf', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getUserAccountData',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      { name: 'totalCollateralBase', type: 'uint256' },
      { name: 'totalDebtBase', type: 'uint256' },
      { name: 'availableBorrowsBase', type: 'uint256' },
      { name: 'currentLiquidationThreshold', type: 'uint256' },
      { name: 'ltv', type: 'uint256' },
      { name: 'healthFactor', type: 'uint256' },
    ],
  },
] as const;

const SUPPORTED_ASSETS: Record<string, { underlying: Address; decimals: number }> = {
  WETH: { underlying: AaveV3Ethereum.ASSETS.WETH.UNDERLYING, decimals: 18 },
  USDC: { underlying: AaveV3Ethereum.ASSETS.USDC.UNDERLYING, decimals: 6 },
};

function parseArgs(argv: string[]) {
  const get = (flag: string, fallback: string): string => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
  };
  return {
    collateral: get('--collateral', 'WETH'),
    amount: get('--amount', '10'),
    debt: get('--debt', 'USDC'),
    debtAmount: get('--debtAmount', '19000'),
  };
}

export async function seedPosition(
  collateralSymbol: string,
  collateralAmountHuman: string,
  debtSymbol: string,
  debtAmountHuman: string,
) {
  const collateral = SUPPORTED_ASSETS[collateralSymbol];
  const debt = SUPPORTED_ASSETS[debtSymbol];
  if (!collateral) throw new Error(`unsupported collateral asset: ${collateralSymbol}`);
  if (!debt) throw new Error(`unsupported debt asset: ${debtSymbol}`);

  const account = privateKeyToAccount(SEED_PRIVATE_KEY);
  const publicClient = makePublicClient();
  const walletClient = createWalletClient({ account, chain: mainnet, transport: http(LOCAL_RPC_URL) });
  const { pool } = await resolveAaveAddresses(publicClient);

  const collateralAmount = parseUnits(collateralAmountHuman, collateral.decimals);
  const debtAmount = parseUnits(debtAmountHuman, debt.decimals);

  console.log(`Seeding user ${account.address}`);

  // Only WETH supports the deposit()-wrap shortcut; other collateral assets
  // would need a swap or `deal`-style storage write, out of scope for v1.
  if (collateralSymbol !== 'WETH') {
    throw new Error('seedPosition currently only supports WETH as the collateral asset');
  }

  // borrow() re-validates the user's full account health factor across every
  // reserve, which is gas-heavy; viem's eth_estimateGas came in short and
  // the tx ran OutOfGas (silently -- waitForTransactionReceipt does not
  // throw on a reverted tx). Pass an explicit generous gas limit on every
  // write here and hard-fail on any non-success receipt.
  const GAS_LIMIT = 3_000_000n;

  async function confirm(label: string, hash: `0x${string}`) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') {
      throw new Error(`${label} reverted (tx ${hash}, status=${receipt.status})`);
    }
    return receipt;
  }

  await confirm(
    'wrap ETH -> WETH',
    await walletClient.writeContract({
      address: collateral.underlying,
      abi: wethAbi,
      functionName: 'deposit',
      value: collateralAmount,
      gas: GAS_LIMIT,
    }),
  );
  console.log(`1/4 wrapped ${collateralAmountHuman} ETH -> WETH`);

  await confirm(
    'approve pool for WETH',
    await walletClient.writeContract({
      address: collateral.underlying,
      abi: wethAbi,
      functionName: 'approve',
      args: [pool, collateralAmount],
      gas: GAS_LIMIT,
    }),
  );

  await confirm(
    'supply',
    await walletClient.writeContract({
      address: pool,
      abi: poolWriteAbi,
      functionName: 'supply',
      args: [collateral.underlying, collateralAmount, account.address, 0],
      gas: GAS_LIMIT,
    }),
  );
  console.log(`2/4 supplied ${collateralAmountHuman} ${collateralSymbol} to the pool`);

  await confirm(
    'setUserUseReserveAsCollateral',
    await walletClient.writeContract({
      address: pool,
      abi: poolWriteAbi,
      functionName: 'setUserUseReserveAsCollateral',
      args: [collateral.underlying, true],
      gas: GAS_LIMIT,
    }),
  );
  console.log(`3/4 enabled ${collateralSymbol} as collateral`);

  await confirm(
    'borrow',
    await walletClient.writeContract({
      address: pool,
      abi: poolWriteAbi,
      functionName: 'borrow',
      args: [debt.underlying, debtAmount, 2n, 0, account.address],
      gas: GAS_LIMIT,
    }),
  );
  console.log(`4/4 borrowed ${debtAmountHuman} ${debtSymbol} (variable rate)`);

  const accountData = await publicClient.readContract({
    address: pool,
    abi: poolWriteAbi,
    functionName: 'getUserAccountData',
    args: [account.address],
  });

  const healthFactor = Number(accountData[5]) / 1e18;
  console.log(`\nUser: ${account.address}`);
  console.log(`Total collateral (USD, 8dp): ${formatUnits(accountData[0], 8)}`);
  console.log(`Total debt (USD, 8dp):       ${formatUnits(accountData[1], 8)}`);
  console.log(`Health factor:               ${healthFactor}`);

  return { user: account.address, healthFactor };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  await seedPosition(args.collateral, args.amount, args.debt, args.debtAmount);
}
