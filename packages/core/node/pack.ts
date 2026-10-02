/* 화면 패키징 — Node 전용 (Bethlehem 메인 프로세스, bake CLI)
 * 폴더를 읽어 내용 해시 블롭으로 만들고, 외부 리소스를 내려받는다. docs/ARCHITECTURE.md §5.3
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { cssRefs, encFor, typeFor } from '../src';
import type { EncodedBlob, ExternalEntry, ScreenVersion, Viewport } from '../src/types';

const SKIP = /^(\.|node_modules$|__MACOSX$|Thumbs\.db$|desktop\.ini$)/i;
const MAX_FILES = 5000;
const MAX_EXTERNAL_PER_ROOT = 120;

export interface ScannedFile {
  path: string;
  size: number;
  type: string;
  /** 다른 파일에서 이름이 언급되는지(추정). false 면 기본 제외를 제안한다 */
  referenced: boolean;
}

export interface ScanResult {
  dir: string;
  name: string;
  files: ScannedFile[];
  htmls: string[];
  entry: string;
  title?: string;
  description?: string;
  external: string[];
}

export interface Fetched {
  ok: boolean;
  status: number;
  type?: string;
  bytes: Uint8Array;
}
export type Fetcher = (url: string) => Promise<Fetched>;

export const nodeFetcher: Fetcher = async (url) => {
  const r = await fetch(url);
  return { ok: r.ok, status: r.status, type: r.headers.get('content-type') ?? undefined, bytes: new Uint8Array(await r.arrayBuffer()) };
};

/** 화면 폴더가 작업 폴더를 겸할 때 — 작업 폴더가 만든 것은 화면에 넣지 않는다 */
const WS_NAMES = /^(terrarium\.json|screens|blobs|dist|returned)$/i;

async function walk(dir: string, root = dir, out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const ws = dir === root && entries.some((d) => d.name === 'terrarium.json');
  for (const d of entries) {
    if (SKIP.test(d.name) || /\.terr\.html$/i.test(d.name) || (ws && WS_NAMES.test(d.name))) continue;
    const p = join(dir, d.name);
    if (d.isDirectory()) await walk(p, root, out);
    else if (d.isFile()) out.push(relative(root, p).split(sep).join('/'));
    if (out.length > MAX_FILES) throw new Error(`파일이 너무 많습니다 (${MAX_FILES}개 초과). 화면 폴더가 맞는지 확인해 주세요.`);
  }
  return out;
}

const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;

function pickEntry(htmls: string[]): string {
  return htmls.find((h) => /^index\.html?$/i.test(h)) ?? htmls.find((h) => !h.includes('/')) ?? htmls[0];
}

/** 엔트리 HTML 이 직접 거는 외부 URL (link·script·img·source·inline style) */
export function externalRefs(html: string): string[] {
  const out = new Set<string>();
  for (const tag of html.matchAll(/<(link|script|img|source|video|audio)\b[^>]*>/gi)) {
    const t = tag[0];
    if (/^<link/i.test(t) && /rel\s*=\s*["']?(preconnect|dns-prefetch)/i.test(t)) continue;
    const m = /\b(?:src|href)\s*=\s*["']?(https?:\/\/[^"'\s>]+)/i.exec(t);
    if (m) out.add(m[1]);
  }
  for (const style of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const u of cssRefs(style[1], 'https://pkg.manna/')) if (!u.startsWith('https://pkg.manna/')) out.add(u);
  }
  return [...out];
}

export async function scanFolder(dir: string, entry?: string): Promise<ScanResult> {
  const paths = (await walk(dir)).sort();
  const htmls = paths.filter((p) => /\.html?$/i.test(p));
  if (!htmls.length) throw new Error('이 폴더에 HTML 파일이 없습니다. 화면의 index.html 이 들어 있는 폴더를 골라 주세요.');
  const theEntry = entry && htmls.includes(entry) ? entry : pickEntry(htmls);

  const sizes = new Map<string, number>();
  const texts = new Map<string, string>();
  for (const p of paths) {
    const st = await stat(join(dir, p));
    sizes.set(p, st.size);
    if (/\.(html?|m?js|css|json|svg)$/i.test(p) && st.size < 8 * 1024 * 1024) texts.set(p, await readFile(join(dir, p), 'utf8'));
  }
  const entryHtml = texts.get(theEntry) ?? '';
  const readme = paths.find((p) => /^readme\.md$/i.test(p));

  /* 넉넉하게 판단한다 — 잘못 빼면 화면이 깨지지만, 잘못 넣으면 용량만 는다.
     데이터·이미지는 이름이나 확장자 뺀 이름만 나와도(템플릿 문자열 `data/${key}.js` 대비) 참조로 본다.
     HTML 은 주석에서 서로 이름을 언급하는 일이 흔하므로 따옴표로 감싼 경로일 때만 참조로 본다. */
  const mentioned = (p: string) => {
    const name = basename(p);
    const stem = name.replace(/\.[^.]+$/, '');
    const html = /\.html?$/i.test(p);
    const needles = html ? ['"', "'", '`', '/'].flatMap((q) => [`${q}${p}`, `${q}${name}`]).filter((n) => n !== '/') : [p, name];
    if (!html && stem.length >= 3) needles.push(stem);
    for (const [q, t] of texts) if (q !== p && needles.some((n) => t.includes(n))) return true;
    return false;
  };

  const files: ScannedFile[] = paths.map((p) => ({
    path: p,
    size: sizes.get(p)!,
    type: typeFor(p),
    referenced: p === theEntry || (p !== readme && mentioned(p)),
  }));

  return {
    dir,
    name: basename(dir),
    files,
    htmls,
    entry: theEntry,
    title: TITLE_RE.exec(entryHtml)?.[1].trim(),
    description: readme,
    external: externalRefs(entryHtml),
  };
}

export interface PackOptions {
  dir: string;
  entry: string;
  include: string[];
  /** 개요로 한 번 가져올 마크다운 파일 (README.md) — 문서에는 텍스트로 들어간다 */
  notesFrom?: string;
  external: { url: string; excluded?: boolean }[];
  viewport: Viewport;
}

export interface PackResult {
  version: Omit<ScreenVersion, 'v' | 'createdAt'>;
  blobs: [string, EncodedBlob][];
  notes?: string;
  stats: { files: number; raw: number; encoded: number };
}

function makeBlob(bytes: Uint8Array, type: string): { sha: string; blob: EncodedBlob } {
  const sha = createHash('sha256').update(bytes).digest('hex');
  const enc = encFor(type);
  const body = enc === 'gz64' ? gzipSync(bytes, { level: 9 }) : bytes;
  return { sha, blob: { enc, data: Buffer.from(body).toString('base64') } };
}

/* 알려진 대체 — 같은 폰트를 파일 하나로 담는다.
 * dynamic-subset CSS 가 가리키는 조각 경로(woff2-dynamic-subset/…subset.N.woff2)에서 단일 파일 경로를 얻는다.
 * jsDelivr 의 gh 경로와 npm 경로는 폴더 구조가 달라서 원본 CSS 를 읽어야 정확하다. */
const SUBSET_DIR = '/woff2-dynamic-subset/PretendardVariable.subset.';

async function substitute(url: string, fetcher: Fetcher): Promise<{ css: string; children: string[]; note: string } | null> {
  const name = url.split('?')[0].split('/').pop()!.toLowerCase();
  if (name !== 'pretendardvariable-dynamic-subset.css' && name !== 'pretendardvariable-dynamic-subset.min.css') return null;
  const r = await fetcher(url);
  if (!r.ok) return null;
  const subset = cssRefs(new TextDecoder().decode(r.bytes), url).find((u) => u.includes(SUBSET_DIR) && u.endsWith('.woff2'));
  if (!subset) return null;
  const single = subset.slice(0, subset.indexOf(SUBSET_DIR)) + '/woff2/PretendardVariable.woff2';
  return {
    css: `@font-face{font-family:'Pretendard Variable';font-weight:45 920;font-style:normal;font-display:swap;src:url(${single}) format('woff2-variations');}`,
    children: [single],
    note: 'Pretendard dynamic-subset(파일 92개)을 같은 폰트의 단일 variable woff2 로 바꿔 담았습니다.',
  };
}

async function fetchExternal(root: string, fetcher: Fetcher, blobs: Map<string, EncodedBlob>): Promise<ExternalEntry[]> {
  const out: ExternalEntry[] = [];
  const seen = new Set<string>();
  const queue: { url: string; via?: string }[] = [{ url: root }];
  while (queue.length) {
    const { url, via } = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    if (out.length >= MAX_EXTERNAL_PER_ROOT) {
      out[0].error = `연결된 파일이 ${MAX_EXTERNAL_PER_ROOT}개를 넘어 링크로 남겼습니다.`;
      out[0].excluded = true;
      return out;
    }
    const entry: ExternalEntry = { url, ...(via ? { via } : {}) };
    out.push(entry);
    try {
      const sub = !via ? await substitute(url, fetcher) : null;
      let bytes: Uint8Array;
      let type: string;
      if (sub) {
        bytes = new TextEncoder().encode(sub.css);
        type = 'text/css';
        entry.note = sub.note;
      } else {
        const r = await fetcher(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        bytes = r.bytes;
        type = r.type?.split(';')[0].trim() || typeFor(url);
        if (type === 'application/octet-stream' || type === 'binary/octet-stream') type = typeFor(url);
      }
      const { sha, blob } = makeBlob(bytes, type);
      blobs.set(sha, blob);
      Object.assign(entry, { sha, type, size: bytes.length });
      if (type === 'text/css') {
        const children = sub ? sub.children : cssRefs(new TextDecoder().decode(bytes), url);
        for (const c of children) if (/^https?:/.test(c)) queue.push({ url: c, via: root });
      }
    } catch (e) {
      entry.error = `내려받지 못했습니다: ${(e as Error).message}`;
      entry.excluded = true;
    }
  }
  return out;
}

export async function packFolder(opts: PackOptions, fetcher: Fetcher = nodeFetcher): Promise<PackResult> {
  const blobs = new Map<string, EncodedBlob>();
  const files: ScreenVersion['files'] = {};
  let raw = 0;
  const include = new Set([...opts.include, opts.entry]);
  for (const p of include) {
    const bytes = new Uint8Array(await readFile(join(opts.dir, p)));
    const type = typeFor(p);
    const { sha, blob } = makeBlob(bytes, type);
    blobs.set(sha, blob);
    files[p] = { sha, size: bytes.length, type };
    raw += bytes.length;
  }

  const notes = opts.notesFrom ? (await readFile(join(opts.dir, opts.notesFrom), 'utf8')).replace(/\r\n?/g, '\n') : undefined;

  const external: ExternalEntry[] = [];
  for (const e of opts.external) {
    if (e.excluded) external.push({ url: e.url, excluded: true });
    else external.push(...(await fetchExternal(e.url, fetcher, blobs)));
  }
  for (const e of external) raw += e.excluded ? 0 : (e.size ?? 0);

  let encoded = 0;
  for (const b of blobs.values()) encoded += b.data.length;
  return {
    version: { entry: opts.entry, viewport: opts.viewport, files, external },
    blobs: [...blobs],
    ...(notes != null ? { notes } : {}),
    stats: { files: include.size, raw, encoded },
  };
}

