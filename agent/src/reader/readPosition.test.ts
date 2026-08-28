import { describe, it, expect } from 'vitest';
import { readPosition } from './readPosition';
import { PositionRefusedError } from './emode';
import type { Address } from 'viem';

/**
 * instructions.md Step 6's non-negotiable checkpoint: local HF must match
 * Aave's own getUserAccountData to within 1e-6, on real mainnet positions
 * with different collateral mixes -- not just our own seeded position.
 *
 * Found via Etherscan's aEthWETH/variable-debt-USDC top-holder lists using
 * the real, address-book-sourced token addresses (not guessed contracts),
 * then verified live against the pinned fork (block 25,850,000) before
 * being trusted here -- see the build log for the getUserAccountData
 * cast-call output each was checked against.
 */
const SEEDED_USER: Address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'; // Step 4's WETH/USDC position
const WHALE_1: Address = '0x7CD0B7Ed790F626ef1BD42Db63B5EBEb5970c912'; // multi-asset, LT=78% blended
const WHALE_2: Address = '0xABdbBd00Fad79b257e7313B398A1Ea10d9EEf8D6'; // multi-asset, LT=78% blended
const EMODE_WHALE: Address = '0xc468315a2df54f9c076bD5Cfe5002BA211F74CA6'; // e-mode category 34, LT=93%

describe('readPosition matches Aave (instructions.md Step 6 checkpoint)', () => {
  for (const [label, user] of [
    ['seeded WETH/USDC position', SEEDED_USER],
    ['real mainnet whale #1 (multi-asset)', WHALE_1],
    ['real mainnet whale #2 (multi-asset)', WHALE_2],
  ] as const) {
    it(`HF matches on-chain for ${label} (${user})`, async () => {
      const snap = await readPosition(user);
      expect(snap.onChainHealthFactor).toBeGreaterThan(0);
      expect(Math.abs(snap.healthFactor - snap.onChainHealthFactor)).toBeLessThan(1e-6);
    }, 120_000);
  }

  it('refuses an e-mode position rather than silently mis-pricing it', async () => {
    await expect(readPosition(EMODE_WHALE)).rejects.toThrow(PositionRefusedError);
  }, 120_000);
});
