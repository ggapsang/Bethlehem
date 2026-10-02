import preact from '@preact/preset-vite';
import { defineConfig } from 'electron-vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/* 배열 순서대로 첫 번째로 맞는 것을 쓴다 — '@core/node' 를 '@core' 보다 먼저 둔다 */
const alias = [
  { find: '@core/node', replacement: r('packages/core/node') },
  { find: '@core', replacement: r('packages/core/src') },
  { find: '@manna', replacement: r('packages/manna/src') },
];

export default defineConfig({
  main: {
    resolve: { alias },
    build: { lib: { entry: r('apps/bethlehem/main/index.ts') } },
  },
  preload: {
    build: {
      // 메인 창(index)과 URL 담기 창의 막대(snapshot). sandbox 라 cjs 여야 한다
      rollupOptions: {
        input: { index: r('apps/bethlehem/preload/index.ts'), snapshot: r('apps/bethlehem/preload/snapshot.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: r('apps/bethlehem/renderer'),
    resolve: { alias },
    plugins: [preact()],
    build: {
      rollupOptions: {
        input: { index: r('apps/bethlehem/renderer/index.html'), snapshot: r('apps/bethlehem/renderer/snapshot.html') },
      },
    },
  },
});
