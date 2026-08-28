import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type DecisionKind = 'assess' | 'plan' | 'execute' | 'refuse' | 'simulate_fail';

export interface DecisionRecord {
  ts: number;              // ms since epoch
  userId: string;
  kind: DecisionKind;
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

// Append one record to a JSON-lines file at path.
// Creates the file (and parent dir) if missing.
export function appendDecision(path: string, record: DecisionRecord): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const line = JSON.stringify(record) + '\n';
  appendFileSync(path, line, 'utf-8');
}

// Read all records from a JSON-lines file. Returns [] if file missing.
export function readDecisions(path: string): DecisionRecord[] {
  if (!existsSync(path)) {
    return [];
  }

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
      // Skip malformed lines gracefully
    }
  }

  return records;
}
