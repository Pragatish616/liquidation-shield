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
