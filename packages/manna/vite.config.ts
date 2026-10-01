/* Manna 런타임 — 내보낸 HTML 에 인라인되는 단일 IIFE + CSS */
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [preact()],
  resolve: { alias: { '@core': r('../core/src'), '@manna': r('./src') } },
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: r('../../out/manna'),
    emptyOutDir: true,
    target: 'es2022',
    cssCodeSplit: false,
    reportCompressedSize: true,
    lib: {
      entry: r('./src/main.tsx'),
      formats: ['iife'],
      name: 'Manna',
      fileName: () => 'manna-runtime.js',
      cssFileName: 'manna-runtime',
    },
  },
});
