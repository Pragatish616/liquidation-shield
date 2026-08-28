import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // keeper-backend (Part 4) has its own test runner (node --test
    // --experimental-strip-types, see package.json's demo/test scripts)
    // and uses .ts-suffixed imports incompatible with vitest's resolution.
    exclude: ['node_modules/**', 'agent/src/keeper-backend/**', 'dashboard/**', 'contracts/**'],
  },
});
