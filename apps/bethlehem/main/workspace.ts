/* 작업 폴더 — 반죽. 테라리움은 이 폴더에 늘 연결되어 있고, 보낼 파일(빵)은 dist/ 에 자동으로 구워 둔다.
 *
 *   <작업 폴더>/
 *   ├── terrarium.json              문서 정보 · 화면 순서 · 참여자 · 변경 이력
 *   ├── screens/SCR-001/
 *   │   ├── screen.json             제목 · 버전들(파일 → 블롭) · 원본 폴더 연결(link)
 *   │   ├── notes.md                자유 노트 첫 탭 (나머지 탭은 notes-<id>.md)
 *   │   └── comments.json           Comment · 답글
 *   ├── blobs/ab/abcdef…            내용 해시로 저장한 파일 (원래 바이트)
 *   ├── returned/                   돌아온 .terr.html 을 넣는 곳 — 테라리움이 알아채고 병합 대기에 올린다
 *   └── dist/<제목>.terr.html        자동으로 구운 최신본
 *
 * JSON 은 화면별로 나뉘고 들여쓰기·키 순서가 고정이라 Git 으로 관리하기 좋다.
 */
import { existsSync, watch, type FSWatcher } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { resolve, basename, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { encFor, isManna, parseManna } from '@core';
import type { Annotation, EncodedBlob, MannaDoc, Screen, ScreenVersion, Pin } from '@core';

export const WS_FILE = 'terrarium.json';
const FORMAT = 'terrarium-workspace/1';

/** 화면이 어느 원본 폴더에서 왔는지 — 문서(.terr.html)에는 넣지 않는다 (작성자 컴퓨터의 경로이므로) */
export interface SourceLink {
  dir: string;
  entry: string;
  include: string[];
  notesFrom?: string;
  external: { url: string; excluded?: boolean }[];
  viewport: ScreenVersion['viewport'];
}

interface WsJson {
  format: typeof FORMAT;
  doc: Omit<MannaDoc, 'screens'>;
  screens: string[];
  dist?: string;
}

interface ScreenJson {
  id: string;
  title: string;
  /** 자유 노트 첫 탭(notes.md)의 제목 */
  notesTitle?: string;
  /** 나머지 탭 — 본문은 notes-<id>.md */
  moreNotes?: { id: string; title: string }[];
  /** 핀 */
  pins?: Pin[];
  versions: ScreenVersion[];
  link?: SourceLink;
}

export interface WorkspaceData {
  dir: string;
  doc: MannaDoc;
  blobs: [string, EncodedBlob][];
  links: Record<string, SourceLink>;
}

const pretty = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
const blobPath = (dir: string, sha: string) => join(dir, 'blobs', sha.slice(0, 2), sha);
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || '화면정의서';

export function isWorkspace(dir: string): boolean {
  return existsSync(join(dir, WS_FILE));
}

/** 블롭을 원래 바이트로 쓴다 — 이미 있으면 건너뛴다 (내용 해시이므로 같은 이름이면 같은 내용) */
async function writeBlob(dir: string, sha: string, b: EncodedBlob): Promise<void> {
  const p = blobPath(dir, sha);
  if (existsSync(p)) return;
  const raw = Buffer.from(b.data, 'base64');
  await mkdir(join(dir, 'blobs', sha.slice(0, 2)), { recursive: true });
  await writeFile(p, b.enc === 'gz64' ? gunzipSync(raw) : raw);
}

async function readBlob(dir: string, sha: string, type: string): Promise<EncodedBlob | null> {
  try {
    const raw = await readFile(blobPath(dir, sha));
    const enc = encFor(type);
    return { enc, data: (enc === 'gz64' ? gzipSync(raw, { level: 6 }) : raw).toString('base64') };
  } catch {
    return null;
  }
}

/** 문서가 참조하는 블롭과 그 형식 */
function blobTypes(doc: MannaDoc): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of doc.screens) {
    for (const v of s.versions) {
      for (const f of Object.values(v.files)) m.set(f.sha, f.type);
      for (const e of v.external) if (e.sha && !e.excluded) m.set(e.sha, e.type ?? 'application/octet-stream');
    }
    for (const a of s.annotations) {
      for (const c of a.clips ?? []) m.set(c.sha, c.type);
      if (a.shot) m.set(a.shot.sha, 'image/jpeg');
    }
  }
  return m;
}

export async function writeWorkspace(dir: string, doc: MannaDoc, blobs: [string, EncodedBlob][], links: Record<string, SourceLink>): Promise<void> {
  await mkdir(join(dir, 'screens'), { recursive: true });
  await mkdir(join(dir, 'returned'), { recursive: true });
  for (const [sha, b] of blobs) await writeBlob(dir, sha, b);
  const { screens, ...rest } = doc;
  const prev = await readJson<WsJson>(join(dir, WS_FILE));
  const ws: WsJson = { format: FORMAT, doc: rest, screens: screens.map((s) => s.id), ...(prev?.dist ? { dist: prev.dist } : {}) };
  for (const s of screens) {
    const sd = join(dir, 'screens', s.id);
    await mkdir(sd, { recursive: true });
    const sj: ScreenJson = {
      id: s.id,
      title: s.title,
      ...(s.notesTitle ? { notesTitle: s.notesTitle } : {}),
      ...(s.moreNotes?.length ? { moreNotes: s.moreNotes.map((t) => ({ id: t.id, title: t.title })) } : {}),
      ...(s.pins?.length ? { pins: s.pins } : {}),
      versions: s.versions,
      ...(links[s.id] ? { link: links[s.id] } : {}),
    };
    await writeIfChanged(join(sd, 'screen.json'), pretty(sj));
    await writeIfChanged(join(sd, 'notes.md'), s.notes ?? '');
    for (const t of s.moreNotes ?? []) await writeIfChanged(join(sd, `notes-${t.id}.md`), t.body);
    for (const name of await readdir(sd).catch(() => [] as string[])) {
      const m = /^notes-(.+)\.md$/.exec(name);
      if (m && !s.moreNotes?.some((t) => t.id === m[1])) await rm(join(sd, name), { force: true });
    }
    await writeIfChanged(join(sd, 'comments.json'), pretty(s.annotations));
  }
  // 지운 화면의 폴더는 정리한다
  for (const name of await readdir(join(dir, 'screens')).catch(() => [] as string[])) {
    if (!screens.some((s) => s.id === name)) await rm(join(dir, 'screens', name), { recursive: true, force: true });
  }
  await writeIfChanged(join(dir, WS_FILE), pretty(ws));
}

/** 테라리움이 마지막으로 쓴 내용 — 바깥(터미널 · 편집기)에서 바꾼 것과 가른다 */
export const ownWrites = new Map<string, string>();

async function writeIfChanged(p: string, text: string): Promise<void> {
  ownWrites.set(resolve(p), text);
  const old = await readFile(p, 'utf8').catch(() => null);
  if (old !== text) await writeFile(p, text, 'utf8');
}

async function readJson<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function readWorkspace(dir: string): Promise<WorkspaceData> {
  const ws = await readJson<WsJson>(join(dir, WS_FILE));
  if (!ws || ws.format !== FORMAT) throw new Error(`테라리움 작업 폴더가 아닙니다 (${WS_FILE} 이 없거나 형식이 다릅니다): ${dir}`);
  const screens: Screen[] = [];
  const links: Record<string, SourceLink> = {};
  for (const id of ws.screens) {
    const sd = join(dir, 'screens', id);
    const sj = await readJson<ScreenJson>(join(sd, 'screen.json'));
    if (!sj) continue;
    const notes = await readFile(join(sd, 'notes.md'), 'utf8').catch(() => '');
    ownWrites.set(resolve(join(sd, 'notes.md')), notes);
    const annotations = (await readJson<Annotation[]>(join(sd, 'comments.json'))) ?? [];
    const moreNotes = [];
    for (const t of sj.moreNotes ?? []) moreNotes.push({ ...t, body: await readFile(join(sd, `notes-${t.id}.md`), 'utf8').catch(() => '') });
    screens.push({
      id: sj.id, title: sj.title, notes, ...(sj.notesTitle ? { notesTitle: sj.notesTitle } : {}), ...(moreNotes.length ? { moreNotes } : {}),
      ...(sj.pins?.length ? { pins: sj.pins } : {}),
      versions: sj.versions, annotations,
    });
    if (sj.link) links[id] = sj.link;
  }
  const doc = { ...ws.doc, screens } as MannaDoc;
  const blobs: [string, EncodedBlob][] = [];
  for (const [sha, type] of blobTypes(doc)) {
    const b = await readBlob(dir, sha, type);
    if (b) blobs.push([sha, b]);
  }
  return { dir, doc, blobs, links };
}

/** dist/ 에 최신본을 쓴다. 제목이 바뀌면 예전 이름의 파일은 지운다 */
export async function bakeDist(dir: string, title: string, html: string): Promise<string> {
  const ws = await readJson<WsJson>(join(dir, WS_FILE));
  const name = `${safeName(title)}.terr.html`;
  await mkdir(join(dir, 'dist'), { recursive: true });
  const out = join(dir, 'dist', name);
  await writeFile(out + '.tmp', html, 'utf8');
  await rename(out + '.tmp', out);
  if (ws && ws.dist && ws.dist !== name) await rm(join(dir, 'dist', ws.dist), { force: true });
  // 우리가 쓴 것으로 기억해야 바깥 변경으로 잘못 알아채지 않는다
  if (ws && ws.dist !== name) await writeIfChanged(join(dir, WS_FILE), pretty({ ...ws, dist: name }));
  return out;
}

/* ── 돌아온 문서 ─────────────────────────────────────────────────────── */

export interface Returned {
  name: string;
  by?: string;
  at?: string;
  comments: number;
  sameDoc: boolean;
}

export async function listReturned(dir: string, docId: string): Promise<Returned[]> {
  const rd = join(dir, 'returned');
  const out: Returned[] = [];
  for (const name of await readdir(rd).catch(() => [] as string[])) {
    if (!/\.html?$/i.test(name)) continue;
    try {
      const html = await readFile(join(rd, name), 'utf8');
      if (!isManna(html)) continue;
      const { doc } = parseManna(html);
      out.push({ name, by: doc.origin?.by, at: doc.origin?.at ?? (await stat(join(rd, name))).mtime.toISOString(), comments: doc.screens.reduce((n, s) => n + s.annotations.length, 0), sameDoc: doc.id === docId });
    } catch {
      /* 읽을 수 없는 파일 */
    }
  }
  return out;
}

export async function readReturned(dir: string, name: string): Promise<string> {
  return readFile(join(dir, 'returned', basename(name)), 'utf8');
}

/** 병합한 회신본은 returned/merged/ 로 옮긴다 */
export async function markMerged(dir: string, name: string): Promise<void> {
  await mkdir(join(dir, 'returned', 'merged'), { recursive: true });
  await rename(join(dir, 'returned', basename(name)), join(dir, 'returned', 'merged', basename(name)));
}

/* ── 감시 — 원본 폴더 변경, 돌아온 문서 ─────────────────────────────── */

export function watchDir(dir: string, onChange: (file: string) => void, opts: { recursive?: boolean; delay?: number } = {}): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = '';
  let w: FSWatcher | null = null;
  try {
    w = watch(dir, { recursive: !!opts.recursive }, (_ev, file) => {
      last = String(file ?? '');
      clearTimeout(timer);
      timer = setTimeout(() => onChange(last), opts.delay ?? 1500);
    });
  } catch {
    return () => {};
  }
  return () => {
    clearTimeout(timer);
    w?.close();
  };
}
