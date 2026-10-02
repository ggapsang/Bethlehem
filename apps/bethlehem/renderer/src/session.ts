/* Bethlehem 세션 — 작업 폴더(기본) 또는 테라리움 문서 하나를 연다. 고치면 자동으로 저장한다.
 *   작업 폴더: 화면별 JSON·블롭으로 풀어 두고, dist/ 에 보낼 파일을 자동으로 구워 둔다. 원본 폴더·returned/ 를 감시한다.
 *   문서 하나: 그 .terr.html 에 바로 저장한다. 열 때 "작업 폴더로 풀기"를 권한다.
 */
import { signal } from '@preact/signals';
import type { EncodedBlob, MannaDoc, Screen, ScreenVersion } from '@core';
import { isManna, latest, mergeDoc, newDoc, nextScreenId, now, parseManna, referencedShas } from '@core';
import type { Host } from '@manna/host';
import { buildHtml, flushAutosave, save, suggestedName } from '@manna/host';
import {
  addBlobs, blobs, dirty, doc, fileName, loadDocument, mutate, notify, saveState, screenId, selectScreen, user, versionNo,
} from '@manna/store';
import type { RecentItem, Returned, SourceLink } from '../../shared/api';

const api = window.bethlehem;

export type Mode = { kind: 'none' } | { kind: 'workspace'; dir: string } | { kind: 'file'; path: string };
export const mode = signal<Mode>({ kind: 'none' });
export const links = signal<Record<string, SourceLink>>({});
export const returned = signal<Returned[]>([]);
export const recent = signal<{ files: RecentItem[]; folders: RecentItem[]; workspaces: RecentItem[] }>({ files: [], folders: [], workspaces: [] });

/** 화면 등록 대화상자 — 새 화면이거나 기존 화면의 새 버전 */
export type ImportTarget = { dir: string; screenId?: string; entry?: string };
export const importing = signal<ImportTarget | null>(null);
/** URL 화면 추가 대화상자 */
export const urlAsk = signal<{ screenId?: string } | null>(null);

const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;
const clean = (m: string) => m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/** 작업 폴더에 이미 쓴 블롭 — 새로 생긴 것만 보낸다 */
let saved = new Set<string>();

export function placeName(): string {
  const m = mode.value;
  return m.kind === 'workspace' ? basename(m.dir) : m.kind === 'file' ? basename(m.path) : '새 문서';
}

export async function refreshRecent(): Promise<void> {
  recent.value = await api.recent().catch(() => ({ files: [], folders: [], workspaces: [] }));
}

/* ── 저장 ─────────────────────────────────────────────────────────────── */

let bakeTimer: ReturnType<typeof setTimeout> | undefined;

async function bake(dir: string): Promise<string> {
  clearTimeout(bakeTimer);
  return api.wsBake({ dir, title: doc.peek().meta.title, html: await buildHtml(host) });
}

async function writeWorkspace(dir: string): Promise<void> {
  const d = doc.peek();
  const used = referencedShas(d);
  const fresh = [...blobs].filter(([sha]) => used.has(sha) && !saved.has(sha));
  await api.wsSave({ dir, doc: JSON.parse(JSON.stringify(d)), blobs: fresh, links: links.peek() });
  for (const [sha] of fresh) saved.add(sha);
}

export const host: Host = {
  kind: 'bethlehem',
  author: true,
  runtime: () => api.runtime(),
  capture: (r) => api.capture(r),
  site: { partition: 'persist:terrarium-sites' },
  async snapshotSite(guestId) {
    const s = await api.siteSnapshot(guestId);
    return { entry: s.version.entry, external: s.version.external, blobs: s.blobs };
  },
  async autosave() {
    const m = mode.peek();
    if (m.kind === 'workspace') {
      await writeWorkspace(m.dir);
      saveState.value = { kind: 'saved', where: m.dir, at: Date.now() };
      // 보낼 파일은 조금 더 모아서 굽는다
      clearTimeout(bakeTimer);
      bakeTimer = setTimeout(() => bake(m.dir).catch((e) => (saveState.value = { kind: 'error', message: clean(String(e)) })), 3000);
    } else if (m.kind === 'file') {
      const p = await api.saveFile({ html: await buildHtml(host), path: m.path, suggestedName: basename(m.path), saveAs: false });
      if (p) saveState.value = { kind: 'saved', where: p, at: Date.now() };
    } else {
      saveState.value = { kind: 'pending', message: '작업 폴더를 정하면 자동으로 저장됩니다' };
      throw new Error('아직 저장할 곳이 없습니다 — 작업 폴더를 만들어 주세요.');
    }
  },
  async save(saveAs) {
    const m = mode.peek();
    if (saveAs) {
      const html = await buildHtml(host);
      const p = m.kind === 'file'
        ? await api.saveFile({ html, path: m.path, suggestedName: suggestedName(host), saveAs: true })
        : await api.exportAs({ html, suggestedName: suggestedName(host) });
      if (!p) return false;
      if (m.kind === 'file') {
        mode.value = { kind: 'file', path: p };
        fileName.value = basename(p);
      }
      notify(`다른 이름으로 저장했습니다 — ${basename(p)}`);
      refreshRecent();
      return true;
    }
    if (m.kind === 'none') {
      if (!(await createWorkspace())) return false;
      return true;
    }
    dirty.value = true;
    await flushAutosave(host);
    if (m.kind === 'workspace') {
      const out = await bake(m.dir);
      notify(`저장했습니다 — 보낼 파일: dist/${basename(out)}`, 'info', { label: '폴더 열기', run: () => api.wsReveal('dist') });
    } else notify(`저장했습니다 — ${basename(m.path)}`);
    return true;
  },
};

/* ── 작업 폴더 ─────────────────────────────────────────────────────── */

function afterLoad(): void {
  saveState.value = { kind: 'saved', at: Date.now() };
  refreshRecent();
  refreshReturned();
}

export async function openWorkspace(dir?: string): Promise<boolean> {
  try {
    const target = dir ?? (await api.wsPick('open'));
    if (!target) return false;
    await flushAutosave(host).catch(() => {});
    const data = await api.wsOpen(target);
    loadDocument(data.doc, new Map(data.blobs), null);
    saved = new Set(data.blobs.map(([sha]) => sha));
    links.value = data.links;
    mode.value = { kind: 'workspace', dir: data.dir };
    if (data.last && data.doc.screens.some((s) => s.id === data.last!.screen)) selectScreen(data.last.screen, data.last.version);
    afterLoad();
    return true;
  } catch (e) {
    notify(clean((e as Error).message), 'error');
    return false;
  }
}

/** 지금 문서를 새 작업 폴더에 풀어 두고 이어서 작업한다 */
export async function createWorkspace(): Promise<boolean> {
  try {
    const dir = await api.wsPick('create');
    if (!dir) return false;
    saved = new Set();
    mode.value = { kind: 'workspace', dir };
    fileName.value = null;
    await writeWorkspace(dir);
    await bake(dir);
    dirty.value = false;
    afterLoad();
    notify(`작업 폴더를 만들었습니다 — ${basename(dir)}. 이제 고치면 자동으로 저장되고, 보낼 파일은 dist/ 에 늘 최신으로 있습니다.`);
    return true;
  } catch (e) {
    notify(clean((e as Error).message), 'error');
    return false;
  }
}

/** 새 문서 — 새 작업 폴더에서 시작한다 */
export async function newWorkspace(): Promise<void> {
  await flushAutosave(host).catch(() => {});
  const keep = { d: doc.peek(), b: blobs, m: mode.peek(), f: fileName.peek() };
  loadDocument(newDoc(), new Map(), null);
  links.value = {};
  if (!(await createWorkspace())) {
    // 취소 — 하던 문서로 돌아간다
    loadDocument(keep.d, keep.b, keep.f);
    mode.value = keep.m;
  }
}

export function closeToStart(): void {
  api.wsClose();
}

async function ensurePlace(): Promise<boolean> {
  if (mode.peek().kind !== 'none') return true;
  notify('먼저 작업 폴더를 정합니다 — 화면과 Comment 가 그 폴더에 자동으로 저장됩니다.');
  return createWorkspace();
}

/* ── 문서 하나 ─────────────────────────────────────────────────────── */

export function openHtml(path: string, name: string, html: string): void {
  if (!isManna(html)) {
    notify(`${name} 은 테라리움 문서가 아닙니다. 화면으로 등록하려면 그 파일이 든 폴더를 창에 끌어다 놓으세요.`, 'error');
    return;
  }
  const { doc: d, blobs: b } = parseManna(html);
  loadDocument(d, b, name);
  links.value = {};
  saved = new Set();
  mode.value = { kind: 'file', path };
  afterLoad();
  notify(`${name} 을 열었습니다. 이 파일에 바로 자동 저장됩니다.`, 'info', { label: '작업 폴더로 풀기', run: () => createWorkspace() });
}

export async function openDocument(path?: string): Promise<void> {
  try {
    await flushAutosave(host).catch(() => {});
    const f = path ? await api.openPath(path) : await api.openFile();
    if (f) openHtml(f.path, f.name, f.html);
  } catch (e) {
    notify(`문서를 열지 못했습니다: ${clean((e as Error).message)}`, 'error');
  }
}

/* ── 화면 등록 ─────────────────────────────────────────────────────── */

export async function addScreenFromFolder(screenId?: string, folder?: string): Promise<void> {
  try {
    if (!(await ensurePlace())) return;
    const dir = folder ? await api.useFolder(folder) : await api.pickFolder();
    if (dir) importing.value = { dir, screenId, entry: screenId ? links.peek()[screenId]?.entry : undefined };
    refreshRecent();
  } catch (e) {
    notify(clean((e as Error).message), 'error');
  }
}

export async function askUrl(screenId?: string): Promise<void> {
  if (await ensurePlace()) urlAsk.value = { screenId };
}

/** 창에 끌어다 놓은 것 — 작업 폴더면 열고, 화면 폴더면 등록, .html 이면 문서 열기 */
export async function handleDrop(files: FileList): Promise<void> {
  const file = files[0];
  if (!file) return;
  const g = await api.grantDropped(file);
  if (!g) return notify('끌어다 놓은 항목의 경로를 알 수 없습니다.', 'error');
  if (g.isWorkspace) await openWorkspace(g.path);
  else if (g.isDir) {
    if (!(await ensurePlace())) return;
    importing.value = { dir: g.path };
    refreshRecent();
  } else if (/\.html?$/i.test(g.name)) await openDocument(g.path);
  else notify('작업 폴더, 화면 폴더(index.html 이 든 폴더), 테라리움 문서(.terr.html) 중 하나를 끌어다 놓아 주세요.', 'error');
}

export interface Imported {
  version: Omit<ScreenVersion, 'v' | 'createdAt'>;
  blobs: [string, EncodedBlob][];
  notes?: string;
}

export interface ImportChoice {
  title: string;
  label?: string;
  moveAnnotations: boolean;
}

/** 패키징 결과(또는 URL 화면)를 문서에 넣는다. link 는 원본 폴더 — 작업 폴더에만 남는다 */
export function applyImport(targetId: string | undefined, r: Imported, choice: ImportChoice, link?: SourceLink): void {
  addBlobs(r.blobs);
  let id = targetId;
  let v = 1;
  mutate((d: MannaDoc) => {
    const t = now();
    const existing = id ? d.screens.find((s) => s.id === id) : undefined;
    const version = { createdAt: t, ...(choice.label ? { label: choice.label } : {}), ...r.version };
    if (existing) {
      v = latest(existing).v + 1;
      existing.versions.push({ v, ...version });
      if (r.notes != null) existing.notes = r.notes;
      existing.title = choice.title || existing.title;
      if (choice.moveAnnotations) {
        for (const a of existing.annotations) {
          if (a.version === v - 1) {
            a.history.push({ at: t, by: user.value ?? '', field: 'version', from: a.version, to: v });
            a.version = v;
          }
        }
      }
    } else {
      id = nextScreenId(d);
      const s: Screen = { id, title: choice.title, notes: r.notes ?? '', versions: [{ v, ...version }], annotations: [] };
      d.screens.push(s);
      if (d.screens.length === 1 && d.meta.title === '새 화면정의서') d.meta.title = `${choice.title} 화면정의서`;
    }
    d.changelog.push({ version: d.meta.version, date: t, author: user.value ?? '', note: existing ? `${id} v${v} 추가` : `${id} 등록` });
  }, { label: targetId ? '새 버전 등록' : '화면 등록' });
  if (link) links.value = { ...links.peek(), [id!]: link };
  selectScreen(id!, v);
}

/** URL 화면 — 편집기에서는 실시간 사이트가 돌고, 보낸 파일에는 마지막 사본이 들어간다 */
export function addSiteScreen(url: string, title: string, targetId?: string): void {
  applyImport(targetId, {
    version: { entry: url, source: { url, mode: 'site', at: now() }, viewport: { w: 1920, h: 1080, fit: 'contain' }, files: {}, external: [] },
    blobs: [],
  }, { title, label: `URL · ${new URL(url).host}`, moveAnnotations: true });
}

export function removeScreen(id: string): void {
  const s = doc.value.screens.find((x) => x.id === id);
  if (!s || !confirm(`${s.id} ${s.title} 을 문서에서 지울까요? Comment ${s.annotations.length}개도 함께 지워집니다. (Ctrl+Z 로 되돌릴 수 있습니다)`)) return;
  mutate((d) => (d.screens = d.screens.filter((x) => x.id !== id)), { label: '화면 삭제' });
  const first = doc.value.screens[0];
  if (first) selectScreen(first.id);
  else screenId.value = null;
}

/* ── 돌아온 문서 ───────────────────────────────────────────────────── */

export async function refreshReturned(): Promise<void> {
  returned.value = mode.peek().kind === 'workspace' ? await api.wsReturned().catch(() => []) : [];
}

export async function mergeReturned(name: string): Promise<void> {
  try {
    const html = await api.wsReadReturned(name);
    if (!html) return;
    const inc = parseManna(html);
    let report: ReturnType<typeof mergeDoc> | null = null;
    mutate((d) => (report = mergeDoc(d, inc.doc, blobs, inc.blobs)), { label: `회신 병합 · ${inc.doc.origin?.by ?? name}` });
    await api.wsMarkMerged(name);
    await refreshReturned();
    const r = report!;
    notify(`${inc.doc.origin?.by ?? name} 의 회신을 합쳤습니다 — Comment ${r.added}개 추가 · ${r.updated}개 수정 · 답글 ${r.replies}개${r.conflicts.length ? ` · 충돌 ${r.conflicts.length}건(답글로 남김)` : ''}`);
  } catch (e) {
    notify(`합치지 못했습니다: ${clean((e as Error).message)}`, 'error');
  }
}

/* ── 이벤트 ───────────────────────────────────────────────────────── */

api.onReturnedChanged(() => refreshReturned());
api.onSourceChanged(({ screenId: id }) => {
  const l = links.peek()[id];
  const s = doc.peek().screens.find((x) => x.id === id);
  if (!l || !s) return;
  notify(`${id} ${s.title} — 원본 폴더가 바뀌었습니다. 새 버전으로 등록할까요?`, 'info', {
    label: '새 버전 등록',
    run: () => (importing.value = { dir: l.dir, screenId: id, entry: l.entry }),
  });
});
api.onRequestSave(async () => {
  await flushAutosave(host).catch(() => {});
  if (!dirty.peek() || mode.peek().kind === 'none') api.closeNow();
});

/** 화면을 바꾸면 기억해 둔다 — 다음에 열 때 그 화면으로 */
export function rememberScreen(): void {
  const m = mode.peek();
  if (m.kind === 'workspace' && screenId.peek() && versionNo.peek() != null) api.wsRememberScreen({ dir: m.dir, screen: screenId.peek()!, version: versionNo.peek()! });
}

/** 시작 — 마지막 작업 폴더를 그대로 연다 */
export async function start(): Promise<void> {
  const last = await api.wsLast().catch(() => null);
  if (last) await openWorkspace(last);
  refreshRecent();
}

export { save };
