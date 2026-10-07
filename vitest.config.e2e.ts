import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    // Each Nest fixture owns a PostgreSQL pool; keep CI within the DB connection budget.
    maxWorkers: 4,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup.ts'],
  },
});
