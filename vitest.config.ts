import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: { alias: { '@core': r('packages/core/src'), '@manna': r('packages/manna/src') } },
  test: { include: ['packages/**/*.test.ts'] },
});
