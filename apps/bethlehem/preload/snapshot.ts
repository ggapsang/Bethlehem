/* URL 담기 창의 위쪽 막대 전용 API */
import { contextBridge, ipcRenderer } from 'electron';

export interface SnapState {
  url: string;
  title: string;
  loading: boolean;
  canBack: boolean;
  canForward: boolean;
  count: number;
  bytes: number;
  vp: { w: number; h: number };
}

const snap = {
  go: (url: string) => ipcRenderer.send('snap:go', url),
  nav: (what: 'back' | 'forward' | 'reload') => ipcRenderer.send('snap:nav', what),
  viewport: (w: number, h: number) => ipcRenderer.send('snap:viewport', { w, h }),
  capture: (mode: 'live' | 'static'): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('snap:capture', mode),
  cancel: () => ipcRenderer.send('snap:cancel'),
  onState: (cb: (s: SnapState) => void) => ipcRenderer.on('snap:state', (_e, s) => cb(s)),
  onPrefill: (cb: (url: string) => void) => ipcRenderer.on('snap:prefill', (_e, u) => cb(u)),
};

export type SnapApi = typeof snap;
contextBridge.exposeInMainWorld('snap', snap);
