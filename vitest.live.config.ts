import { defineConfig } from 'vitest/config';

/**
 * The live smoke test hits the real 1f916.ai. It is separated from the normal
 * suite so `npm test` stays offline, deterministic and fast — and so a CI run
 * never depends on someone else's Worker being up.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.live.test.ts'],
    testTimeout: 30_000,
  },
});
