import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    // Admin totals and last-admin invariants span the DB: isolate fixture files.
    // Explicit concurrent requests within a test still execute in parallel.
    maxWorkers: 1,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup.ts'],
  },
});
