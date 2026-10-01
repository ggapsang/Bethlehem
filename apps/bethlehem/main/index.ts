/* Bethlehem 메인 프로세스 — 창, 파일 입출력, 화면 패키징 (docs/ARCHITECTURE.md §8)
 *
 * 보안: 품은 화면은 임의의 스크립트를 실행하고 Bethlehem UI 와 같은 출처에서 돈다.
 * 그래서 메인 프로세스는 사용자가 대화상자로 고르거나 끌어다 놓은 경로만 읽고 쓴다(granted).
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, net, shell } from 'electron';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packFolder, scanFolder, type Fetcher, type PackOptions } from '@core/node/pack';

const here = dirname(fileURLToPath(import.meta.url));
const root = app.getAppPath();
const granted = new Set<string>();
let win: BrowserWindow | null = null;
let dirty = false;
let closing = false;

/* 테스트용 — 미리 허용할 경로, 분리된 사용자 데이터 폴더 */
for (const p of (process.env.BETHLEHEM_E2E_GRANT ?? '').split(';').filter(Boolean)) granted.add(resolve(p));
if (process.env.BETHLEHEM_USER_DATA) app.setPath('userData', resolve(process.env.BETHLEHEM_USER_DATA));

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

const fetcher: Fetcher = async (url) => {
  const r = await net.fetch(url);
  return { ok: r.ok, status: r.status, type: r.headers.get('content-type') ?? undefined, bytes: new Uint8Array(await r.arrayBuffer()) };
};

const HTML_FILTER = [{ name: 'Manna 문서', extensions: ['html', 'htm'] }];

function createWindow(): void {
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    title: 'Bethlehem',
    icon: join(root, 'apps/bethlehem/resources/icon-256.png'),
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
      title: 'Bethlehem',
      message: '저장하지 않은 변경이 있습니다.',
      detail: '닫기 전에 저장할까요?',
    });
    if (choice === 0) win?.webContents.send('request-save');
    else if (choice === 1) {
      closing = true;
      win?.close();
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(here, '../renderer/index.html'));
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
    throw new Error('Manna 런타임 빌드가 없습니다. npm start 로 실행하면 먼저 빌드됩니다 (또는 npm run build:manna).');
  }
});

ipcMain.handle('open-file', async () => {
  const r = await dialog.showOpenDialog(win!, { title: 'Manna 문서 열기', filters: HTML_FILTER, properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = grant(r.filePaths[0]);
  return { path: p, name: basename(p), html: await readFile(p, 'utf8') };
});

ipcMain.handle('open-path', async (_e, p: string) => {
  const abs = guard(p);
  return { path: abs, name: basename(abs), html: await readFile(abs, 'utf8') };
});

ipcMain.handle('save-file', async (_e, o: { html: string; path: string | null; suggestedName: string; saveAs: boolean }) => {
  let target = o.path && !o.saveAs && allowed(o.path) ? resolve(o.path) : null;
  if (!target) {
    const r = await dialog.showSaveDialog(win!, {
      title: 'Manna 문서 저장',
      defaultPath: o.path ? join(dirname(o.path), o.suggestedName) : join(app.getPath('documents'), o.suggestedName),
      filters: HTML_FILTER,
    });
    if (r.canceled || !r.filePath) return null;
    target = grant(r.filePath);
  }
  await writeFile(target, o.html, 'utf8');
  return target;
});

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win!, { title: '화면 폴더 선택 (index.html 이 들어 있는 폴더)', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return grant(r.filePaths[0]);
});

ipcMain.handle('grant-dropped', async (_e, p: string) => {
  if (!p) return null;
  const st = await stat(p);
  return { path: grant(p), name: basename(p), isDir: st.isDirectory() };
});

ipcMain.handle('scan-folder', async (_e, dir: string, entry?: string) => scanFolder(guard(dir), entry));

ipcMain.handle('pack-folder', async (_e, opts: PackOptions) => packFolder({ ...opts, dir: guard(opts.dir) }, fetcher));

ipcMain.on('set-state', (_e, s: { title: string; dirty: boolean }) => {
  dirty = s.dirty;
  win?.setTitle(s.title);
  win?.setDocumentEdited(s.dirty);
});

ipcMain.on('close-now', () => {
  closing = true;
  win?.close();
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
});

app.on('window-all-closed', () => app.quit());
