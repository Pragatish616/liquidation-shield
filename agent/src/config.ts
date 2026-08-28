import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  ANVIL_PORT: z.coerce.number().default(8545),
  // Optional: only the fork-based scripts (seed/crash/execute, see
  // scripts/fork.sh) need a pinned block. readPosition/assess are pure
  // reads and pin their own block per call via getBlockNumber() -- see
  // READ_RPC_URL below -- so a read-only mainnet deploy doesn't need this.
  FORK_BLOCK: z.coerce.number().optional(),
  // Optional: required by scripts/ and by READ_RPC_URL when
  // READ_MODE=mainnet, but NOT by the keeper backend's module graph in
  // general -- server.ts imports this file even in pure mock mode (no
  // WATCH_ADDRESS), and requiring a mainnet RPC just to boot in mock mode
  // is exactly the kind of unnecessary infra dependency plan.md's mock
  // path is meant to avoid. See READ_RPC_URL's fallback below.
  MAINNET_RPC: z.string().min(1).optional(),
  // Optional: 'mainnet' to make READ_RPC_URL default to MAINNET_RPC instead
  // of the local fork when READ_RPC_URL itself isn't set. See render.yaml.
  READ_MODE: z.string().optional(),
  // Optional: explicit override for READ_RPC_URL's resolution below.
  READ_RPC_URL: z.string().optional(),
  // Optional risk-policy overrides -- unset means "use RiskPolicy's own
  // default", not zero. See agent/src/risk/buffer.ts's DEFAULT_POLICY and
  // plan.md §7 acceptance criterion 4 (doubling reactionWindowSec must
  // visibly widen targetHF without editing source).
  REACTION_WINDOW_SEC: z.coerce.number().optional(),
  RISK_Z: z.coerce.number().optional(),
});

const env = envSchema.parse(process.env);

/**
 * The fork-based scripts (seed/crash/execute, and anything that needs to
 * mutate state or replay a pinned scenario) always talk to the local Anvil
 * fork via this -- never MAINNET_RPC directly. Unchanged by READ_RPC_URL
 * below; keep using this one in scripts/.
 */
export const LOCAL_RPC_URL = `http://127.0.0.1:${env.ANVIL_PORT}`;
export const FORK_BLOCK = env.FORK_BLOCK !== undefined ? BigInt(env.FORK_BLOCK) : undefined;
export const MAINNET_RPC = env.MAINNET_RPC;
/**
 * What the READ-ONLY path (reader/, assess()) talks to. Resolves, in order:
 * an explicit READ_RPC_URL, else MAINNET_RPC when READ_MODE=mainnet, else
 * the local fork -- so a deployed read-only mainnet keeper (no fork
 * available, e.g. on Render) works without touching scripts/'s fork-based
 * flows, which still default to LOCAL_RPC_URL untouched.
 */
export const READ_RPC_URL: string =
  env.READ_RPC_URL ?? (env.READ_MODE === 'mainnet' && env.MAINNET_RPC ? env.MAINNET_RPC : LOCAL_RPC_URL);
export const REACTION_WINDOW_SEC = env.REACTION_WINDOW_SEC;
export const RISK_Z = env.RISK_Z;
