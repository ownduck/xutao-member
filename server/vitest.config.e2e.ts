import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    isolate: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    sequence: { concurrent: false },
  },
});
