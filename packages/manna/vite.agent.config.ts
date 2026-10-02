/* 에이전트 — 품은 화면 안에 문자열로 들어가는 단독 IIFE (srcdoc 에는 인라인, URL 화면에는 webview preload 가 넣는다) */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: { alias: { '@core': r('../core/src') } },
  build: {
    outDir: r('../../out/agent'),
    emptyOutDir: true,
    target: 'es2020',
    reportCompressedSize: false,
    lib: { entry: r('./src/agent/agent.ts'), formats: ['iife'], name: 'TerrariumAgent', fileName: () => 'agent.js' },
  },
});
