import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  ANVIL_PORT: z.coerce.number().default(8545),
  FORK_BLOCK: z.coerce.number(),
  MAINNET_RPC: z.string().min(1),
  // Optional risk-policy overrides -- unset means "use RiskPolicy's own
  // default", not zero. See agent/src/risk/buffer.ts's DEFAULT_POLICY and
  // plan.md §7 acceptance criterion 4 (doubling reactionWindowSec must
  // visibly widen targetHF without editing source).
  REACTION_WINDOW_SEC: z.coerce.number().optional(),
  RISK_Z: z.coerce.number().optional(),
});

const env = envSchema.parse(process.env);

/** The reader/scripts always talk to the local fork, never MAINNET_RPC directly. */
export const LOCAL_RPC_URL = `http://127.0.0.1:${env.ANVIL_PORT}`;
export const FORK_BLOCK = BigInt(env.FORK_BLOCK);
export const MAINNET_RPC = env.MAINNET_RPC;
export const REACTION_WINDOW_SEC = env.REACTION_WINDOW_SEC;
export const RISK_Z = env.RISK_Z;
