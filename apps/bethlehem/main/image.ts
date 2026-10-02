/* 그림 화면 — jpg·png 같은 정지 그림을 화면으로 담는다. 요소가 없으니 Comment 는 영역 박스만 된다.
 * 그림을 품은 작은 index.html 을 만들어 보통 화면과 똑같이 다룬다 (기준 뷰포트 = 그림 크기).
 */
import { nativeImage } from 'electron';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { gzipSync } from 'node:zlib';
import { encFor, typeFor } from '@core';
import type { EncodedBlob, ScreenVersion } from '@core';

export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];

function blobOf(bytes: Uint8Array, type: string): { sha: string; blob: EncodedBlob } {
  const sha = createHash('sha256').update(bytes).digest('hex');
  const enc = encFor(type);
  return { sha, blob: { enc, data: Buffer.from(enc === 'gz64' ? gzipSync(bytes, { level: 9 }) : bytes).toString('base64') } };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export async function packImage(path: string): Promise<{ title: string; version: Omit<ScreenVersion, 'v' | 'createdAt'>; blobs: [string, EncodedBlob][] }> {
  const bytes = new Uint8Array(await readFile(path));
  const name = basename(path);
  const img = nativeImage.createFromBuffer(Buffer.from(bytes));
  const { width, height } = img.getSize();
  if (!width || !height) throw new Error(`그림을 읽지 못했습니다: ${name}`);
  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>${esc(name)}</title>
<style>html,body{margin:0;background:#fff;overflow:hidden}#terr-image{display:block;width:100vw;height:100vh;object-fit:contain;user-select:none}</style>
</head><body><img id="terr-image" src="${encodeURIComponent(name)}" alt="${esc(name)}" draggable="false"></body></html>
`;
  const type = typeFor(name);
  const b1 = blobOf(new TextEncoder().encode(html), 'text/html');
  const b2 = blobOf(bytes, type);
  return {
    title: name.replace(/\.[^.]+$/, ''),
    version: {
      entry: 'index.html',
      source: { url: name, mode: 'image', at: new Date().toISOString() },
      viewport: { w: width, h: height, fit: 'contain' },
      files: {
        'index.html': { sha: b1.sha, size: html.length, type: 'text/html' },
        [name]: { sha: b2.sha, size: bytes.length, type },
      },
      external: [],
    },
    blobs: [[b1.sha, b1.blob], [b2.sha, b2.blob]],
  };
}
