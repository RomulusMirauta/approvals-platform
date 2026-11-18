import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Each test file starts its own in-memory Postgres (PGlite) and runs the migrations.
    hookTimeout: 30_000,
  },
});
