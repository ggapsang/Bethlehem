/* 렌더러에 노출할 최소 API (contextIsolation · sandbox) */
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { BethlehemApi } from '../shared/api';

const on = (channel: string, cb: (...a: never[]) => void) => {
  ipcRenderer.removeAllListeners(channel);
  ipcRenderer.on(channel, (_e, ...args) => (cb as (...a: unknown[]) => void)(...args));
};

const api: BethlehemApi = {
  runtime: () => ipcRenderer.invoke('runtime'),
  recent: () => ipcRenderer.invoke('recent'),
  wsForUrl: (url) => ipcRenderer.invoke('ws-for-url', url),
  openFile: () => ipcRenderer.invoke('open-file'),
  openPath: (path) => ipcRenderer.invoke('open-path', path),
  saveFile: (o) => ipcRenderer.invoke('save-file', o),
  exportAs: (o) => ipcRenderer.invoke('export-as', o),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  useFolder: (path) => ipcRenderer.invoke('use-folder', path),
  grantDropped: async (file) => {
    const path = webUtils.getPathForFile(file);
    return path ? ipcRenderer.invoke('grant-dropped', path) : null;
  },
  scanFolder: (dir, entry) => ipcRenderer.invoke('scan-folder', dir, entry),
  packFolder: (opts) => ipcRenderer.invoke('pack-folder', opts),
  sourceCheck: (o) => ipcRenderer.invoke('source-check', o),
  pickImage: () => ipcRenderer.invoke('pick-image'),
  pickScreenFiles: () => ipcRenderer.invoke('pick-screen-files'),
  readDoc: (path) => ipcRenderer.invoke('read-doc', path),
  packImage: (path) => ipcRenderer.invoke('pack-image', path),
  wsPick: (o) => ipcRenderer.invoke('ws-pick', o),
  wsInspect: (dir) => ipcRenderer.invoke('ws-inspect', dir),
  wsOpen: (dir) => ipcRenderer.invoke('ws-open', dir),
  wsLast: () => ipcRenderer.invoke('ws-last'),
  wsSave: (o) => ipcRenderer.invoke('ws-save', o),
  wsBake: (o) => ipcRenderer.invoke('ws-bake', o),
  wsReturned: () => ipcRenderer.invoke('ws-returned'),
  wsReadReturned: (name) => ipcRenderer.invoke('ws-read-returned', name),
  wsMarkMerged: (name) => ipcRenderer.invoke('ws-mark-merged', name),
  wsReveal: (what) => ipcRenderer.invoke('ws-reveal', what),
  wsRememberScreen: (o) => ipcRenderer.send('ws-remember-screen', o),
  wsClose: () => ipcRenderer.send('ws-close'),
  onReturnedChanged: (cb) => on('returned-changed', cb),
  onSourceChanged: (cb) => on('source-changed', cb as never),
  capture: (rect) => ipcRenderer.invoke('capture-rect', rect),
  siteSnapshot: (guestId) => ipcRenderer.invoke('site-snapshot', guestId),
  termStart: (o) => ipcRenderer.invoke('term-start', o),
  termWrite: (d) => ipcRenderer.send('term-write', d),
  termResize: (o) => ipcRenderer.send('term-resize', o),
  termKill: () => ipcRenderer.send('term-kill'),
  onTermData: (cb) => on('term-data', cb as never),
  onTermExit: (cb) => on('term-exit', cb as never),
  formatDoc: () => ipcRenderer.invoke('format-doc'),
  onWorkspaceChanged: (cb) => on('workspace-changed', cb as never),
  openScreenWindow: (o) => ipcRenderer.invoke('open-screen-window', o),
  onScreenWindowClosed: (cb) => on('screen-window-closed', cb),
  toggleDevTools: () => ipcRenderer.send('toggle-devtools'),
  onMenu: (cb) => on('menu', cb as never),
  setState: (s) => ipcRenderer.send('set-state', s),
  onRequestSave: (cb) => on('request-save', cb),
  closeNow: () => ipcRenderer.send('close-now'),
};

contextBridge.exposeInMainWorld('bethlehem', api);
