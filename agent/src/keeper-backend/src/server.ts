import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { readDecisions } from './keeper/store.ts';
import { tickOnce, type KeeperOptions } from './keeper/loop.ts';
import { healthFactor } from './health.ts';
import { makeMultiCollateral } from './mock/position.ts';
import { crashWETH, recoverCollateral } from './mock/crash.ts';
import { READ_RPC_URL, MAINNET_RPC } from '../../config.ts';

const PORT = Number(process.env.PORT ?? 8080);
const TICK_INTERVAL_MS = Number(process.env.TICK_INTERVAL_MS ?? 15000);
const LOG_PATH = resolve(process.env.LOG_PATH ?? 'decision-real.log.json');
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '*';
const USER_ID = 'live-keeper';

let mode: 'mock' | 'real' = 'mock';
let ticksRun = 0;
let lastTickAt: number | null = null;
let lastTickOk: boolean | null = null;
let lastError: string | null = null;
const startedAt = Date.now();

// Real mode needs a reachable RPC -- mainnet (READ_RPC_URL resolves to
// MAINNET_RPC when READ_MODE=mainnet, see agent/src/config.ts) or a local
// Anvil fork, either works -- plus a watched address. Neither is assumed
// present, so this probes rather than asserting: a deploy with no reachable
// RPC falls back to mock mode instead of crashing on boot. No fork sidecar
// or FORK_BLOCK is required for this path -- readPosition/assess are pure
// reads and pin their own block per call.
async function startRealMode(): Promise<(() => Promise<void>) | null> {
  const watchAddress = process.env.WATCH_ADDRESS;
  const rpcUrl = READ_RPC_URL || MAINNET_RPC;
  if (!watchAddress || !rpcUrl) {
    return null;
  }

  try {
    const probe = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      signal: AbortSignal.timeout(5000),
    });
    if (!probe.ok) return null;
  } catch {
    return null;
  }

  const { realTickOnce } = await import('./real/realTick.ts');
  return async () => {
    await realTickOnce({ user: watchAddress as `0x${string}`, logPath: LOG_PATH });
  };
}

// Mock mode runs the exact same tickOnce() pipeline the demo scenarios use,
// just fed a synthetic position that drifts toward the trigger band and
// resets after each execute -- so the deployed backend stays genuinely live
// (fresh JSON-lines records on a timer) without requiring mainnet access.
function startMockMode(): () => Promise<void> {
  let position = makeMultiCollateral();
  let cooldown = 0;

  const opts: Omit<KeeperOptions, 'getPosition'> = {
    userId: USER_ID,
    targetHF: 1.35,
    pLiq: 0.05,
    gasUsd: 5,
    debtSymbol: 'USDC',
    intervalMs: TICK_INTERVAL_MS,
    logPath: LOG_PATH,
  };

  return async () => {
    const hf = healthFactor(position);

    if (cooldown > 0) {
      cooldown -= 1;
      if (cooldown === 0) {
        position = makeMultiCollateral();
      }
    } else if (hf > 1.05) {
      crashWETH(position, 0.015, 1);
    } else {
      recoverCollateral(position, 'WETH', 0.03, 1);
    }

    await tickOnce({ ...opts, getPosition: () => position });

    const records = readDecisions(LOG_PATH);
    const mine = records.filter((r) => r.userId === USER_ID);
    const last = mine[mine.length - 1];
    if (last?.kind === 'execute' && cooldown === 0) {
      cooldown = 4;
    }
  };
}

async function main() {
  const real = await startRealMode();
  const tick = real ?? startMockMode();
  mode = real ? 'real' : 'mock';

  const run = () => {
    tick()
      .then(() => {
        ticksRun += 1;
        lastTickAt = Date.now();
        lastTickOk = true;
        lastError = null;
      })
      .catch((err) => {
        console.error('[keeper] tick failed:', err);
        lastTickAt = Date.now();
        lastTickOk = false;
        lastError = err instanceof Error ? err.message : String(err);
      });
  };
  run();
  setInterval(run, TICK_INTERVAL_MS);

  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          mode,
          ticksRun,
          uptimeMs: Date.now() - startedAt,
          lastTickAt,
          lastTickOk,
          lastError,
        }),
      );
      return;
    }

    if (url.pathname === '/api/decisions') {
      const records = readDecisions(LOG_PATH);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ scenario: mode, records, live: records.length > 0 }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  server.listen(PORT, () => {
    console.log(`[keeper] listening on :${PORT} (mode=${mode}, interval=${TICK_INTERVAL_MS}ms)`);
  });
}

main().catch((err) => {
  console.error('[keeper] fatal startup error:', err);
  process.exit(1);
});
