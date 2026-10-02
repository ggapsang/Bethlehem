/* Manna HTML 파일 읽기·쓰기 — docs/ARCHITECTURE.md §3.1
 * 정규식만 쓰므로 DOMParser 가 없는 Node 에서도 돈다.
 */
import type { BlobStore, EncodedBlob, MannaDoc } from './types';
import { aiGuide } from './ai-guide';
import { FORMAT } from './types';

export interface Runtime {
  js: string;
  css: string;
}

export interface ParsedManna {
  doc: MannaDoc;
  blobs: BlobStore;
}

/* 이 파일의 소스 자체가 런타임에 번들되어 <script> 안에 들어가므로, 닫는 태그 문자열을 그대로 쓰지 않는다 */
const END_SCRIPT = '</' + 'script>';
const END_STYLE = '</' + 'style>';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const LINE_SEPS = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');

/** JSON 을 <script> 안에 넣어도 안전하게 */
export function scriptSafeJson(value: unknown): string {
  const bs = '\\'; // 역슬래시 하나
  return JSON.stringify(value).replace(/</g, bs + 'u003c').replace(LINE_SEPS, (c) => bs + 'u' + c.charCodeAt(0).toString(16));
}

/** 런타임 JS 안의 '</script' 를 '<\/script' 로 — 문자열·정규식·주석 안에서만 나타나므로 의미가 바뀌지 않는다 */
export function scriptSafeJs(js: string): string {
  return js.replace(/<\/(script)/gi, '<\\/$1');
}

/** 문서가 실제로 참조하는 블롭만 */
export function referencedShas(doc: MannaDoc): Set<string> {
  const used = new Set<string>();
  for (const s of doc.screens) {
    for (const a of s.annotations) {
      for (const c of a.clips ?? []) used.add(c.sha);
      if (a.shot) used.add(a.shot.sha);
    }
    for (const v of s.versions) {
      for (const f of Object.values(v.files)) used.add(f.sha);
      for (const e of v.external) if (e.sha && !e.excluded) used.add(e.sha);
    }
  }
  return used;
}

export function serializeManna(doc: MannaDoc, blobs: BlobStore, runtime: Runtime): string {
  const parts: string[] = [
    '<!doctype html>',
    // 맨 앞 — AI · 도구가 읽는 법 (화면에는 보이지 않는다)
    aiGuide(doc),
    '<html lang="ko">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="generator" content="Terrarium Manna">',
    `<title>${esc(doc.meta.title)}</title>`,
    `<script type="application/json" id="manna-doc">${scriptSafeJson(doc)}${END_SCRIPT}`,
  ];
  for (const sha of referencedShas(doc)) {
    const b = blobs.get(sha);
    if (!b) throw new Error(`블롭이 없습니다: ${sha}`);
    parts.push(`<script type="application/octet-stream" id="manna-blob-${sha}" data-enc="${b.enc}">${b.data}${END_SCRIPT}`);
  }
  parts.push(
    `<style id="manna-style">${runtime.css.replace(/<\/(style)/gi, '<\\/$1')}${END_STYLE}`,
    '</head>',
    '<body>',
    '<noscript>이 문서는 JavaScript 가 켜진 브라우저에서 열어야 합니다.</noscript>',
    `<script id="manna-runtime">${scriptSafeJs(runtime.js)}${END_SCRIPT}`,
    '</body>',
    '</html>',
    '',
  );
  return parts.join('\n');
}

const DOC_RE = /<script type="application\/json" id="manna-doc">([\s\S]*?)<\/script>/;
const BLOB_RE = /<script type="application\/octet-stream" id="manna-blob-([0-9a-f]{64})" data-enc="(gz64|b64)">([A-Za-z0-9+/=]*)<\/script>/g;

export function isManna(html: string): boolean {
  return DOC_RE.test(html);
}

export function parseManna(html: string): ParsedManna {
  const m = DOC_RE.exec(html);
  if (!m) throw new Error('Manna 문서가 아닙니다 (manna-doc 데이터를 찾지 못했습니다).');
  const doc = JSON.parse(m[1]) as MannaDoc;
  if (doc.format !== FORMAT) throw new Error(`지원하지 않는 문서 형식입니다: ${doc.format}`);
  const blobs: BlobStore = new Map();
  for (const b of html.matchAll(BLOB_RE)) blobs.set(b[1], { enc: b[2] as EncodedBlob['enc'], data: b[3] });
  return { doc, blobs };
}
