/* 블롭 인코딩 — 브라우저와 Node 공용 (CompressionStream, atob/btoa) */
import type { BlobEnc, EncodedBlob } from './types';

const CHUNK = 0x8000;

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const res = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export const gzip = (bytes: Uint8Array) => pipe(bytes, new CompressionStream('gzip'));
export const gunzip = (bytes: Uint8Array) => pipe(bytes, new DecompressionStream('gzip'));

export async function encodeBlob(bytes: Uint8Array, enc: BlobEnc): Promise<EncodedBlob> {
  return { enc, data: toBase64(enc === 'gz64' ? await gzip(bytes) : bytes) };
}

export async function decodeBlob(blob: EncodedBlob): Promise<Uint8Array> {
  const raw = fromBase64(blob.data);
  return blob.enc === 'gz64' ? gunzip(raw) : raw;
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 이미 압축된 형식은 gzip 해도 줄지 않으므로 b64로 담는다 */
const PRECOMPRESSED = /^(image\/(png|jpe?g|gif|webp|avif)|font\/woff2?|video\/|audio\/|application\/(zip|gzip|pdf))/;

export function encFor(type: string): BlobEnc {
  return PRECOMPRESSED.test(type) ? 'b64' : 'gz64';
}

const TYPES: Record<string, string> = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
  json: 'application/json', csv: 'text/csv', txt: 'text/plain', md: 'text/markdown', xml: 'application/xml',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  wasm: 'application/wasm', pdf: 'application/pdf', glb: 'model/gltf-binary', gltf: 'model/gltf+json',
};

export function typeFor(path: string): string {
  const ext = path.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? '';
  return TYPES[ext] ?? 'application/octet-stream';
}

export function isText(type: string): boolean {
  return /^text\/|json|xml|svg|javascript/.test(type);
}
