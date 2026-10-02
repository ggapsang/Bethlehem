/* Bethlehem 메인 프로세스 — 창, 작업 폴더, 파일 입출력, 화면 패키징, URL 화면(webview), 녹화 허용
 * 사용자에게 보이는 이름은 "테라리움"이다. Bethlehem·Manna 는 코드 안에서만 쓴다.
 *
 * 보안: 폴더 화면은 작성 UI 와 같은 출처(srcdoc)에서 돈다. 그래서 메인 프로세스는 사용자가 대화상자로 고르거나
 * 끌어다 놓은 경로, 예전에 그렇게 고른 최근 목록과 작업 폴더만 읽고 쓴다. URL 화면은 별도 세션의 webview 에서
 * 돌고 이 API 에 닿지 않는다.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, net, session, shell } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { EncodedBlob, MannaDoc } from '@core';
import { packFolder, scanFolder, type Fetcher, type PackOptions } from '@core/node/pack';
import { SITE_PARTITION, snapshotSite, watchSite } from './site';
import {
  bakeDist, isWorkspace, listReturned, markMerged, readReturned, readWorkspace, watchDir, writeWorkspace, type SourceLink,
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
const ICON = join(root, 'apps/bethlehem/resources/icon-256.png');
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
let unwatch: (() => void)[] = [];

function watchWorkspace(): void {
  unwatch.forEach((u) => u());
  unwatch = [];
  if (!current) return;
  const { dir } = current;
  unwatch.push(watchDir(join(dir, 'returned'), () => win?.webContents.send('returned-changed'), { delay: 800 }));
  for (const [id, link] of Object.entries(current.links)) {
    if (!existsSync(link.dir)) continue;
    unwatch.push(watchDir(link.dir, (file) => win?.webContents.send('source-changed', { screenId: id, file }), { recursive: true, delay: 2000 }));
  }
}

/* ── 창 ──────────────────────────────────────────────────────────────── */

function rendererUrl(): string {
  return process.env.ELECTRON_RENDERER_URL || pathToFileURL(join(here, '../renderer/index.html')).href;
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    title: '테라리움',
    icon: ICON,
    backgroundColor: '#F5F5F4',
    show: false,
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });
  win.once('ready-to-show', () => win?.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) e.preventDefault();
  });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
      win?.webContents.toggleDevTools();
    }
  });
  /* URL 화면의 webview — preload·격리를 메인 프로세스가 정한다. 다른 세션·다른 스킴은 붙이지 않는다 */
  win.webContents.on('will-attach-webview', (e, prefs, params) => {
    if (params.partition !== SITE_PARTITION || !/^https?:/.test(params.src)) return e.preventDefault();
    prefs.preload = join(here, '../preload/site.cjs');
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    prefs.nodeIntegration = false;
  });
  win.webContents.on('did-attach-webview', (_e, guest) => watchSite(guest));
  // 자동 저장이 남아 있으면 마저 저장하고 닫는다
  win.on('close', (e) => {
    if (!dirty || closing) return;
    e.preventDefault();
    win?.webContents.send('request-save');
    setTimeout(() => {
      if (closing || !win) return;
      const choice = dialog.showMessageBoxSync(win, {
        type: 'warning', buttons: ['닫기', '취소'], defaultId: 1, cancelId: 1, title: '테라리움',
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
  const dir = join(root, 'out/manna');
  try {
    return {
      js: await readFile(join(dir, 'manna-runtime.js'), 'utf8'),
      css: await readFile(join(dir, 'manna-runtime.css'), 'utf8'),
    };
  } catch {
    throw new Error('문서 런타임 빌드가 없습니다. npm start 로 실행하면 먼저 빌드됩니다 (또는 npm run build:manna).');
  }
});

ipcMain.handle('recent', () => ({
  files: settings.recentFiles.filter((r) => existsSync(r.path)),
  folders: settings.recentFolders.filter((r) => existsSync(r.path)),
  workspaces: settings.recentWorkspaces.filter((r) => existsSync(join(r.path, 'terrarium.json'))),
}));

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

/* 작업 폴더 */
ipcMain.handle('ws-pick', async (_e, mode: 'open' | 'create') => {
  const r = await dialog.showOpenDialog(win!, {
    title: mode === 'open' ? '작업 폴더 열기' : '새 작업 폴더 — 비어 있는 폴더를 고르거나 새로 만드세요',
    defaultPath: settings.lastWorkspace ? dirname(settings.lastWorkspace) : app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = grant(r.filePaths[0]);
  if (mode === 'open' && !isWorkspace(dir)) throw new Error(`테라리움 작업 폴더가 아닙니다 (terrarium.json 이 없습니다): ${dir}`);
  if (mode === 'create' && !isWorkspace(dir)) {
    const names = (await readdir(dir)).filter((n) => !n.startsWith('.'));
    if (names.length) throw new Error(`비어 있는 폴더를 골라 주세요. 이 폴더에는 이미 파일이 ${names.length}개 있습니다: ${dir}`);
  }
  return dir;
});

ipcMain.handle('ws-open', async (_e, dir: string) => {
  const abs = guard(dir);
  const data = await readWorkspace(abs);
  current = { dir: abs, docId: data.doc.id, links: data.links };
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
ipcMain.handle('capture-rect', async (_e, r: { x: number; y: number; width: number; height: number }) => {
  if (!win) return null;
  const img = await win.webContents.capturePage(r);
  const size = img.getSize();
  return { bytes: new Uint8Array(img.toJPEG(85)), w: size.width, h: size.height };
});

ipcMain.handle('site-snapshot', async (_e, guestId: number) => snapshotSite(guestId));

ipcMain.on('set-state', (_e, s: { title: string; dirty: boolean }) => {
  dirty = s.dirty;
  win?.setTitle(s.title);
  win?.setDocumentEdited(s.dirty);
});

ipcMain.on('close-now', () => {
  closing = true;
  win?.close();
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await loadSettings();
  // 녹화 — 화면 공유를 요청하면 묻지 않고 이 창(요청한 프레임)을 건넨다
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    callback({ video: request.frame ?? undefined });
  });
  createWindow();
});

app.on('window-all-closed', () => app.quit());
