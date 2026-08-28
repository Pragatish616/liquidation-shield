import { createHash } from 'node:crypto';

export interface TxReceipt {
  txHash: string;       // 0x + 64 hex chars, fake
  blockNumber: number;  // mock, monotonically increasing
  gasUsed: number;      // mock, e.g. 180000
  status: 'success';    // mock always succeeds
  timestamp: number;    // ms since epoch
}

let currentBlockNumber = 18500000;
const userNonces = new Map<string, number>();

// Returns the next nonce for a given userId (in-process counter, persisted in memory).
export function nextNonce(userId: string): number {
  const current = userNonces.get(userId) ?? 0;
  userNonces.set(userId, current + 1);
  return current;
}

// Mock executor. Does NOT sign, does NOT broadcast, does NOT touch RPC.
// Generates a deterministic-looking tx hash from (userId, nonce, timestamp)
export async function executeMock(
  userId: string,
  payload: { symbol: string; V: number; R: number; minOut: number; deadline: number }
): Promise<TxReceipt> {
  const nonce = nextNonce(userId);
  const timestamp = Date.now();
  const blockNumber = currentBlockNumber++;
  const gasUsed = 180000;

  const raw = `${userId}:${nonce}:${timestamp}:${payload.symbol}:${payload.V}:${payload.R}`;
  const hashHex = createHash('sha256').update(raw).digest('hex');
  const txHash = `0x${hashHex}`;

  return {
    txHash,
    blockNumber,
    gasUsed,
    status: 'success',
    timestamp,
  };
}
