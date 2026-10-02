/* Bethlehem 메인 프로세스 — 창, 파일 입출력, 화면 패키징, URL 담기 (docs/ARCHITECTURE.md §8)
 * 사용자에게 보이는 이름은 "테라리움"이다. Bethlehem·Manna 는 코드 안에서만 쓴다.
 *
 * 보안: 품은 화면은 임의의 스크립트를 실행하고 작성 UI 와 같은 출처에서 돈다.
 * 그래서 메인 프로세스는 사용자가 대화상자로 고르거나 끌어다 놓은 경로(와 최근 목록)만 읽고 쓴다.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, net, session, shell } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { packFolder, scanFolder, type Fetcher, type PackOptions } from '@core/node/pack';
import { openSnapshot } from './snapshot';

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

/* ── 최근 경로 — 대화상자가 마지막 위치에서 열리고, 최근 문서·폴더 목록을 보여 준다 ── */

interface Recent {
  path: string;
  name: string;
  at: string;
}
interface Settings {
  lastDocDir?: string;
  lastFolderDir?: string;
  recentFiles: Recent[];
  recentFolders: Recent[];
}
const SETTINGS = () => join(app.getPath('userData'), 'settings.json');
let settings: Settings = { recentFiles: [], recentFolders: [] };

async function loadSettings(): Promise<void> {
  try {
    settings = { recentFiles: [], recentFolders: [], ...JSON.parse(await readFile(SETTINGS(), 'utf8')) };
  } catch {
    /* 처음 실행 */
  }
  // 예전에 사용자가 고른 경로다 — 다시 열 수 있게 허용
  for (const r of [...settings.recentFiles, ...settings.recentFolders]) granted.add(resolve(r.path));
}

async function saveSettings(): Promise<void> {
  await mkdir(dirname(SETTINGS()), { recursive: true });
  await writeFile(SETTINGS(), JSON.stringify(settings, null, 2));
}

function remember(kind: 'file' | 'folder', p: string): void {
  const list = kind === 'file' ? settings.recentFiles : settings.recentFolders;
  const next = [{ path: p, name: basename(p), at: new Date().toISOString() }, ...list.filter((r) => resolve(r.path) !== resolve(p))].slice(0, 10);
  if (kind === 'file') {
    settings.recentFiles = next;
    settings.lastDocDir = dirname(p);
  } else {
    settings.recentFolders = next;
    settings.lastFolderDir = dirname(p);
  }
  saveSettings().catch(() => {});
  app.addRecentDocument?.(p);
}

const fetcher: Fetcher = async (url) => {
  const r = await net.fetch(url);
  return { ok: r.ok, status: r.status, type: r.headers.get('content-type') ?? undefined, bytes: new Uint8Array(await r.arrayBuffer()) };
};

const DOC_FILTERS = [
  { name: '테라리움 문서 (*.terr.html)', extensions: [EXT] },
  { name: 'HTML', extensions: ['html', 'htm'] },
];

function rendererUrl(page: 'index' | 'snapshot'): string {
  const dev = process.env.ELECTRON_RENDERER_URL;
  if (dev) return `${dev.replace(/\/$/, '')}/${page === 'index' ? '' : 'snapshot.html'}`;
  return pathToFileURL(join(here, `../renderer/${page}.html`)).href;
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
  win.on('close', (e) => {
    if (!dirty || closing) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(win!, {
      type: 'question',
      buttons: ['저장', '저장 안 함', '취소'],
      defaultId: 0,
      cancelId: 2,
      title: '테라리움',
      message: '저장하지 않은 변경이 있습니다.',
      detail: '닫기 전에 저장할까요?',
    });
    if (choice === 0) win?.webContents.send('request-save');
    else if (choice === 1) {
      closing = true;
      win?.close();
    }
  });

  win.loadURL(rendererUrl('index'));
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
}));

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

ipcMain.handle('save-file', async (_e, o: { html: string; path: string | null; suggestedName: string; saveAs: boolean }) => {
  let target = o.path && !o.saveAs && allowed(o.path) ? resolve(o.path) : null;
  if (!target) {
    const r = await dialog.showSaveDialog(win!, {
      title: '테라리움 문서 저장',
      defaultPath: join(o.path ? dirname(o.path) : (settings.lastDocDir ?? app.getPath('documents')), o.suggestedName),
      filters: DOC_FILTERS,
    });
    if (r.canceled || !r.filePath) return null;
    // 확장자를 지웠거나 .html 로만 적었으면 .terr.html 로 맞춘다
    target = grant(/\.terr\.html$/i.test(r.filePath) ? r.filePath : r.filePath.replace(/\.html?$/i, '') + '.terr.html');
  }
  await writeFile(target, o.html, 'utf8');
  remember('file', target);
  return target;
});

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

ipcMain.handle('grant-dropped', async (_e, p: string) => {
  if (!p) return null;
  const st = await stat(p);
  const abs = grant(p);
  if (st.isDirectory()) remember('folder', abs);
  return { path: abs, name: basename(p), isDir: st.isDirectory() };
});

ipcMain.handle('use-folder', async (_e, p: string) => {
  const abs = guard(p);
  remember('folder', abs);
  return abs;
});

ipcMain.handle('scan-folder', async (_e, dir: string, entry?: string) => scanFolder(guard(dir), entry));

ipcMain.handle('pack-folder', async (_e, opts: PackOptions) => packFolder({ ...opts, dir: guard(opts.dir) }, fetcher));

ipcMain.on('open-snapshot', (_e, o: { url?: string; screenId?: string }) => {
  openSnapshot({
    url: o.url,
    preload: join(here, '../preload/snapshot.cjs'),
    barUrl: rendererUrl('snapshot'),
    icon: ICON,
    onDone: (r) => win?.webContents.send('snapshot-result', { screenId: o.screenId, result: r }),
  });
});

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
