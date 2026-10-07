/* Bethlehem 메인 프로세스 — 창, 작업 폴더, 파일 입출력, 화면 패키징, URL 화면(webview), 녹화 허용
 * 사용자에게 보이는 이름은 "테라리움"이다. Bethlehem·Manna 는 코드 안에서만 쓴다.
 *
 * 보안: 폴더 화면은 작성 UI 와 같은 출처(srcdoc)에서 돈다. 그래서 메인 프로세스는 사용자가 대화상자로 고르거나
 * 끌어다 놓은 경로, 예전에 그렇게 고른 최근 목록과 작업 폴더만 읽고 쓴다. URL 화면은 별도 세션의 webview 에서
 * 돌고 이 API 에 닿지 않는다.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, net, session, shell } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync, watch } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { EncodedBlob, MannaDoc } from '@core';
import { packFolder, scanFolder, sourceChanges, type Fetcher, type PackOptions } from '@core/node/pack';
import { IMAGE_EXT, packImage } from './image';
import { buildMenu } from './menu';
import { killTerminal, setupTerminal } from './terminal';
import { SITE_PARTITION, snapshotSite, watchSite } from './site';
import {
  bakeDist, isWorkspace, ownWrites, listReturned, markMerged, readReturned, readWorkspace, watchDir, writeWorkspace, type SourceLink,
} from './workspace';

const here = dirname(fileURLToPath(import.meta.url));
const root = app.getAppPath();
const granted = new Set<string>();
let win: BrowserWindow | null = null;
let dirty = false;
let closing = false;

/* 테스트용 — 미리 허용할 경로, 분리된 사용자 데이터 폴더 */
for (const p of (process.env.BETHLEHEM_E2E_GRANT ?? '').split(';').filter(Boolean)) granted.add(resolve(p));
if (process.env.BETHLEHEM_USER_DATA) app.setPath('userData', resolve(process.env.BETHLEHEM_USER_DATA));

app.setName('Terrarium');
/** 실행본(run/)에서는 main 옆에, 소스 트리(out/)에서는 저장소 안의 자리에 있다 */
const beside = (rel: string, inRepo: string) => (existsSync(join(here, '..', rel)) ? join(here, '..', rel) : join(root, inRepo));
const ICON = beside('resources/icon-256.png', 'apps/bethlehem/resources/icon-256.png');
const EXT = 'terr.html';

function grant(p: string): string {
  const abs = resolve(p);
  granted.add(abs);
  return abs;
}

function allowed(p: string): boolean {
  const abs = resolve(p);
  for (const g of granted) {
    const rel = relative(g, abs);
    if (rel === '' || (!rel.startsWith('..') && !rel.includes(':'))) return true;
  }
  return false;
}

function guard(p: string): string {
  if (!allowed(p)) throw new Error(`열 수 있는 경로가 아닙니다: ${p} — 대화상자로 고르거나 창에 끌어다 놓아 주세요.`);
  return resolve(p);
}

/* ── 설정 — 최근 경로, 마지막 작업 폴더 ─────────────────────────────── */

interface Recent {
  path: string;
  name: string;
  at: string;
}
interface Settings {
  lastDocDir?: string;
  lastFolderDir?: string;
  lastWorkspace?: string;
  lastScreen?: Record<string, { screen: string; version: number }>;
  recentFiles: Recent[];
  recentFolders: Recent[];
  recentWorkspaces: Recent[];
  /** URL 로 연 문서 — 작업 폴더는 프로그램 안(userData/sites/)에 둔다 */
  recentUrls?: { url: string; dir: string; at: string }[];
}
const SETTINGS = () => join(app.getPath('userData'), 'settings.json');
let settings: Settings = { recentFiles: [], recentFolders: [], recentWorkspaces: [] };

async function loadSettings(): Promise<void> {
  try {
    settings = { ...settings, ...JSON.parse(await readFile(SETTINGS(), 'utf8')) };
  } catch {
    /* 처음 실행 */
  }
  settings.recentWorkspaces ??= [];
  settings.recentUrls ??= [];
  for (const r of settings.recentUrls) granted.add(resolve(r.dir));
  // 예전에 사용자가 고른 경로다 — 다시 열 수 있게 허용
  for (const r of [...settings.recentFiles, ...settings.recentFolders, ...settings.recentWorkspaces]) granted.add(resolve(r.path));
}

async function saveSettings(): Promise<void> {
  await mkdir(dirname(SETTINGS()), { recursive: true });
  await writeFile(SETTINGS(), JSON.stringify(settings, null, 2));
}

function remember(kind: 'file' | 'folder' | 'workspace', p: string): void {
  const key = kind === 'file' ? 'recentFiles' : kind === 'folder' ? 'recentFolders' : 'recentWorkspaces';
  settings[key] = [{ path: p, name: basename(p), at: new Date().toISOString() }, ...settings[key].filter((r) => resolve(r.path) !== resolve(p))].slice(0, 10);
  if (kind === 'file') settings.lastDocDir = dirname(p);
  if (kind === 'folder') settings.lastFolderDir = dirname(p);
  if (kind === 'workspace') settings.lastWorkspace = p;
  saveSettings().catch(() => {});
  if (kind !== 'workspace') app.addRecentDocument?.(p);
}

const fetcher: Fetcher = async (url) => {
  const r = await net.fetch(url);
  return { ok: r.ok, status: r.status, type: r.headers.get('content-type') ?? undefined, bytes: new Uint8Array(await r.arrayBuffer()) };
};

const DOC_FILTERS = [
  { name: '테라리움 문서 (*.terr.html)', extensions: [EXT] },
  { name: 'HTML', extensions: ['html', 'htm'] },
];

const withExt = (p: string) => (/\.terr\.html$/i.test(p) ? p : p.replace(/\.html?$/i, '') + '.terr.html');

/* ── 작업 폴더 감시 ────────────────────────────────────────────────── */

let current: { dir: string; docId: string; links: Record<string, SourceLink> } | null = null;
/** 작업 폴더가 만드는 것들 — 원본 폴더와 같은 곳이어도 화면 파일로 보지 않는다 */
const WS_NAMES = new Set(['terrarium.json', 'screens', 'blobs', 'dist', 'returned']);
let unwatch: (() => void)[] = [];

/** 작업 폴더를 바깥에서 고쳤는가 (터미널의 Claude Code · 편집기) — 우리가 쓴 내용과 다르면 렌더러에 알린다 */
function watchOwnFiles(dir: string): () => void {
  const changed = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let w: ReturnType<typeof watch> | null = null;
  const check = async () => {
    const files = [...changed];
    changed.clear();
    for (const rel of files) {
      const abs = resolve(dir, rel);
      const text = await readFile(abs, 'utf8').catch(() => null);
      const mine = ownWrites.get(abs);
      if (text === mine || (text === null && mine === undefined)) continue;
      win?.webContents.send('workspace-changed', rel);
      return;
    }
  };
  try {
    w = watch(dir, { recursive: true }, (_ev, file) => {
      const rel = String(file ?? '');
      if (!(rel === 'terrarium.json' || /^screens[\\/][^\\/]+[\\/](screen\.json|comments\.json|notes(-[^\\/]+)?\.md)$/.test(rel))) return;
      changed.add(rel);
      clearTimeout(timer);
      timer = setTimeout(check, 700);
    });
  } catch {
    return () => {};
  }
  return () => {
    clearTimeout(timer);
    w?.close();
  };
}

function watchWorkspace(): void {
  unwatch.forEach((u) => u());
  unwatch = [];
  if (!current) return;
  const { dir } = current;
  unwatch.push(watchOwnFiles(dir));
  unwatch.push(watchDir(join(dir, 'returned'), () => win?.webContents.send('returned-changed'), { delay: 800 }));
  for (const [id, link] of Object.entries(current.links)) {
    if (!existsSync(link.dir)) continue;
    unwatch.push(watchDir(link.dir, (file) => {
      const first = file.split(/[\\/]/)[0];
      if (WS_NAMES.has(first) || file.endsWith('.terr.html') || file.endsWith('.tmp')) return;
      win?.webContents.send('source-changed', { screenId: id, file });
    }, { recursive: true, delay: 2000 }));
  }
}

/* ── 창 ──────────────────────────────────────────────────────────────── */

function rendererUrl(): string {
  return pathToFileURL(join(here, '../renderer/index.html')).href;
}

const WEB_PREFS = () => ({
  preload: join(here, '../preload/index.cjs'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webviewTag: true,
});

/** 창마다 같은 규칙 — 바깥 주소는 브라우저로, 페이지 이동 막기, F12, URL 화면 webview 의 preload · 격리 */
function guardWindow(w: BrowserWindow): void {
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    if (url !== w.webContents.getURL()) e.preventDefault();
  });
  w.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
      w.webContents.toggleDevTools();
    }
  });
  /* URL 화면의 webview — preload·격리를 메인 프로세스가 정한다. 다른 세션·다른 스킴은 붙이지 않는다 */
  w.webContents.on('will-attach-webview', (e, prefs, params) => {
    if (params.partition !== SITE_PARTITION || !/^https?:/.test(params.src)) return e.preventDefault();
    prefs.preload = join(here, '../preload/site.cjs');
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    prefs.nodeIntegration = false;
  });
  w.webContents.on('did-attach-webview', (_e, guest) => {
    watchSite(guest);
    // URL 화면 안에 포커스가 있을 때 F12 — 그 사이트의 개발자 도구
    guest.on('before-input-event', (_ev, input) => {
      if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) guest.toggleDevTools();
    });
  });
}

/** 탭을 빼거나 복제해 띄운 창들 */
const screenWindows = new Set<BrowserWindow>();

ipcMain.handle('open-screen-window', (_e, o: { screen: string; detach: boolean; x?: number; y?: number }) => {
  const w = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    ...(o.x != null && o.y != null ? { x: Math.round(o.x - 160), y: Math.round(o.y - 20) } : {}),
    title: 'Terrarium',
    icon: ICON,
    backgroundColor: '#0c0a09',
    show: false,
    webPreferences: WEB_PREFS(),
  });
  w.setMenu(null);
  w.once('ready-to-show', () => w.show());
  guardWindow(w);
  screenWindows.add(w);
  w.on('closed', () => {
    screenWindows.delete(w);
    // beforeunload 가 못 가는 경우(멈춤 · 강제 종료)에도 본 창이 뺀 탭을 되찾게
    if (!win?.isDestroyed()) win?.webContents.send('screen-window-closed', { screen: o.screen, detach: o.detach });
  });
  const url = new URL(rendererUrl());
  url.searchParams.set('window', 'mirror');
  url.searchParams.set('screen', o.screen);
  url.searchParams.set('detach', o.detach ? '1' : '0');
  w.loadURL(url.href);
  return true;
});

function createWindow(): void {
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    title: 'Terrarium',
    icon: ICON,
    backgroundColor: '#F5F5F4',
    show: false,
    webPreferences: WEB_PREFS(),
  });
  win.once('ready-to-show', () => win?.show());
  guardWindow(win);
  // 본 창을 닫으면 거기서 띄운 창(빼낸 탭 · 복제 보기)도 닫는다
  win.on('closed', () => {
    for (const w of screenWindows) if (!w.isDestroyed()) w.destroy();
    screenWindows.clear();
  });
  // 자동 저장이 남아 있으면 마저 저장하고 닫는다
  win.on('close', (e) => {
    if (!dirty || closing) return;
    e.preventDefault();
    win?.webContents.send('request-save');
    setTimeout(() => {
      if (closing || !win) return;
      const choice = dialog.showMessageBoxSync(win, {
        type: 'warning', buttons: ['닫기', '취소'], defaultId: 1, cancelId: 1, title: 'Terrarium',
        message: '아직 저장되지 않은 변경이 있습니다.', detail: '그래도 닫을까요?',
      });
      if (choice === 0) {
        closing = true;
        win?.close();
      }
    }, 5000);
  });

  win.loadURL(rendererUrl());
}

/* ── IPC ──────────────────────────────────────────────────────────────── */

ipcMain.handle('runtime', async () => {
  const dir = join(here, '../manna');
  try {
    return {
      js: await readFile(join(dir, 'manna-runtime.js'), 'utf8'),
      css: await readFile(join(dir, 'manna-runtime.css'), 'utf8'),
    };
  } catch {
    throw new Error('문서 런타임이 없습니다. npm start 로 다시 켜 주세요.');
  }
});

/** URL 로 연 문서의 작업 폴더 — 사용자가 고르지 않는다. 주소마다 하나, 다시 열면 같은 폴더 */
const SITES = () => join(app.getPath('userData'), 'sites');
const inSites = (p: string) => !relative(SITES(), resolve(p)).startsWith('..');

ipcMain.handle('recent', () => ({
  files: settings.recentFiles.filter((r) => existsSync(r.path)),
  folders: settings.recentFolders.filter((r) => existsSync(r.path)),
  workspaces: settings.recentWorkspaces.filter((r) => existsSync(join(r.path, 'terrarium.json')) && !inSites(r.path)),
  urls: (settings.recentUrls ?? []).filter((r) => existsSync(join(r.dir, 'terrarium.json'))),
}));

ipcMain.handle('ws-for-url', async (_e, url: string) => {
  const u = new URL(url);
  const slug = `${u.host}${u.pathname}`.replace(/[^a-z0-9가-힣.-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'site';
  const hash = createHash('sha1').update(u.href).digest('hex').slice(0, 6);
  const dir = join(SITES(), `${slug}-${hash}`);
  await mkdir(dir, { recursive: true });
  grant(dir);
  settings.recentUrls = [{ url: u.href, dir, at: new Date().toISOString() }, ...(settings.recentUrls ?? []).filter((r) => r.url !== u.href)].slice(0, 10);
  saveSettings().catch(() => {});
  return { dir, exists: isWorkspace(dir) };
});

/* 단일 문서 */
ipcMain.handle('open-file', async () => {
  const r = await dialog.showOpenDialog(win!, {
    title: '테라리움 문서 열기',
    defaultPath: settings.lastDocDir,
    filters: [{ name: '테라리움 문서', extensions: [EXT, 'html', 'htm'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = grant(r.filePaths[0]);
  remember('file', p);
  return { path: p, name: basename(p), html: await readFile(p, 'utf8') };
});

ipcMain.handle('open-path', async (_e, p: string) => {
  const abs = guard(p);
  const html = await readFile(abs, 'utf8');
  remember('file', abs);
  return { path: abs, name: basename(abs), html };
});

/** 단일 문서 저장 — path 가 있으면 그대로 덮어쓰기, saveAs 이거나 path 가 없으면 대화상자 */
ipcMain.handle('save-file', async (_e, o: { html: string; path: string | null; suggestedName: string; saveAs: boolean }) => {
  let target = o.path && !o.saveAs && allowed(o.path) ? resolve(o.path) : null;
  if (!target) {
    const r = await dialog.showSaveDialog(win!, {
      title: o.saveAs ? '다른 이름으로 저장' : '테라리움 문서 저장',
      defaultPath: join(o.path ? dirname(o.path) : (settings.lastDocDir ?? app.getPath('documents')), o.suggestedName),
      filters: DOC_FILTERS,
    });
    if (r.canceled || !r.filePath) return null;
    target = grant(withExt(r.filePath));
  }
  await writeFile(target, o.html, 'utf8');
  remember('file', target);
  return target;
});

/* 화면 폴더 */
ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win!, {
    title: '화면 폴더 선택 (index.html 이 들어 있는 폴더)',
    defaultPath: settings.lastFolderDir,
    properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = grant(r.filePaths[0]);
  remember('folder', p);
  return p;
});

ipcMain.handle('use-folder', async (_e, p: string) => {
  const abs = guard(p);
  remember('folder', abs);
  return abs;
});

ipcMain.handle('grant-dropped', async (_e, p: string) => {
  if (!p) return null;
  const st = await stat(p);
  const abs = grant(p);
  const ws = st.isDirectory() && isWorkspace(abs);
  if (st.isDirectory() && !ws) remember('folder', abs);
  return { path: abs, name: basename(p), isDir: st.isDirectory(), isWorkspace: ws };
});

ipcMain.handle('scan-folder', async (_e, dir: string, entry?: string) => scanFolder(guard(dir), entry));
ipcMain.handle('pack-folder', async (_e, opts: PackOptions) => packFolder({ ...opts, dir: guard(opts.dir) }, fetcher));
ipcMain.handle('source-check', async (_e, o: { link: SourceLink; files: Record<string, { sha: string }>; since: string }) =>
  allowed(o.link.dir) && existsSync(o.link.dir) ? sourceChanges({ ...o.link, dir: resolve(o.link.dir), files: o.files, since: o.since }) : null);

/* 작업 폴더 */
/* 그림 화면 */
ipcMain.handle('pick-image', async () => {
  const r = await dialog.showOpenDialog(win!, {
    title: '그림 열기 (png · jpg)',
    defaultPath: settings.lastFolderDir,
    filters: [{ name: '그림', extensions: IMAGE_EXT }],
    properties: ['openFile', 'multiSelections'],
  });
  if (r.canceled || !r.filePaths.length) return [];
  return r.filePaths.map((f) => grant(f));
});
/* 화면으로 가져올 파일 — 다른 테라리움 문서(그 안의 화면들)나 그림, 여러 개 */
ipcMain.handle('pick-screen-files', async () => {
  const r = await dialog.showOpenDialog(win!, {
    title: '화면 가져오기 — 테라리움 문서 · 그림',
    defaultPath: settings.lastDocDir ?? settings.lastFolderDir,
    filters: [
      { name: '테라리움 문서 · 그림', extensions: [EXT, 'html', ...IMAGE_EXT] },
      { name: '테라리움 문서 (*.terr.html)', extensions: [EXT, 'html'] },
      { name: '그림', extensions: IMAGE_EXT },
    ],
    properties: ['openFile', 'multiSelections'],
  });
  if (r.canceled || !r.filePaths.length) return [];
  return r.filePaths.map((f) => grant(f));
});
ipcMain.handle('read-doc', async (_e, p: string) => readFile(guard(p), 'utf8'));
ipcMain.on('toggle-devtools', () => win?.webContents.toggleDevTools());
/** 터미널에서 Claude Code 를 띄울 때 읽힐 작업 폴더 형식 문서 */
ipcMain.handle('format-doc', () => beside('resources/WORKSPACE_FORMAT.md', 'docs/WORKSPACE_FORMAT.md'));
ipcMain.handle('pack-image', async (_e, path: string) => packImage(guard(path)));

/** 폴더 고르기 — 비어 있지 않아도 된다. 무엇이 들었는지는 ws-inspect 로 본다 */
ipcMain.handle('ws-pick', async (_e, o: { title?: string; defaultPath?: string } = {}) => {
  const r = await dialog.showOpenDialog(win!, {
    title: o.title ?? '폴더 열기 — 작업 폴더, 테라리움 문서가 든 폴더, 화면 폴더, 빈 폴더',
    defaultPath: o.defaultPath ?? (settings.lastWorkspace ? dirname(settings.lastWorkspace) : app.getPath('documents')),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return grant(r.filePaths[0]);
});

/** 폴더에 무엇이 들었나 — 작업 폴더인지, 테라리움 문서가 있는지, 화면(HTML)이 있는지 */
ipcMain.handle('ws-inspect', async (_e, dir: string) => {
  const abs = guard(dir);
  const names = (await readdir(abs).catch(() => [] as string[])).filter((n) => !n.startsWith('.'));
  const docs: { path: string; name: string; at: string; title?: string }[] = [];
  for (const n of names.filter((x) => /\.html?$/i.test(x))) {
    const fp = join(abs, n);
    // 맨 앞의 AI 가이드 주석 뒤에 문서 데이터가 온다 — 앞부분을 넉넉히 본다
    const head = (await readFile(fp, 'utf8').catch(() => '')).slice(0, 20000);
    if (!head.includes('TERRARIUM-AI-GUIDE') && !head.includes('id="manna-doc"') && !head.includes('Terrarium Manna')) continue;
    const title = /<title>([^<]*)<\/title>/i.exec(head)?.[1];
    docs.push({ path: fp, name: n, at: (await stat(fp)).mtime.toISOString(), ...(title ? { title } : {}) });
  }
  docs.sort((x, y) => y.at.localeCompare(x.at));
  const prototype = names.some((n) => /\.html?$/i.test(n) && !/\.terr\.html$/i.test(n) && !docs.some((d) => d.name === n));
  return { isWorkspace: isWorkspace(abs), docs, prototype, empty: names.length === 0 };
});

ipcMain.handle('ws-open', async (_e, dir: string) => {
  const abs = guard(dir);
  const data = await readWorkspace(abs);
  current = { dir: abs, docId: data.doc.id, links: data.links };
  // 이 작업 폴더의 화면들이 연결된 원본 폴더 — 바뀐 것을 비교하고 새 버전으로 다시 읽을 수 있게
  for (const l of Object.values(data.links)) if (existsSync(l.dir)) granted.add(resolve(l.dir));
  remember('workspace', abs);
  watchWorkspace();
  return { ...data, last: settings.lastScreen?.[abs] ?? null };
});

ipcMain.handle('ws-last', () => (settings.lastWorkspace && existsSync(join(settings.lastWorkspace, 'terrarium.json')) ? settings.lastWorkspace : null));

ipcMain.handle('ws-save', async (_e, o: { dir: string; doc: MannaDoc; blobs: [string, EncodedBlob][]; links: Record<string, SourceLink> }) => {
  const abs = guard(o.dir);
  await writeWorkspace(abs, o.doc, o.blobs, o.links);
  const linksChanged = JSON.stringify(current?.links) !== JSON.stringify(o.links);
  current = { dir: abs, docId: o.doc.id, links: o.links };
  if (linksChanged) watchWorkspace();
  remember('workspace', abs);
  return true;
});

ipcMain.handle('ws-bake', async (_e, o: { dir: string; title: string; html: string }) => bakeDist(guard(o.dir), o.title, o.html));

ipcMain.handle('ws-returned', async () => (current ? listReturned(current.dir, current.docId) : []));
ipcMain.handle('ws-read-returned', async (_e, name: string) => (current ? readReturned(current.dir, name) : null));
ipcMain.handle('ws-mark-merged', async (_e, name: string) => current && markMerged(current.dir, name));
ipcMain.handle('ws-reveal', async (_e, what: 'dist' | 'returned' | 'root') => {
  if (!current) return;
  const p = what === 'root' ? current.dir : join(current.dir, what);
  await mkdir(p, { recursive: true });
  shell.openPath(p);
});

ipcMain.on('ws-remember-screen', (_e, o: { dir: string; screen: string; version: number }) => {
  settings.lastScreen = { ...(settings.lastScreen ?? {}), [resolve(o.dir)]: { screen: o.screen, version: o.version } };
  saveSettings().catch(() => {});
});

ipcMain.on('ws-close', () => {
  current = null;
  watchWorkspace();
  settings.lastWorkspace = undefined;
  saveSettings().catch(() => {});
});

/* 다른 이름으로 — 작업 폴더에서 보낼 파일을 원하는 곳에 */
ipcMain.handle('export-as', async (_e, o: { html: string; suggestedName: string }) => {
  const r = await dialog.showSaveDialog(win!, {
    title: '다른 이름으로 저장',
    defaultPath: join(settings.lastDocDir ?? app.getPath('documents'), o.suggestedName),
    filters: DOC_FILTERS,
  });
  if (r.canceled || !r.filePath) return null;
  const target = grant(withExt(r.filePath));
  await writeFile(target, o.html, 'utf8');
  remember('file', target);
  return target;
});

/* 창 안의 영역을 그림으로 — 피커 멈춤 그림과 Comment 의 '달 때 화면' (webview 픽셀도 들어간다) */
ipcMain.handle('capture-rect', async (e, r: { x: number; y: number; width: number; height: number }) => {
  // 부른 창을 찍는다 — 빼낸 창에서 단 Comment 도 그 창의 화면이 들어간다
  const w = BrowserWindow.fromWebContents(e.sender) ?? win;
  if (!w) return null;
  const img = await w.webContents.capturePage(r);
  const size = img.getSize();
  return { bytes: new Uint8Array(img.toJPEG(85)), w: size.width, h: size.height };
});

ipcMain.handle('site-snapshot', async (_e, guestId: number) => snapshotSite(guestId));

ipcMain.on('set-state', (e, s: { title: string; dirty: boolean }) => {
  if (e.sender !== win?.webContents) return; // 띄운 창은 저장을 본 창에 맡긴다
  dirty = s.dirty;
  win?.setTitle('Terrarium');
  win?.setDocumentEdited(s.dirty);
});

ipcMain.on('close-now', () => {
  closing = true;
  win?.close();
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(buildMenu(() => win));
  await loadSettings();
  // 녹화 — 화면 공유를 요청하면 묻지 않고 이 창(요청한 프레임)을 건넨다
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    callback({ video: request.frame ?? undefined });
  });
  setupTerminal(() => win, () => current?.dir ?? null);
  createWindow();
});

app.on('before-quit', () => killTerminal());
// 터미널(conpty)이 남아 있으면 프로세스가 끝나지 않는다 — 셸을 끊고, 그래도 남으면 잠깐 뒤 끝낸다
app.on('will-quit', () => {
  killTerminal();
  setTimeout(() => process.exit(0), 1500).unref();
});

app.on('window-all-closed', () => {
  killTerminal();
  app.quit();
});
