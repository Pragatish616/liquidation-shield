/**
 * Load cached CoinGecko price history (data/prices/*.json, Step 7) and
 * align two series to their common timestamps.
 *
 * CoinGecko's `market_chart` response is `prices: [[msTimestamp, price], ...]`.
 * Two series fetched in separate requests are hourly-bucketed and agree on
 * every timestamp except sometimes the trailing "live" point (fetched a
 * few seconds apart) -- intersecting by timestamp rather than assuming
 * positional alignment handles that without dropping real data.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PricePoint } from './ewma';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRICES_DIR = path.join(__dirname, '..', '..', '..', 'data', 'prices');

/** Aave reserve symbol -> cached price file basename (Step 7's fetch set). */
export const PRICE_FILE_BY_SYMBOL: Record<string, string> = {
  WETH: 'weth',
  WBTC: 'wbtc',
  cbBTC: 'cbbtc',
  wstETH: 'wsteth',
  USDC: 'usdc',
};

export function hasPriceHistory(symbol: string): boolean {
  return symbol in PRICE_FILE_BY_SYMBOL;
}

function loadRawSeries(symbol: string): PricePoint[] {
  const file = PRICE_FILE_BY_SYMBOL[symbol];
  if (!file) {
    throw new Error(
      `no cached price history for ${symbol} -- run scripts to fetch it into data/prices/ first (Step 7)`,
    );
  }
  const raw = JSON.parse(readFileSync(path.join(PRICES_DIR, `${file}.json`), 'utf8')) as {
    prices: [number, number][];
  };
  return raw.prices.map(([msTimestamp, price]) => ({ t: Math.round(msTimestamp / 1000), price }));
}

/** Load two symbols' cached history, intersected to their common timestamps. */
export function loadAlignedSeries(
  symbolA: string,
  symbolB: string,
): { a: PricePoint[]; b: PricePoint[] } {
  const seriesA = loadRawSeries(symbolA);
  const seriesB = loadRawSeries(symbolB);

  const bByTimestamp = new Map(seriesB.map((p) => [p.t, p]));
  const a: PricePoint[] = [];
  const b: PricePoint[] = [];
  for (const pointA of seriesA) {
    const pointB = bByTimestamp.get(pointA.t);
    if (pointB) {
      a.push(pointA);
      b.push(pointB);
    }
  }
  return { a, b };
}
