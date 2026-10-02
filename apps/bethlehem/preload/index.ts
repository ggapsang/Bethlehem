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
  pickImage: () => ipcRenderer.invoke('pick-image'),
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
  setState: (s) => ipcRenderer.send('set-state', s),
  onRequestSave: (cb) => on('request-save', cb),
  closeNow: () => ipcRenderer.send('close-now'),
};

contextBridge.exposeInMainWorld('bethlehem', api);
