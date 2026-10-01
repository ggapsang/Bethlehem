/* 렌더러에 노출할 최소 API (contextIsolation · sandbox) */
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { BethlehemApi } from '../shared/api';

const api: BethlehemApi = {
  runtime: () => ipcRenderer.invoke('runtime'),
  openFile: () => ipcRenderer.invoke('open-file'),
  openPath: (path) => ipcRenderer.invoke('open-path', path),
  saveFile: (o) => ipcRenderer.invoke('save-file', o),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  grantDropped: async (file) => {
    const path = webUtils.getPathForFile(file);
    return path ? ipcRenderer.invoke('grant-dropped', path) : null;
  },
  scanFolder: (dir, entry) => ipcRenderer.invoke('scan-folder', dir, entry),
  packFolder: (opts) => ipcRenderer.invoke('pack-folder', opts),
  setState: (s) => ipcRenderer.send('set-state', s),
  onRequestSave: (cb) => {
    ipcRenderer.removeAllListeners('request-save');
    ipcRenderer.on('request-save', () => cb());
  },
  closeNow: () => ipcRenderer.send('close-now'),
};

contextBridge.exposeInMainWorld('bethlehem', api);
