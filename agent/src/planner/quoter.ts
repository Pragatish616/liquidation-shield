import {
  type Address,
  type Hex,
  type PublicClient,
  encodePacked,
  getAddress,
  parseAbi,
} from 'viem';

/**
 * Uniswap v3 QuoterV2 Address on Ethereum Mainnet
 * Reference: plan_1.md §4.1 & OVERVIEW.md §5
 */
export const UNISWAP_V3_QUOTER_V2_ADDRESS: Address = getAddress(
  '0x61fFE014bA17989E743c5F6cB21bF9697530B21e'
);

/** Common standard token addresses on Ethereum Mainnet */
export const KNOWN_TOKENS = {
  WETH: getAddress('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'),
  USDC: getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
  WBTC: getAddress('0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'),
  wstETH: getAddress('0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0'),
};

/** Common Uniswap v3 fee tiers (in hundredths of a bip: 500 = 0.05%, 3000 = 0.3%, 10000 = 1%) */
export const UNISWAP_FEE_TIERS = [500, 3000, 10000] as const;
export type FeeTier = (typeof UNISWAP_FEE_TIERS)[number];

/** QuoterV2 ABI for eth_call / simulateContract (QuoterV2 reverts internally) */
export const QUOTER_V2_ABI = parseAbi([
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
  'function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)',
  'function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
  'function quoteExactOutput(bytes path, uint256 amountOut) external returns (uint256 amountIn, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)',
] as const);

export interface RouteHop {
  tokenIn: Address;
  tokenOut: Address;
  fee: FeeTier;
}

export interface RouteCandidate {
  hops: RouteHop[];
  /** Forward path: tokenIn -> fee -> tokenOut (for execution swap) */
  forwardPathHex: Hex;
  /** Reverse path: tokenOut -> fee -> tokenIn (for QuoterV2 quoteExactOutput) */
  reversePathHex: Hex;
  feeTierBps: number;
}

export interface QuoteRouteParams {
  tokenIn: Address;
  tokenOut: Address;
  /** Desired amount of tokenOut in base token decimals */
  amountOut?: bigint | undefined;
  /** Amount of tokenIn to swap in base token decimals (for exactInput fallback) */
  amountIn?: bigint | undefined;
  /** Price of tokenIn in USD */
  tokenInPriceUsd: number;
  /** Price of tokenOut in USD */
  tokenOutPriceUsd: number;
  /** Decimals of tokenIn */
  tokenInDecimals: number;
  /** Decimals of tokenOut */
  tokenOutDecimals: number;
  /** Urgency level to scale slippage tolerance */
  urgency?: 'LOW' | 'MEDIUM' | 'HIGH' | undefined;
  /** Max acceptable initialized ticks crossed before flagging thin liquidity (default: 120) */
  maxTicksThreshold?: number | undefined;
}

export interface RouteQuoteResult {
  route: RouteCandidate;
  amountIn: bigint;
  amountOut: bigint;
  amountInUsd: number;
  amountOutUsd: number;
  gasEstimate: bigint;
  ticksCrossed: number;
  /** Effective swap cost fraction (fee + price impact) = 1 - (amountOutUsd / amountInUsd) */
  effectiveCostFraction: number;
  /** Price impact relative to oracle spot prices (in basis points) */
  priceImpactBps: number;
  /** Slippage tolerance in basis points applied to compute minAmountOut */
  slippageToleranceBps: number;
  /** Minimum amount out guaranteed for on-chain contract execution */
  minAmountOut: bigint;
  /** Indicates whether the pool depth is thin based on crossed ticks */
  isThinLiquidity: boolean;
  /** Diagnostics summary */
  diagnostics: string;
}

/**
 * Encodes a Uniswap v3 swap path for forward execution (`tokenIn -> fee -> tokenOut -> ...`).
 */
export function encodeUniswapV3Path(hops: RouteHop[]): Hex {
  if (hops.length === 0) {
    throw new Error('Cannot encode empty path');
  }

  const types: string[] = [];
  const values: (Address | number)[] = [];

  const firstHop = hops[0];
  if (!firstHop) {
    throw new Error('First hop is undefined');
  }
  types.push('address');
  values.push(getAddress(firstHop.tokenIn));

  for (const hop of hops) {
    types.push('uint24');
    values.push(hop.fee);
    types.push('address');
    values.push(getAddress(hop.tokenOut));
  }

  return encodePacked(types, values);
}

/**
 * Encodes a Uniswap v3 swap path in reverse for `quoteExactOutput` (`tokenOut -> fee -> tokenIn -> ...`).
 */
export function encodeUniswapV3ReversePath(hops: RouteHop[]): Hex {
  if (hops.length === 0) {
    throw new Error('Cannot encode empty path');
  }

  const types: string[] = [];
  const values: (Address | number)[] = [];

  const lastHop = hops[hops.length - 1];
  if (!lastHop) {
    throw new Error('Last hop is undefined');
  }
  types.push('address');
  values.push(getAddress(lastHop.tokenOut));

  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = hops[i];
    if (!hop) continue;
    types.push('uint24');
    values.push(hop.fee);
    types.push('address');
    values.push(getAddress(hop.tokenIn));
  }

  return encodePacked(types, values);
}

/**
 * Generates direct (1-hop) and intermediary (2-hop via WETH/USDC) candidate routes.
 */
export function generateRouteCandidates(
  tokenIn: Address,
  tokenOut: Address,
  intermediates: Address[] = [KNOWN_TOKENS.WETH, KNOWN_TOKENS.USDC]
): RouteCandidate[] {
  const normIn = getAddress(tokenIn);
  const normOut = getAddress(tokenOut);
  const candidates: RouteCandidate[] = [];

  // 1. Direct 1-hop routes across all fee tiers
  for (const fee of UNISWAP_FEE_TIERS) {
    const hops: RouteHop[] = [{ tokenIn: normIn, tokenOut: normOut, fee }];
    candidates.push({
      hops,
      forwardPathHex: encodeUniswapV3Path(hops),
      reversePathHex: encodeUniswapV3ReversePath(hops),
      feeTierBps: fee / 100,
    });
  }

  // 2. 2-hop routes via common intermediary tokens (WETH, USDC)
  for (const mid of intermediates) {
    const normMid = getAddress(mid);
    if (normMid === normIn || normMid === normOut) {
      continue; // Skip if intermediate is one of the pair tokens
    }

    for (const fee1 of UNISWAP_FEE_TIERS) {
      for (const fee2 of UNISWAP_FEE_TIERS) {
        // Only include commonly liquid fee pairs (e.g. 500/500, 3000/500, 500/3000, 3000/3000)
        if (fee1 === 10000 && fee2 === 10000) continue;

        const hops: RouteHop[] = [
          { tokenIn: normIn, tokenOut: normMid, fee: fee1 },
          { tokenIn: normMid, tokenOut: normOut, fee: fee2 },
        ];
        candidates.push({
          hops,
          forwardPathHex: encodeUniswapV3Path(hops),
          reversePathHex: encodeUniswapV3ReversePath(hops),
          feeTierBps: (fee1 + fee2) / 100,
        });
      }
    }
  }

  return candidates;
}

/**
 * Calculates urgency-scaled slippage tolerance in basis points.
 * Reference: plan_1.md §4.2:
 * - LOW: 10–30 bps (calm conditions)
 * - MEDIUM: 30–50 bps
 * - HIGH: 50–100 bps (emergency / HF < 1.0)
 */
export function getSlippageToleranceBps(urgency: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW'): number {
  switch (urgency) {
    case 'LOW':
      return 20; // 0.20%
    case 'MEDIUM':
      return 40; // 0.40%
    case 'HIGH':
      return 75; // 0.75%
  }
}

/**
 * Interface for Quoter implementation (allows live Viem quoter and offline simulation).
 */
export interface IQuoter {
  quoteRoute(params: QuoteRouteParams): Promise<RouteQuoteResult>;
}

/**
 * Uniswap v3 Quoter using Viem simulateContract against QuoterV2.
 */
export class UniswapV3Quoter implements IQuoter {
  constructor(
    private readonly client: PublicClient,
    private readonly quoterAddress: Address = UNISWAP_V3_QUOTER_V2_ADDRESS
  ) {}

  async quoteRoute(params: QuoteRouteParams): Promise<RouteQuoteResult> {
    const candidates = generateRouteCandidates(params.tokenIn, params.tokenOut);
    let bestResult: RouteQuoteResult | null = null;

    const maxTicksThreshold = params.maxTicksThreshold ?? 120;
    const slippageToleranceBps = getSlippageToleranceBps(params.urgency ?? 'LOW');

    for (const candidate of candidates) {
      try {
        let amountIn: bigint;
        let amountOut: bigint;
        let gasEstimate: bigint;
        let ticksCrossed = 0;

        if (params.amountOut !== undefined) {
          // Exact output quote
          if (candidate.hops.length === 1) {
            const hop = candidate.hops[0]!;
            const { result } = await this.client.simulateContract({
              address: this.quoterAddress,
              abi: QUOTER_V2_ABI,
              functionName: 'quoteExactOutputSingle',
              args: [
                {
                  tokenIn: hop.tokenIn,
                  tokenOut: hop.tokenOut,
                  amount: params.amountOut,
                  fee: hop.fee,
                  sqrtPriceLimitX96: 0n,
                },
              ],
            });
            amountIn = result[0];
            amountOut = params.amountOut;
            ticksCrossed = Number(result[2]);
            gasEstimate = result[3];
          } else {
            const { result } = await this.client.simulateContract({
              address: this.quoterAddress,
              abi: QUOTER_V2_ABI,
              functionName: 'quoteExactOutput',
              args: [candidate.reversePathHex, params.amountOut],
            });
            amountIn = result[0];
            amountOut = params.amountOut;
            const ticksList = result[2] as readonly number[];
            ticksCrossed = ticksList.reduce((sum: number, t: number) => sum + Number(t), 0);
            gasEstimate = result[3];
          }
        } else if (params.amountIn !== undefined) {
          // Exact input quote fallback
          if (candidate.hops.length === 1) {
            const hop = candidate.hops[0]!;
            const { result } = await this.client.simulateContract({
              address: this.quoterAddress,
              abi: QUOTER_V2_ABI,
              functionName: 'quoteExactInputSingle',
              args: [
                {
                  tokenIn: hop.tokenIn,
                  tokenOut: hop.tokenOut,
                  amountIn: params.amountIn,
                  fee: hop.fee,
                  sqrtPriceLimitX96: 0n,
                },
              ],
            });
            amountIn = params.amountIn;
            amountOut = result[0];
            ticksCrossed = Number(result[2]);
            gasEstimate = result[3];
          } else {
            const { result } = await this.client.simulateContract({
              address: this.quoterAddress,
              abi: QUOTER_V2_ABI,
              functionName: 'quoteExactInput',
              args: [candidate.forwardPathHex, params.amountIn],
            });
            amountIn = params.amountIn;
            amountOut = result[0];
            const ticksList = result[2] as readonly number[];
            ticksCrossed = ticksList.reduce((sum: number, t: number) => sum + Number(t), 0);
            gasEstimate = result[3];
          }
        } else {
          throw new Error('Either amountOut or amountIn must be provided');
        }

        const amountInUsd =
          (Number(amountIn) / 10 ** params.tokenInDecimals) * params.tokenInPriceUsd;
        const amountOutUsd =
          (Number(amountOut) / 10 ** params.tokenOutDecimals) * params.tokenOutPriceUsd;

        const effectiveCostFraction =
          amountInUsd > 0 ? Math.max(0, 1 - amountOutUsd / amountInUsd) : 0;
        const priceImpactBps = Math.round(effectiveCostFraction * 10000);

        const minAmountOut =
          (amountOut * BigInt(10000 - slippageToleranceBps)) / 10000n;
        const isThinLiquidity = ticksCrossed > maxTicksThreshold;

        const quoteResult: RouteQuoteResult = {
          route: candidate,
          amountIn,
          amountOut,
          amountInUsd,
          amountOutUsd,
          gasEstimate,
          ticksCrossed,
          effectiveCostFraction,
          priceImpactBps,
          slippageToleranceBps,
          minAmountOut,
          isThinLiquidity,
          diagnostics: `Route [${candidate.hops.map((h) => `${h.fee}bps`).join('->')}]: In $${amountInUsd.toFixed(2)}, Out $${amountOutUsd.toFixed(2)}, Cost ${(effectiveCostFraction * 100).toFixed(2)}%, Ticks ${ticksCrossed}`,
        };

        // Pick best route (minimum amountIn required)
        if (!bestResult || quoteResult.amountIn < bestResult.amountIn) {
          bestResult = quoteResult;
        }
      } catch {
        // Pool not initialized or no liquidity on this fee tier, continue searching
        continue;
      }
    }

    if (!bestResult) {
      throw new Error(
        `No viable Uniswap v3 route found between ${params.tokenIn} and ${params.tokenOut}`
      );
    }

    return bestResult;
  }
}

/**
 * Simulated Quoter for offline unit tests, backtests, and fixed-point solver verification.
 * Models constant-product / concentrated liquidity impact curves analytically.
 */
export class SimulatedQuoter implements IQuoter {
  constructor(
    private readonly baseFeeBps: number = 5, // 5 bps default base fee
    private readonly liquidityDepthUsd: number = 5_000_000 // $5M virtual pool depth
  ) {}

  async quoteRoute(params: QuoteRouteParams): Promise<RouteQuoteResult> {
    const slippageToleranceBps = getSlippageToleranceBps(params.urgency ?? 'LOW');
    const candidates = generateRouteCandidates(params.tokenIn, params.tokenOut);
    const candidate = candidates[0]!;

    let amountOutUsd: number;
    let amountInUsd: number;

    if (params.amountOut !== undefined) {
      amountOutUsd =
        (Number(params.amountOut) / 10 ** params.tokenOutDecimals) *
        params.tokenOutPriceUsd;

      // Price impact model: slippage = tradeSize / (2 * depth) + baseFee
      const priceImpactFraction =
        this.baseFeeBps / 10000 + amountOutUsd / (2 * this.liquidityDepthUsd);
      amountInUsd = amountOutUsd / (1 - priceImpactFraction);
    } else if (params.amountIn !== undefined) {
      amountInUsd =
        (Number(params.amountIn) / 10 ** params.tokenInDecimals) *
        params.tokenInPriceUsd;
      const priceImpactFraction =
        this.baseFeeBps / 10000 + amountInUsd / (2 * this.liquidityDepthUsd);
      amountOutUsd = amountInUsd * (1 - priceImpactFraction);
    } else {
      throw new Error('Either amountOut or amountIn must be provided');
    }

    const amountInUnits = BigInt(
      Math.round(
        (amountInUsd / params.tokenInPriceUsd) * 10 ** params.tokenInDecimals
      )
    );
    const amountOutUnits = BigInt(
      Math.round(
        (amountOutUsd / params.tokenOutPriceUsd) * 10 ** params.tokenOutDecimals
      )
    );

    const effectiveCostFraction = Math.max(0, 1 - amountOutUsd / amountInUsd);
    const priceImpactBps = Math.round(effectiveCostFraction * 10000);
    const minAmountOut =
      (amountOutUnits * BigInt(10000 - slippageToleranceBps)) / 10000n;

    return {
      route: candidate,
      amountIn: amountInUnits,
      amountOut: amountOutUnits,
      amountInUsd,
      amountOutUsd,
      gasEstimate: 185000n,
      ticksCrossed: Math.round((amountOutUsd / this.liquidityDepthUsd) * 100),
      effectiveCostFraction,
      priceImpactBps,
      slippageToleranceBps,
      minAmountOut,
      isThinLiquidity: amountOutUsd > this.liquidityDepthUsd * 0.1,
      diagnostics: `Simulated Route: In $${amountInUsd.toFixed(2)}, Out $${amountOutUsd.toFixed(2)}, Cost ${(effectiveCostFraction * 100).toFixed(3)}%`,
    };
  }
}
