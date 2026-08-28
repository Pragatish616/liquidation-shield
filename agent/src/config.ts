import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  ANVIL_PORT: z.coerce.number().default(8545),
  FORK_BLOCK: z.coerce.number(),
  MAINNET_RPC: z.string().min(1),
});

const env = envSchema.parse(process.env);

/** The reader/scripts always talk to the local fork, never MAINNET_RPC directly. */
export const LOCAL_RPC_URL = `http://127.0.0.1:${env.ANVIL_PORT}`;
export const FORK_BLOCK = BigInt(env.FORK_BLOCK);
export const MAINNET_RPC = env.MAINNET_RPC;
