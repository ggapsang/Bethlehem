/* Bethlehem 세션 — 작업 폴더(기본) 또는 테라리움 문서 하나를 연다. 고치면 자동으로 저장한다.
 *   작업 폴더: 화면별 JSON·블롭으로 풀어 두고, dist/ 에 보낼 파일을 자동으로 구워 둔다. 원본 폴더·returned/ 를 감시한다.
 *   문서 하나: 그 .terr.html 에 바로 저장한다. 열 때 "작업 폴더로 풀기"를 권한다 (그 문서가 든 폴더도 된다).
 *   폴더 열기: 비어 있지 않아도 된다 — 작업 폴더면 열고, 테라리움 문서가 들었으면 풀어서, 화면(HTML)이 들었으면 등록까지.
 */
import { signal } from '@preact/signals';
import type { EncodedBlob, MannaDoc, Screen, ScreenVersion } from '@core';
import { isManna, latest, mergeDoc, newDoc, nextScreenId, now, parseManna, referencedShas } from '@core';
import type { Host } from '@manna/host';
import { deleteScreen } from '@manna/actions';
import { buildHtml, flushAutosave, save, suggestedName } from '@manna/host';
import {
  addBlobs, blobs, dirty, doc, draft, fileName, loadDocument, mutate, notify, saveState, screenId, selectScreen, undo, user, versionNo,
} from '@manna/store';
import type { RecentItem, RecentUrl, Returned, SourceLink } from '../../shared/api';

const api = window.bethlehem;

export type Mode = { kind: 'none' } | { kind: 'workspace'; dir: string; url?: string } | { kind: 'file'; path: string };
export const mode = signal<Mode>({ kind: 'none' });
export const links = signal<Record<string, SourceLink>>({});
export const returned = signal<Returned[]>([]);
export const recent = signal<{ files: RecentItem[]; folders: RecentItem[]; workspaces: RecentItem[]; urls: RecentUrl[] }>({ files: [], folders: [], workspaces: [], urls: [] });

/** 화면 등록 대화상자 — 새 화면이거나 기존 화면의 새 버전 */
export type ImportTarget = { dir: string; screenId?: string; entry?: string };
export const importing = signal<ImportTarget | null>(null);
/** URL 대화상자 — 화면 추가(새 버전) 또는 URL 을 문서로 열기(open) */
export const urlAsk = signal<{ screenId?: string; open?: boolean } | null>(null);

const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;
const clean = (m: string) => m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/** 작업 폴더에 이미 쓴 블롭 — 새로 생긴 것만 보낸다 */
let saved = new Set<string>();

/** 지금 작업 폴더가 URL 로 연 문서면 그 주소 */
export function placeUrl(): string | null {
  const m = mode.value;
  if (m.kind !== 'workspace') return null;
  if (m.url) return m.url;
  return recent.value.urls.find((r) => r.dir.toLowerCase() === m.dir.toLowerCase())?.url ?? null;
}

export function placeName(): string {
  const m = mode.value;
  const u = placeUrl();
  if (u) {
    const x = new URL(u);
    return x.host + (x.pathname === '/' ? '' : x.pathname);
  }
  return m.kind === 'workspace' ? basename(m.dir) : m.kind === 'file' ? basename(m.path) : '새 문서';
}

export async function refreshRecent(): Promise<void> {
  recent.value = await api.recent().catch(() => ({ files: [], folders: [], workspaces: [], urls: [] }));
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
  async exportFile(html, name) {
    return api.exportAs({ html, suggestedName: name });
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

/** 작업 폴더를 그대로 연다 */
export async function openWorkspace(dir: string): Promise<boolean> {
  try {
    await flushAutosave(host).catch(() => {});
    const data = await api.wsOpen(dir);
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

/** URL 을 문서로 연다 — 탭에 덧붙이지 않고 그 주소만의 문서. 작업 폴더는 프로그램 안에 두고, 같은 주소를 다시 열면 이어서 */
export async function openUrl(url: string): Promise<boolean> {
  try {
    await flushAutosave(host).catch(() => {});
    const { dir, exists } = await api.wsForUrl(url);
    await refreshRecent();
    const withUrl = (ok: boolean) => {
      const m = mode.peek();
      if (ok && m.kind === 'workspace') mode.value = { ...m, url };
      return ok;
    };
    if (exists) return withUrl(await openWorkspace(dir));
    const keep = { d: doc.peek(), b: blobs, m: mode.peek(), f: fileName.peek() };
    const d = newDoc();
    const u = new URL(url);
    d.meta.title = u.host + (u.pathname === '/' ? '' : u.pathname.replace(/\/$/, ''));
    loadDocument(d, new Map(), null);
    links.value = {};
    if (!(await createWorkspace(dir, true))) {
      loadDocument(keep.d, keep.b, keep.f);
      mode.value = keep.m;
      return false;
    }
    addSiteScreen(url, d.meta.title);
    return withUrl(true);
  } catch (e) {
    notify(clean((e as Error).message), 'error');
    return false;
  }
}

/** 여러 테라리움 문서가 든 폴더 — 어느 것을 풀지 고른다 */
export const docAsk = signal<{ dir: string; docs: { path: string; name: string; at: string; title?: string }[] } | null>(null);

/** 폴더 열기 — 무엇이 들었든 그 폴더를 작업 폴더로 쓴다.
 *   작업 폴더 → 그대로 연다 · 테라리움 문서가 있으면 → 그 문서를 풀어서 · 화면(HTML)이 있으면 → 새 작업 폴더 + 화면 등록 · 그 밖 → 새 작업 폴더
 */
export async function openFolder(dir?: string): Promise<boolean> {
  try {
    const target = dir ?? (await api.wsPick());
    if (!target) return false;
    const info = await api.wsInspect(target);
    if (info.isWorkspace) return openWorkspace(target);
    if (info.docs.length > 1) {
      docAsk.value = { dir: target, docs: info.docs };
      return false;
    }
    if (info.docs.length === 1) return unpackInto(target, info.docs[0]!.path);
    await flushAutosave(host).catch(() => {});
    const keep = { d: doc.peek(), b: blobs, m: mode.peek(), f: fileName.peek() };
    loadDocument(newDoc(), new Map(), null);
    links.value = {};
    if (!(await createWorkspace(target))) {
      loadDocument(keep.d, keep.b, keep.f);
      mode.value = keep.m;
      return false;
    }
    if (info.prototype) importing.value = { dir: await api.useFolder(target) };
    return true;
  } catch (e) {
    notify(clean((e as Error).message), 'error');
    return false;
  }
}

/** 테라리움 문서를 그 폴더(또는 고른 폴더)에 풀어 작업 폴더로 만든다 */
export async function unpackInto(dir: string, docPath: string): Promise<boolean> {
  docAsk.value = null;
  try {
    await flushAutosave(host).catch(() => {});
    const f = await api.openPath(docPath);
    if (!isManna(f.html)) throw new Error(`${f.name} 은 테라리움 문서가 아닙니다.`);
    const { doc: d, blobs: b } = parseManna(f.html);
    loadDocument(d, b, null);
    links.value = {};
    return createWorkspace(dir);
  } catch (e) {
    notify(clean((e as Error).message), 'error');
    return false;
  }
}

/** 지금 문서를 작업 폴더에 풀어 두고 이어서 작업한다. 폴더는 비어 있지 않아도 된다 */
export async function createWorkspace(dir?: string, quiet = false): Promise<boolean> {
  try {
    const m = mode.peek();
    const target = dir ?? (await api.wsPick({
      title: '작업 폴더로 쓸 폴더',
      ...(m.kind === 'file' ? { defaultPath: m.path.replace(/[\\/][^\\/]*$/, '') } : {}),
    }));
    if (!target) return false;
    if ((await api.wsInspect(target)).isWorkspace) {
      notify(`${basename(target)} 은 이미 작업 폴더입니다.`, 'error', { label: '그 폴더 열기', run: () => openWorkspace(target) });
      return false;
    }
    saved = new Set();
    mode.value = { kind: 'workspace', dir: target };
    fileName.value = null;
    await writeWorkspace(target);
    await bake(target);
    dirty.value = false;
    afterLoad();
    if (!quiet) notify(`작업 폴더 — ${basename(target)}`);
    return true;
  } catch (e) {
    notify(clean((e as Error).message), 'error');
    return false;
  }
}

export function closeToStart(): void {
  api.wsClose();
}

async function ensurePlace(): Promise<boolean> {
  if (mode.peek().kind !== 'none') return true;
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
  notify(name, 'info', { label: '작업 폴더로 풀기', run: () => createWorkspace() });
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
    if (mode.peek().kind === 'none') return void (await openFolder(g.path));
    importing.value = { dir: g.path };
    refreshRecent();
  } else if (/\.html?$/i.test(g.name)) {
    if (mode.peek().kind === 'workspace') {
      await addScreensFromFiles([g.path]);
      notify(`${g.name} 의 화면을 이 문서로 가져왔습니다.`, 'info', { label: '대신 그 문서 열기', run: () => openDocument(g.path) });
    } else await openDocument(g.path);
  }
  else if (IMAGE_RE.test(g.name)) {
    const more = await Promise.all([...files].slice(1).map((f) => api.grantDropped(f)));
    await addImageScreen(undefined, [g, ...more].filter((x): x is NonNullable<typeof x> => !!x && IMAGE_RE.test(x.name)).map((x) => x.path));
  } else notify('폴더, 테라리움 문서(.terr.html), 그림(png · jpg) 중 하나를 끌어다 놓아 주세요.', 'error');
}

const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp)$/i;

/** 그림 화면 — 요소가 없으니 Comment 는 영역 박스로만 단다 */
export async function addImageScreen(screenId?: string, paths?: string[]): Promise<void> {
  try {
    if (!(await ensurePlace())) return;
    const list = paths ?? (await api.pickImage());
    for (const p of list) {
      const r = await api.packImage(p);
      applyImport(screenId, { version: r.version, blobs: r.blobs }, { title: r.title, label: '그림', moveAnnotations: true });
    }
  } catch (e) {
    notify(`그림을 열지 못했습니다: ${clean((e as Error).message)}`, 'error');
  }
}

/** 다른 테라리움 문서의 화면들을 이 문서로 가져온다 — 버전 · 개요 · Comment(답글 · 캡처 · 클립)까지. 화면 번호는 새로 매긴다 */
export function importDocScreens(html: string, name: string): number {
  if (!isManna(html)) throw new Error(`${name} 은 테라리움 문서가 아닙니다.`);
  const inc = parseManna(html);
  if (!inc.doc.screens.length) return 0;
  addBlobs(inc.blobs);
  const ids: string[] = [];
  mutate((d: MannaDoc) => {
    for (const s of inc.doc.screens) {
      const id = nextScreenId(d);
      const copy: Screen = JSON.parse(JSON.stringify(s));
      copy.id = id;
      d.screens.push(copy);
      ids.push(id);
    }
    d.changelog.push({ version: d.meta.version, date: now(), author: user.value ?? '', note: `${name} 에서 화면 ${ids.length}개 가져옴 (${ids.join(', ')})` });
  }, { label: '화면 가져오기' });
  for (const id of ids) selectScreen(id);
  return ids.length;
}

/** ＋ 의 "파일…" — 테라리움 문서는 그 안의 화면들을, 그림은 그림 화면으로. 여러 개를 한 번에 */
export async function addScreensFromFiles(paths?: string[]): Promise<void> {
  try {
    if (!(await ensurePlace())) return;
    const list = paths ?? (await api.pickScreenFiles());
    const images = list.filter((p) => IMAGE_RE.test(p));
    let n = 0;
    for (const p of list.filter((x) => !IMAGE_RE.test(x))) n += importDocScreens(await api.readDoc(p), basename(p));
    if (images.length) await addImageScreen(undefined, images);
    if (n) notify(`화면 ${n + images.length}개를 가져왔습니다.`);
  } catch (e) {
    notify(`가져오지 못했습니다: ${clean((e as Error).message)}`, 'error');
  }
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
  if (deleteScreen(id) && links.peek()[id]) {
    const { [id]: _gone, ...rest } = links.peek();
    links.value = rest;
  }
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

/** 바깥(터미널의 Claude Code · 편집기)에서 작업 폴더를 고쳤다 — 다시 불러온다. 되돌리기로 되돌릴 수 있다 */
export async function reloadWorkspace(force = false): Promise<void> {
  const m = mode.peek();
  if (m.kind !== 'workspace') return;
  // 쓰는 중(새 Comment 작성 · 아직 저장 안 한 고침)에는 덮어쓰지 않고 묻는다
  if ((dirty.peek() || draft.peek()) && !force) {
    notify('바깥에서 작업 폴더가 바뀌었습니다. 아직 저장하지 않은 고침이 있어 바로 불러오지 않았습니다.', 'info', { label: '바깥 것으로 다시 불러오기', run: () => reloadWorkspace(true) });
    return;
  }
  try {
    const data = await api.wsOpen(m.dir);
    addBlobs(data.blobs);
    for (const [sha] of data.blobs) saved.add(sha);
    links.value = data.links;
    const same = JSON.stringify(data.doc) === JSON.stringify(doc.peek());
    if (same) return;
    mutate((d: MannaDoc) => {
      for (const k of Object.keys(d)) delete (d as unknown as Record<string, unknown>)[k];
      Object.assign(d, JSON.parse(JSON.stringify(data.doc)));
    }, { label: '바깥에서 바뀐 작업 폴더' });
    const sid = screenId.peek();
    if (sid && !doc.peek().screens.some((s) => s.id === sid) && doc.peek().screens[0]) selectScreen(doc.peek().screens[0]!.id);
    notify('바깥에서 바뀐 작업 폴더를 다시 불러왔습니다.', 'info', { label: '되돌리기', run: undo });
  } catch (e) {
    notify(`다시 불러오지 못했습니다: ${clean((e as Error).message)}`, 'error');
  }
}
api.onWorkspaceChanged(() => reloadWorkspace());
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

/** 시작 — 저절로 열지 않는다. 첫 화면에 최근 작업 폴더 · URL · 문서를 보이고 고르게 한다 */
export async function start(): Promise<void> {
  await refreshRecent();
}

export { save };
