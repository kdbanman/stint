import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Tests run against the TypeScript source of @stint/core (via this alias) so the
 * suite needs no build step. The shipped package still resolves to ./dist.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@stint/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    globals: false,
    include: ['packages/**/test/**/*.test.ts'],
    environment: 'node',
    env: {
      // §13 test isolation (the TT_DB pattern): pin the config file's own location to a
      // path that never exists, so a developer machine's real ~/.config/stint/config.json
      // can never steer a test's storage ladders (an absent file is an empty config —
      // every path takes the next rung). Spawned `tt` subprocesses inherit it through
      // `{ ...process.env }`. Storage-path tests that NEED a config file override it.
      TT_CONFIG: join(tmpdir(), `stint-vitest-no-config-${process.pid}.json`),
    },
  },
});
