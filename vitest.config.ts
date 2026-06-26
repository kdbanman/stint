import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

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
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**', 'packages/cli/src/**'],
      reporter: ['text', 'json-summary'],
    },
  },
});
