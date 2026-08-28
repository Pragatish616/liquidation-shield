import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface DecisionRecord {
  ts: number;
  userId: string;
  kind: 'assess' | 'plan' | 'execute' | 'refuse' | 'simulate_fail';
  hf?: number;
  targetHF?: number;
  pLiq?: number;
  chosenSymbol?: string;
  capitalBurned?: number;
  expectedLossNoAction?: number;
  expectedLossAction?: number;
  txHash?: string;
  reason?: string;
}

export interface DecisionsPayload {
  scenario: string;
  records: DecisionRecord[];
  live: boolean;
}

// If BACKEND_URL is set (a deployed `pnpm server` instance -- see
// agent/src/keeper-backend/src/server.ts), proxy to it server-side so the
// browser never needs CORS and the fetch stays same-origin from the client's
// point of view. Falls back to reading the local JSON-lines log produced by
// `pnpm demo:*`, which is how this route behaves for local/dev use.
export async function fetchLiveDecisions(scenario: 'real' | 'save' | 'refuse'): Promise<DecisionsPayload> {
  const backendUrl = process.env.BACKEND_URL;
  if (backendUrl) {
    try {
      const res = await fetch(`${backendUrl.replace(/\/$/, '')}/api/decisions`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) {
        const data = (await res.json()) as DecisionsPayload;
        return { scenario: data.scenario ?? scenario, records: data.records ?? [], live: data.live ?? false };
      }
    } catch {
      // backend unreachable -- fall through to local file mode
    }
  }

  const path = getLogPath(scenario);
  const records = readDecisions(path);
  return { scenario, records, live: records.length > 0 };
}

export function getLogPath(scenario: 'real' | 'save' | 'refuse' = 'real'): string {
  if (process.env.DECISION_LOG_PATH && existsSync(process.env.DECISION_LOG_PATH)) {
    return process.env.DECISION_LOG_PATH;
  }

  const filename =
    scenario === 'refuse'
      ? 'decision-refuse.log.json'
      : scenario === 'save'
        ? 'decision-save.log.json'
        : 'decision-real.log.json';

  // pnpm demo:real / demo:save / demo:refuse all write to the repo root
  // (resolve('decision-*.log.json') from wherever pnpm is invoked); the
  // dashboard runs from dashboard/, one level down.
  return resolve(process.cwd(), '..', filename);
}

export function readDecisions(path: string): DecisionRecord[] {
  if (!existsSync(path)) {
    return [];
  }

  try {
    const content = readFileSync(path, 'utf-8');
    const lines = content.split('\n');
    const records: DecisionRecord[] = [];

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      try {
        const rec = JSON.parse(trimmed) as DecisionRecord;
        records.push(rec);
      } catch {
        // Ignore bad lines
      }
    }

    return records;
  } catch {
    return [];
  }
}
