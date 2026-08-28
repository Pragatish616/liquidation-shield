/**
 * Resolve Aave v3 Ethereum contract addresses at runtime from
 * PoolAddressesProvider, the one address that never changes. Cross-checked
 * against @bgd-labs/aave-address-book so a resolution bug or a typo in the
 * provider address itself is caught immediately (plan.md §3.1,
 * instructions.md Step 3). Nothing else in this codebase should hand-type
 * an Aave contract address.
 */

import { createPublicClient, http, type Address, type PublicClient } from 'viem';
import { mainnet } from 'viem/chains';
import { AaveV3Ethereum } from '@bgd-labs/aave-address-book';
import { pathToFileURL } from 'node:url';
import { LOCAL_RPC_URL } from '../config';
import { poolAddressesProviderAbi } from './abis';

/** The one address that never changes — verified against OVERVIEW.md §5 and the address book. */
export const POOL_ADDRESSES_PROVIDER: Address = '0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e';

export type AaveAddresses = {
  pool: Address;
  oracle: Address;
  poolDataProvider: Address;
  aclManager: Address;
  aclAdmin: Address;
};

export function makePublicClient(rpcUrl: string = LOCAL_RPC_URL): PublicClient {
  return createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
}

export async function resolveAaveAddresses(
  client: PublicClient = makePublicClient(),
): Promise<AaveAddresses> {
  const [pool, oracle, poolDataProvider, aclManager, aclAdmin] = await Promise.all([
    client.readContract({
      address: POOL_ADDRESSES_PROVIDER,
      abi: poolAddressesProviderAbi,
      functionName: 'getPool',
    }),
    client.readContract({
      address: POOL_ADDRESSES_PROVIDER,
      abi: poolAddressesProviderAbi,
      functionName: 'getPriceOracle',
    }),
    client.readContract({
      address: POOL_ADDRESSES_PROVIDER,
      abi: poolAddressesProviderAbi,
      functionName: 'getPoolDataProvider',
    }),
    client.readContract({
      address: POOL_ADDRESSES_PROVIDER,
      abi: poolAddressesProviderAbi,
      functionName: 'getACLManager',
    }),
    client.readContract({
      address: POOL_ADDRESSES_PROVIDER,
      abi: poolAddressesProviderAbi,
      functionName: 'getACLAdmin',
    }),
  ]);

  return { pool, oracle, poolDataProvider, aclManager, aclAdmin };
}

/** Throws naming every mismatch if a resolved address disagrees with the address book. */
export function assertMatchesAddressBook(addresses: AaveAddresses): void {
  const checks: Array<[name: string, resolved: Address, expected: Address]> = [
    ['pool', addresses.pool, AaveV3Ethereum.POOL],
    ['oracle', addresses.oracle, AaveV3Ethereum.ORACLE],
    ['poolDataProvider', addresses.poolDataProvider, AaveV3Ethereum.AAVE_PROTOCOL_DATA_PROVIDER],
    ['aclManager', addresses.aclManager, AaveV3Ethereum.ACL_MANAGER],
  ];

  const mismatches = checks
    .filter(([, resolved, expected]) => resolved.toLowerCase() !== expected.toLowerCase())
    .map(([name, resolved, expected]) => `${name}: resolved=${resolved} addressBook=${expected}`);

  if (mismatches.length > 0) {
    throw new Error(
      `Resolved Aave addresses do not match @bgd-labs/aave-address-book:\n${mismatches.join('\n')}`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const addresses = await resolveAaveAddresses();
  assertMatchesAddressBook(addresses);
  console.log('Resolved Aave v3 Ethereum addresses (cross-checked against address book):');
  console.log(addresses);
}
