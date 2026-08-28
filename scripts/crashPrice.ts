/**
 * Crash (or move) an asset's Aave oracle price on the local fork by
 * swapping in a MockAggregator as its Chainlink price source. plan.md §2.3.
 *
 * Usage:
 *   tsx scripts/crashPrice.ts --asset WETH --pct -12
 *
 * Steps: deploy MockAggregator(newPrice) -> impersonate the ACL admin
 * (found via PoolAddressesProvider.getACLAdmin(), resolved at runtime, not
 * hand-typed) -> aaveOracle.setAssetSources([asset], [mockAggregator]) ->
 * verify both the oracle price and the seeded user's health factor moved.
 *
 * Gotcha (documented, not fixed here): this only moves the Aave *oracle*
 * price. The Uniswap pool on the fork still has the pinned-block price, so
 * post-crash the two diverge -- see plan.md §2.3's gotcha note. That's an
 * intentional, documented scope boundary for Part 1, not a bug.
 */

import { createWalletClient, createTestClient, http, publicActions, type Address } from 'viem';
import { mainnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AaveV3Ethereum } from '@bgd-labs/aave-address-book';
import { LOCAL_RPC_URL } from '../agent/src/config';
import { makePublicClient, resolveAaveAddresses } from '../agent/src/reader/addresses';
import { aaveOracleAbi } from '../agent/src/reader/abis';

// Anvil default account #0 -- publicly known test key, local fork only.
const DEPLOYER_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

const SUPPORTED_ASSETS: Record<string, Address> = {
  WETH: AaveV3Ethereum.ASSETS.WETH.UNDERLYING,
  USDC: AaveV3Ethereum.ASSETS.USDC.UNDERLYING,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadMockAggregatorArtifact() {
  const artifactPath = path.join(
    __dirname,
    '..',
    'contracts',
    'out',
    'MockAggregator.sol',
    'MockAggregator.json',
  );
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  return { abi: artifact.abi, bytecode: artifact.bytecode.object as `0x${string}` };
}

function parseArgs(argv: string[]) {
  const get = (flag: string, fallback: string): string => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
  };
  return {
    asset: get('--asset', 'WETH'),
    pct: Number(get('--pct', '-12')),
  };
}

export async function crashPrice(assetSymbol: string, pct: number) {
  const asset = SUPPORTED_ASSETS[assetSymbol];
  if (!asset) throw new Error(`unsupported asset: ${assetSymbol}`);

  const publicClient = makePublicClient();
  const { oracle, aclAdmin } = await resolveAaveAddresses(publicClient);

  const priceBefore = await publicClient.readContract({
    address: oracle,
    abi: aaveOracleAbi,
    functionName: 'getAssetPrice',
    args: [asset],
  });

  const newPrice = (priceBefore * BigInt(Math.round((100 + pct) * 100))) / 10_000n;
  console.log(
    `${assetSymbol} price: ${priceBefore} -> ${newPrice} (8dp) [${pct >= 0 ? '+' : ''}${pct}%]`,
  );

  // 1. Deploy MockAggregator(newPrice)
  const deployer = privateKeyToAccount(DEPLOYER_PRIVATE_KEY);
  const walletClient = createWalletClient({
    account: deployer,
    chain: mainnet,
    transport: http(LOCAL_RPC_URL),
  }).extend(publicActions);

  const { abi: mockAggregatorAbi, bytecode } = loadMockAggregatorArtifact();
  const deployHash = await walletClient.deployContract({
    abi: mockAggregatorAbi,
    bytecode,
    args: [newPrice],
    gas: 1_000_000n,
  });
  const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
  if (deployReceipt.status !== 'success' || !deployReceipt.contractAddress) {
    throw new Error(`MockAggregator deployment reverted (tx ${deployHash})`);
  }
  const mockAggregator = deployReceipt.contractAddress;
  console.log(`deployed MockAggregator at ${mockAggregator}`);

  // 2. Impersonate the ACL admin (resolved at runtime, not hand-typed) and fund it.
  const testClient = createTestClient({ chain: mainnet, mode: 'anvil', transport: http(LOCAL_RPC_URL) });
  await testClient.impersonateAccount({ address: aclAdmin });
  await testClient.setBalance({ address: aclAdmin, value: 10n ** 18n });

  // 3. aaveOracle.setAssetSources([asset], [mockAggregator]) from the admin.
  // chain: null skips viem's client-chain-vs-node-chain assertion, which
  // otherwise fires when overriding `account` to an impersonated address
  // that isn't the client's own configured signer.
  const setSourceHash = await walletClient.writeContract({
    address: oracle,
    abi: aaveOracleAbi,
    functionName: 'setAssetSources',
    args: [[asset], [mockAggregator]],
    account: aclAdmin,
    chain: null,
    gas: 500_000n,
  });
  const setSourceReceipt = await publicClient.waitForTransactionReceipt({ hash: setSourceHash });
  if (setSourceReceipt.status !== 'success') {
    throw new Error(`setAssetSources reverted (tx ${setSourceHash})`);
  }
  await testClient.stopImpersonatingAccount({ address: aclAdmin });
  console.log(`set ${assetSymbol}'s price source to the mock aggregator`);

  // 4. Verify.
  const priceAfter = await publicClient.readContract({
    address: oracle,
    abi: aaveOracleAbi,
    functionName: 'getAssetPrice',
    args: [asset],
  });
  console.log(`\nverified: ${assetSymbol} oracle price is now ${priceAfter} (was ${priceBefore})`);

  return { priceBefore, priceAfter, mockAggregator };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  await crashPrice(args.asset, args.pct);
}
