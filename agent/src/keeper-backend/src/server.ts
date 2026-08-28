import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { readDecisions, type DecisionRecord } from './keeper/store.ts';
import { tickOnce, type KeeperOptions } from './keeper/loop.ts';
import { healthFactor } from './health.ts';
import { makeMultiCollateral } from './mock/position.ts';
import { crashWETH, recoverCollateral } from './mock/crash.ts';
import { READ_RPC_URL, MAINNET_RPC } from '../../config.ts';

const PORT = Number(process.env.PORT ?? 8080);
const TICK_INTERVAL_MS = Number(process.env.TICK_INTERVAL_MS ?? 15000);
const LOG_PATH = resolve(process.env.LOG_PATH ?? 'decision-real.log.json');
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '*';
// Guards /api/status only -- unset means the endpoint fails closed (every
// request 401s, never fails open), since there's no configured token to
// ever match against. /api/decisions and /health stay unauthenticated.
const AGENT_API_TOKEN = process.env.AGENT_API_TOKEN;
const USER_ID = 'live-keeper';

let mode: 'mock' | 'real' = 'mock';
let ticksRun = 0;
let lastTickAt: number | null = null;
let lastTickOk: boolean | null = null;
let lastError: string | null = null;
const startedAt = Date.now();

// Flat, single-object summary for a voice agent to read aloud -- not the
// full record array /api/decisions returns. Merges the latest 'assess'
// record (hf/triggerHF/pLiq/pLiq24h/urgency, which only assess records
// carry) with the latest record overall for this user (verdict/mode/
// chosenSymbol/releaseUsd/repayUsd/reasons, which only land on the
// terminal plan/refuse/execute/simulate_fail record of a tick). In the
// common case these are the same tick, since ticks run one at a time
// (isRealTickInFlight / the mock path's own lock) and each fully
// completes its assess -> ... -> terminal sequence before the next starts.
function deriveStatus(records: DecisionRecord[]) {
  const empty = {
    hf: null,
    targetHF: null,
    triggerHF: null,
    pLiq: null,
    pLiq24h: null,
    urgency: null,
    chosenSymbol: null,
    releaseUsd: null,
    repayUsd: null,
    capitalBurned: null,
    verdict: null,
    reason: null,
    reasons: [] as string[],
    mode: null,
    lastTickAt,
  };
  if (records.length === 0) return empty;

  const currentUserId = records[records.length - 1]!.userId;
  const mine = records.filter((r) => r.userId === currentUserId);
  const last = mine[mine.length - 1]!;
  let lastAssess: DecisionRecord | undefined;
  for (let i = mine.length - 1; i >= 0; i--) {
    if (mine[i]!.kind === 'assess') {
      lastAssess = mine[i];
      break;
    }
  }

  return {
    hf: last.hf ?? lastAssess?.hf ?? null,
    targetHF: last.targetHF ?? lastAssess?.targetHF ?? null,
    triggerHF: lastAssess?.triggerHF ?? null,
    pLiq: lastAssess?.pLiq ?? null,
    pLiq24h: lastAssess?.pLiq24h ?? null,
    urgency: lastAssess?.urgency ?? null,
    chosenSymbol: last.chosenSymbol ?? null,
    releaseUsd: last.releaseUsd ?? null,
    repayUsd: last.repayUsd ?? null,
    capitalBurned: last.capitalBurned ?? null,
    verdict: last.verdict ?? null,
    reason: last.reason ?? null,
    reasons: last.reasons ?? lastAssess?.reasons ?? [],
    mode: last.mode ?? null,
    lastTickAt,
  };
}

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
      // The log only ever grows -- serializing the whole thing on every
      // request gets slower and heavier as the deployment stays up. The
      // dashboard only ever renders the recent tail anyway.
      res.end(JSON.stringify({ scenario: mode, records: records.slice(-200), live: records.length > 0 }));
      return;
    }

    if (url.pathname === '/api/status') {
      const authHeader = req.headers.authorization;
      if (!AGENT_API_TOKEN || authHeader !== `Bearer ${AGENT_API_TOKEN}`) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      const records = readDecisions(LOG_PATH);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(deriveStatus(records)));
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
