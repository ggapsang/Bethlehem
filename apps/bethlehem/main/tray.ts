/* 알림 영역(작업 표시줄 오른쪽 아래) 아이콘 — 최소화한 창은 작업 표시줄 대신 여기로 들어간다 (팀즈처럼).
 * 아이콘을 누르면 숨긴 창이 다시 뜬다. 오른쪽 단추 메뉴: 창 목록 · 새 창 · 최소화하면 트레이로 · 종료. */
import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron';

export interface TrayHooks {
  /** 프로젝트 창 — 메뉴의 창 목록 */
  projects: () => BrowserWindow[];
  newWindow: () => void;
  enabled: () => boolean;
  setEnabled: (on: boolean) => void;
}

let tray: Tray | null = null;
let hooks: TrayHooks | null = null;
/** 최소화해서 트레이로 숨긴 창 */
const hidden = new Set<BrowserWindow>();

/** 알림 영역은 16px(배율에 따라 20~32px) — 큰 아이콘을 배율마다 미리 줄여 둔다 */
function trayIcon(path: string) {
  const src = nativeImage.createFromPath(path);
  if (src.isEmpty()) return src;
  const img = nativeImage.createEmpty();
  for (const s of [1, 1.25, 1.5, 2]) {
    const px = Math.round(16 * s);
    img.addRepresentation({ scaleFactor: s, buffer: src.resize({ width: px, height: px, quality: 'best' }).toPNG() });
  }
  return img;
}

export function showWindow(w: BrowserWindow): void {
  if (w.isDestroyed()) return;
  hidden.delete(w);
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
}

/** 아이콘을 누름 — 숨긴 창을 모두 되살린다. 숨긴 창이 없으면 맨 앞 프로젝트 창을 앞으로 */
function reveal(): void {
  const list = [...hidden].filter((w) => !w.isDestroyed());
  hidden.clear();
  if (list.length) {
    // 프로젝트 창을 먼저 띄우고, 거기서 띄운 창은 그 위에
    const projects = new Set(hooks?.projects() ?? []);
    list.sort((a, b) => Number(projects.has(b)) - Number(projects.has(a))).forEach(showWindow);
    return;
  }
  const w = BrowserWindow.getFocusedWindow() ?? hooks?.projects()[0];
  if (w) showWindow(w);
}

/** 오른쪽 단추 메뉴 — 열 때마다 만든다 (창 제목 · 설정이 바뀌었을 수 있다) */
function trayMenu(h: TrayHooks): Menu {
  const wins = h.projects().filter((w) => !w.isDestroyed());
  return Menu.buildFromTemplate([
    ...wins.map((w) => ({ label: w.getTitle() || 'Terrarium', click: () => showWindow(w) })),
    ...(wins.length ? [{ type: 'separator' as const }] : []),
    { label: '새 창', click: () => h.newWindow() },
    { label: '최소화하면 트레이로', type: 'checkbox', checked: h.enabled(), click: () => h.setEnabled(!h.enabled()) },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]);
}

export function setupTray(icon: string, h: TrayHooks): void {
  hooks = h;
  tray = new Tray(trayIcon(icon));
  tray.setToolTip('Terrarium');
  tray.on('click', reveal);
  tray.on('right-click', () => tray?.popUpContextMenu(trayMenu(h)));
  // 시험에서 아이콘을 누른 것처럼 부를 수 있게
  (globalThis as { __terrTray?: unknown }).__terrTray = { tray, reveal, hidden, menu: () => trayMenu(h) };
  app.on('before-quit', () => {
    // 강제 종료로 끝나면 알림 영역에 유령 아이콘이 남는다 — 먼저 치운다
    tray?.destroy();
    tray = null;
  });
}

/** 이 창은 최소화하면 트레이로 숨는다 (설정이 켜져 있을 때) */
export function hideOnMinimize(w: BrowserWindow): void {
  w.on('minimize', () => {
    if (!tray || !hooks?.enabled()) return;
    hidden.add(w);
    w.hide();
  });
  w.on('show', () => hidden.delete(w));
  w.on('closed', () => hidden.delete(w));
}
