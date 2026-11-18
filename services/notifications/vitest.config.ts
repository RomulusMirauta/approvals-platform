import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Each test file starts its own in-memory Postgres (PGlite) and runs the API's migrations.
    hookTimeout: 30_000,
    // Quiets the worker's default logger; the tests that check log lines pass their own.
    env: { LOG_LEVEL: 'silent' },
  },
});
