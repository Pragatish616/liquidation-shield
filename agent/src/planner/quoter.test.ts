import { describe, it, expect } from 'vitest';
import {
  KNOWN_TOKENS,
  UNISWAP_FEE_TIERS,
  generateRouteCandidates,
  encodeUniswapV3Path,
  encodeUniswapV3ReversePath,
  getSlippageToleranceBps,
  SimulatedQuoter,
} from './quoter.js';

describe('Quoting Engine (quoter.ts)', () => {
  describe('KNOWN_TOKENS addresses (regression: wstETH was previously a fabricated address)', () => {
    it('matches the real, canonical Ethereum mainnet contract addresses', () => {
      // Cross-checked against @bgd-labs/aave-address-book's AaveV3Ethereum.ASSETS.
      expect(KNOWN_TOKENS.WETH).toBe('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
      expect(KNOWN_TOKENS.USDC).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
      expect(KNOWN_TOKENS.WBTC).toBe('0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599');
      expect(KNOWN_TOKENS.wstETH).toBe('0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0');
    });
  });

  describe('Route Candidate Generation & Path Encoding', () => {
    it('generates direct 1-hop routes across all standard fee tiers (500, 3000, 10000)', () => {
      const candidates = generateRouteCandidates(KNOWN_TOKENS.WETH, KNOWN_TOKENS.USDC);

      // Check 1-hop routes
      const directRoutes = candidates.filter((c) => c.hops.length === 1);
      expect(directRoutes.length).toBe(UNISWAP_FEE_TIERS.length);

      const fees = directRoutes.map((r) => r.hops[0]!.fee);
      expect(fees).toEqual([500, 3000, 10000]);
    });

    it('generates 2-hop intermediary routes via WETH and USDC', () => {
      // For WBTC -> USDC, should generate 2-hop routes via WETH
      const candidates = generateRouteCandidates(KNOWN_TOKENS.WBTC, KNOWN_TOKENS.USDC);
      const twoHopRoutes = candidates.filter((c) => c.hops.length === 2);
      expect(twoHopRoutes.length).toBeGreaterThan(0);

      // All 2-hop routes should pass through WETH (since USDC is tokenOut)
      for (const route of twoHopRoutes) {
        expect(route.hops[0]!.tokenIn.toLowerCase()).toBe(KNOWN_TOKENS.WBTC.toLowerCase());
        expect(route.hops[0]!.tokenOut.toLowerCase()).toBe(KNOWN_TOKENS.WETH.toLowerCase());
        expect(route.hops[1]!.tokenIn.toLowerCase()).toBe(KNOWN_TOKENS.WETH.toLowerCase());
        expect(route.hops[1]!.tokenOut.toLowerCase()).toBe(KNOWN_TOKENS.USDC.toLowerCase());
      }
    });

    it('encodes forward and reverse Uniswap v3 paths with correct byte lengths', () => {
      const hops = [
        { tokenIn: KNOWN_TOKENS.WBTC, tokenOut: KNOWN_TOKENS.WETH, fee: 3000 as const },
        { tokenIn: KNOWN_TOKENS.WETH, tokenOut: KNOWN_TOKENS.USDC, fee: 500 as const },
      ];

      const forward = encodeUniswapV3Path(hops);
      const reverse = encodeUniswapV3ReversePath(hops);

      // 2 hops: 20 + 3 + 20 + 3 + 20 = 66 bytes -> 132 hex chars + 2 for '0x' = 134 chars
      expect(forward.length).toBe(2 + 66 * 2);
      expect(reverse.length).toBe(2 + 66 * 2);

      // Forward starts with WBTC, reverse starts with USDC
      expect(forward.toLowerCase()).toContain(KNOWN_TOKENS.WBTC.toLowerCase().slice(2));
      expect(reverse.toLowerCase()).toContain(KNOWN_TOKENS.USDC.toLowerCase().slice(2));
    });
  });

  describe('Urgency-Scaled Slippage Tolerance (§4.2)', () => {
    it('returns appropriate bps for each urgency level', () => {
      expect(getSlippageToleranceBps('LOW')).toBe(20); // 20 bps
      expect(getSlippageToleranceBps('MEDIUM')).toBe(40); // 40 bps
      expect(getSlippageToleranceBps('HIGH')).toBe(75); // 75 bps
    });
  });

  describe('Simulated Quoter & Depth Checks', () => {
    const quoter = new SimulatedQuoter(5, 10_000_000); // 5 bps base fee, $10M pool depth

    it('quotes exact output correctly and computes effective cost fraction', async () => {
      const quote = await quoter.quoteRoute({
        tokenIn: KNOWN_TOKENS.WETH,
        tokenOut: KNOWN_TOKENS.USDC,
        amountOut: 19000000000n, // $19,000 USDC (6 decimals)
        tokenInPriceUsd: 3000,
        tokenOutPriceUsd: 1,
        tokenInDecimals: 18,
        tokenOutDecimals: 6,
        urgency: 'LOW',
      });

      expect(quote.amountOutUsd).toBe(19000);
      expect(quote.amountInUsd).toBeGreaterThan(19000);
      expect(quote.effectiveCostFraction).toBeGreaterThan(0.0005); // > 5 bps
      expect(quote.slippageToleranceBps).toBe(20);
      expect(quote.minAmountOut).toBe((19000000000n * 9980n) / 10000n);
      expect(quote.isThinLiquidity).toBe(false);
    });

    it('flags thin liquidity when trade size is excessive relative to pool depth', async () => {
      const thinQuoter = new SimulatedQuoter(5, 50_000); // Only $50k depth
      const quote = await thinQuoter.quoteRoute({
        tokenIn: KNOWN_TOKENS.WETH,
        tokenOut: KNOWN_TOKENS.USDC,
        amountOut: 20000000000n, // $20k USDC into $50k pool
        tokenInPriceUsd: 3000,
        tokenOutPriceUsd: 1,
        tokenInDecimals: 18,
        tokenOutDecimals: 6,
      });

      expect(quote.isThinLiquidity).toBe(true);
      expect(quote.effectiveCostFraction).toBeGreaterThan(0.10); // > 10% price impact
    });
  });
});
