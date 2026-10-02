/* URL 로 화면 담기 — docs/ARCHITECTURE.md §5.5
 *
 * 별도 창에 페이지를 띄운다. 사용자는 거기서 로그인하거나 원하는 상태까지 이동한 뒤 담는다.
 * 창이 받은 응답(GET)은 CDP Network 로 모두 적어 두었다가, 담을 때 문서의 외부 리소스로 넣는다.
 *   live   — 원래 HTML + 받은 응답 전부. 스크립트가 다시 돌고, 그때 받은 API 응답이 그대로 재생된다.
 *   static — 지금 보이는 DOM 을 직렬화(스크립트 제거, 캔버스는 이미지로). 정지 화면이지만 보이는 그대로다.
 */
import { BaseWindow, WebContentsView, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { encFor, typeFor } from '@core';
import { toUtf8 } from '@core/node/charset';
import type { EncodedBlob, ExternalEntry, ScreenVersion } from '@core';

const BAR_H = 56;
const MAX_TOTAL = 150 * 1024 * 1024;
const MAX_ONE = 40 * 1024 * 1024;

export interface SnapshotResult {
  title: string;
  version: Omit<ScreenVersion, 'v' | 'createdAt'>;
  blobs: [string, EncodedBlob][];
  stats: { files: number; raw: number; encoded: number };
}

interface Captured {
  url: string;
  type: string;
  resourceType: string;
  bytes: Uint8Array;
}

interface Options {
  url?: string;
  preload: string;
  barUrl: string;
  icon?: string;
  onDone(r: SnapshotResult | null): void;
}

let open: { win: BaseWindow } | null = null;

function blobOf(bytes: Uint8Array, type: string): { sha: string; blob: EncodedBlob } {
  const sha = createHash('sha256').update(bytes).digest('hex');
  const enc = encFor(type);
  return { sha, blob: { enc, data: Buffer.from(enc === 'gz64' ? gzipSync(bytes, { level: 9 }) : bytes).toString('base64') } };
}

/* 페이지 안에서 돌아가는 직렬화 — 지금 보이는 DOM 을 HTML 로 */
const SERIALIZE = `(() => {
  const live = Array.from(document.querySelectorAll('canvas'));
  const shots = live.map((c) => { try { return c.toDataURL('image/png'); } catch (e) { return null; } });
  const inputs = Array.from(document.querySelectorAll('input, textarea, select'));
  const clone = document.documentElement.cloneNode(true);
  Array.from(clone.querySelectorAll('canvas')).forEach((c, i) => {
    if (!shots[i]) return;
    const img = document.createElement('img');
    img.src = shots[i];
    img.setAttribute('style', (live[i].getAttribute('style') || '') + ';width:' + live[i].clientWidth + 'px;height:' + live[i].clientHeight + 'px');
    if (live[i].className) img.className = live[i].className;
    if (live[i].id) img.id = live[i].id;
    c.replaceWith(img);
  });
  Array.from(clone.querySelectorAll('input, textarea, select')).forEach((el, i) => {
    const src = inputs[i];
    if (!src) return;
    if (el.tagName === 'TEXTAREA') el.textContent = src.value;
    else if (el.tagName === 'SELECT') Array.from(el.options).forEach((o, k) => o.toggleAttribute('selected', src.options[k] && src.options[k].selected));
    else if (src.type === 'checkbox' || src.type === 'radio') el.toggleAttribute('checked', src.checked);
    else el.setAttribute('value', src.value);
  });
  // CSS-in-JS 처럼 insertRule 로만 들어간 규칙은 <style> 텍스트에 없다 — 규칙을 글로 옮긴다
  const liveStyles = Array.from(document.querySelectorAll('style'));
  Array.from(clone.querySelectorAll('style')).forEach((s, i) => {
    const sheet = liveStyles[i] && liveStyles[i].sheet;
    if (!sheet) return;
    try { const rules = Array.from(sheet.cssRules).map((r) => r.cssText).join('\\n'); if (rules.length > (s.textContent || '').length) s.textContent = rules; } catch (e) {}
  });
  if (document.adoptedStyleSheets && document.adoptedStyleSheets.length) {
    const st = document.createElement('style');
    st.textContent = document.adoptedStyleSheets.map((sh) => Array.from(sh.cssRules).map((r) => r.cssText).join('\\n')).join('\\n');
    clone.querySelector('head').appendChild(st);
  }
  clone.querySelectorAll('script, noscript').forEach((s) => s.remove());
  clone.querySelectorAll('*').forEach((el) => Array.from(el.attributes).forEach((a) => { if (/^on/i.test(a.name)) el.removeAttribute(a.name); }));
  return '<!DOCTYPE html>' + clone.outerHTML;
})()`;

export function openSnapshot(o: Options): void {
  if (open) {
    open.win.focus();
    return;
  }
  const win = new BaseWindow({ width: 1500, height: 960, title: '테라리움 — URL 로 화면 담기', icon: o.icon, backgroundColor: '#FFFFFF' });
  const bar = new WebContentsView({ webPreferences: { preload: o.preload, sandbox: true, contextIsolation: true } });
  const page = new WebContentsView({ webPreferences: { partition: 'persist:terrarium-snapshot', sandbox: true, contextIsolation: true } });
  win.contentView.addChildView(page);
  win.contentView.addChildView(bar);
  open = { win };

  let vp = { w: 1920, h: 1080 };
  const layout = () => {
    const { width, height } = win.getContentBounds();
    bar.setBounds({ x: 0, y: 0, width, height: BAR_H });
    const aw = width;
    const ah = height - BAR_H;
    const z = Math.min(aw / vp.w, ah / vp.h, 1);
    const w = Math.round(vp.w * z);
    const h = Math.round(vp.h * z);
    page.setBounds({ x: Math.round((aw - w) / 2), y: BAR_H + Math.round((ah - h) / 2), width: w, height: h });
    page.webContents.setZoomFactor(z);
  };
  win.on('resize', layout);
  page.webContents.on('did-finish-load', layout);
  layout();

  /* ── 응답 기록 ──────────────────────────────────────────────────── */
  const dbg = page.webContents.debugger;
  const meta = new Map<string, { url: string; type: string; charset?: string; resourceType: string; method: string; ok: boolean }>();
  let captured = new Map<string, Captured>();
  let topFrame = '';
  let docUrl = '';
  let total = 0;

  const sendState = () => {
    if (bar.webContents.isDestroyed()) return;
    bar.webContents.send('snap:state', {
      url: page.webContents.getURL(),
      title: page.webContents.getTitle(),
      loading: page.webContents.isLoading(),
      canBack: page.webContents.navigationHistory.canGoBack(),
      canForward: page.webContents.navigationHistory.canGoForward(),
      count: captured.size,
      bytes: total,
      vp,
    });
  };

  try {
    dbg.attach('1.3');
  } catch {
    /* 이미 붙어 있음 */
  }
  // 기록을 켠 뒤에 페이지를 연다 — 먼저 열면 첫 문서와 앞쪽 요청을 놓친다.
  // 아무것도 띄우지 않은 webContents 에는 CDP 명령이 답하지 않으므로 빈 페이지를 먼저 연다
  const withTimeout = <T,>(p: Promise<T>) => Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
  const ready = (async () => {
    await page.webContents.loadURL('about:blank').catch(() => {});
    await withTimeout(dbg.sendCommand('Network.enable', { maxTotalBufferSize: 200_000_000, maxResourceBufferSize: 50_000_000 })).catch(() => {});
    await withTimeout(dbg.sendCommand('Network.setCacheDisabled', { cacheDisabled: true })).catch(() => {});
    const tree = (await withTimeout(dbg.sendCommand('Page.getFrameTree')).catch(() => null)) as { frameTree: { frame: { id: string } } } | null;
    if (tree) topFrame = tree.frameTree.frame.id;
  })();

  dbg.on('message', async (_e, method: string, p: Record<string, any>) => {
    if (method === 'Network.requestWillBeSent') {
      if (p.type === 'Document' && (!topFrame || p.frameId === topFrame)) {
        // 새 문서로 이동 — 이전 페이지의 응답은 버린다
        captured = new Map();
        total = 0;
        docUrl = p.request.url;
      }
      meta.set(p.requestId, { url: p.request.url, type: '', resourceType: p.type, method: p.request.method, ok: false });
    } else if (method === 'Network.responseReceived') {
      const m = meta.get(p.requestId);
      if (!m) return;
      m.url = p.response.url;
      m.type = String(p.response.mimeType || '').split(';')[0];
      m.charset = String(p.response.charset || '').toLowerCase();
      m.ok = p.response.status >= 200 && p.response.status < 300;
      if (p.type === 'Document' && (!topFrame || p.frameId === topFrame)) docUrl = p.response.url;
    } else if (method === 'Network.loadingFinished') {
      const m = meta.get(p.requestId);
      meta.delete(p.requestId);
      if (!m || !m.ok || m.method !== 'GET' || !/^https?:/.test(m.url)) return;
      if (p.encodedDataLength > MAX_ONE || total > MAX_TOTAL) return;
      try {
        const r = (await dbg.sendCommand('Network.getResponseBody', { requestId: p.requestId })) as { body: string; base64Encoded: boolean };
        const bytes = r.base64Encoded ? new Uint8Array(Buffer.from(r.body, 'base64')) : new TextEncoder().encode(r.body);
        captured.set(m.url, { url: m.url, type: m.type || typeFor(m.url), resourceType: m.resourceType, bytes: toUtf8(bytes, m.type, m.charset) });
        total += bytes.length;
        sendState();
      } catch {
        /* 본문이 버퍼에서 밀려남 */
      }
    } else if (method === 'Network.loadingFailed') {
      meta.delete(p.requestId);
    }
  });

  page.webContents.on('did-navigate', sendState);
  page.webContents.on('did-navigate-in-page', sendState);
  page.webContents.on('page-title-updated', sendState);
  page.webContents.on('did-start-loading', sendState);
  page.webContents.on('did-stop-loading', sendState);
  page.webContents.setWindowOpenHandler(({ url }) => {
    page.webContents.loadURL(url);
    return { action: 'deny' };
  });

  let finished = false;
  const finish = (r: SnapshotResult | null) => {
    if (finished) return;
    finished = true;
    o.onDone(r);
    if (!win.isDestroyed()) win.close();
  };

  /* ── 막대(bar) ↔ 메인 ─────────────────────────────────────────────── */
  const fromBar = (e: IpcMainEvent | IpcMainInvokeEvent) => e.sender === bar.webContents;
  const go = (_e: IpcMainEvent, raw: string) => {
    if (!fromBar(_e)) return;
    let u = raw.trim();
    if (!u) return;
    if (!/^[a-z]+:\/\//i.test(u)) u = /^(localhost|\d+\.\d+\.\d+\.\d+)(:\d+)?/.test(u) ? `http://${u}` : `https://${u}`;
    ready.then(() => page.webContents.loadURL(u)).catch(() => sendState());
  };
  const nav = (e: IpcMainEvent, what: string) => {
    if (!fromBar(e)) return;
    const h = page.webContents.navigationHistory;
    if (what === 'back' && h.canGoBack()) h.goBack();
    if (what === 'forward' && h.canGoForward()) h.goForward();
    if (what === 'reload') page.webContents.reloadIgnoringCache();
  };
  const setVp = (e: IpcMainEvent, v: { w: number; h: number }) => {
    if (!fromBar(e)) return;
    vp = { w: Math.max(320, Math.round(v.w)), h: Math.max(240, Math.round(v.h)) };
    layout();
    sendState();
  };
  const capture = async (e: IpcMainInvokeEvent, mode: 'live' | 'static') => {
    if (!fromBar(e)) return { ok: false, error: '허용되지 않은 요청' };
    try {
      const r = await build(mode);
      finish(r);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  };
  const cancel = (e: IpcMainEvent) => fromBar(e) && finish(null);

  ipcMain.on('snap:go', go);
  ipcMain.on('snap:nav', nav);
  ipcMain.on('snap:viewport', setVp);
  ipcMain.handle('snap:capture', capture);
  ipcMain.on('snap:cancel', cancel);
  bar.webContents.on('did-finish-load', () => {
    sendState();
    if (o.url) bar.webContents.send('snap:prefill', o.url);
  });

  win.on('closed', () => {
    ipcMain.off('snap:go', go);
    ipcMain.off('snap:nav', nav);
    ipcMain.off('snap:viewport', setVp);
    ipcMain.removeHandler('snap:capture');
    ipcMain.off('snap:cancel', cancel);
    try {
      dbg.detach();
    } catch {
      /* 이미 떨어짐 */
    }
    open = null;
    if (!finished) {
      finished = true;
      o.onDone(null);
    }
  });

  bar.webContents.loadURL(o.barUrl);
  if (o.url) ready.then(() => page.webContents.loadURL(o.url!)).catch(() => {});

  // E2E 전용 — 막대를 누르는 대신 메인 프로세스에서 바로 담는다
  if (process.env.BETHLEHEM_E2E_GRANT) {
    (globalThis as Record<string, unknown>).__terrSnapshot = {
      state: () => ({ url: page.webContents.getURL(), loading: page.webContents.isLoading(), count: captured.size }),
      capture: async (mode: 'live' | 'static') => finish(await build(mode)),
    };
  }

  async function build(mode: 'live' | 'static'): Promise<SnapshotResult> {
    if (page.webContents.getURL() === '' || page.webContents.getURL() === 'about:blank') throw new Error('먼저 주소를 열어 주세요.');
    const entryUrl = docUrl || page.webContents.getURL();
    const doc = captured.get(entryUrl);
    let html: Uint8Array;
    if (mode === 'static') {
      html = new TextEncoder().encode(String(await page.webContents.executeJavaScript(SERIALIZE, true)));
    } else {
      if (!doc) throw new Error('이 페이지의 원본 HTML 을 받지 못했습니다. 새로고침한 뒤 다시 담거나 "보이는 그대로"로 담아 주세요.');
      html = doc.bytes;
    }
    const blobs = new Map<string, EncodedBlob>();
    const external: ExternalEntry[] = [];
    let raw = 0;
    const add = (url: string, bytes: Uint8Array, type: string) => {
      const { sha, blob } = blobOf(bytes, type);
      blobs.set(sha, blob);
      external.push({ url, sha, type, size: bytes.length });
      raw += bytes.length;
    };
    add(entryUrl, html, 'text/html');
    for (const c of captured.values()) {
      if (c.url === entryUrl) continue;
      if (mode === 'static' && /^(Script|XHR|Fetch|EventSource|WebSocket)$/.test(c.resourceType)) continue;
      add(c.url, c.bytes, c.type);
    }
    let encoded = 0;
    for (const b of blobs.values()) encoded += b.data.length;
    return {
      title: page.webContents.getTitle() || new URL(entryUrl).host,
      version: {
        entry: entryUrl,
        source: { url: page.webContents.getURL(), mode, at: new Date().toISOString() },
        viewport: { w: vp.w, h: vp.h, fit: 'contain' },
        files: {},
        external,
      },
      blobs: [...blobs],
      stats: { files: external.length, raw, encoded },
    };
  }
}

export function snapshotPreloadPath(here: string): string {
  return join(here, '../preload/snapshot.cjs');
}
