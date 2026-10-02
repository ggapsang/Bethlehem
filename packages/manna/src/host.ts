/* 문서를 품은 쪽 — 브라우저(받은 문서)인지 Bethlehem 인지에 따라 저장 방식이 다르다 (docs/ARCHITECTURE.md §8)
 * 저장은 둘 다 "라이브 문서"다 — 고치면 잠시 뒤 자동으로 저장된다. 저장 버튼은 지금 바로, 다른 이름으로는 사본.
 */
import type { EncodedBlob, ExternalEntry, MannaDoc, Runtime } from '@core';
import { referencedShas, serializeManna, mergeDoc } from '@core';
import { idbGet, idbPut } from './idb';
import { blobs, dirty, doc, fileName, notify, rev, saveState, user, screenId } from './store';

export interface SiteSnap {
  entry: string;
  external: ExternalEntry[];
  blobs: [string, EncodedBlob][];
}

export interface Host {
  kind: 'manna' | 'bethlehem';
  /** 작성자 권한 — 문서 정보 편집, 남의 항목 삭제 */
  author: boolean;
  runtime(): Promise<Runtime>;
  /** 사용자가 누른 저장. saveAs 면 다른 이름으로 */
  save(saveAs: boolean): Promise<boolean>;
  /** 고친 뒤 잠시 후 자동으로 불린다 */
  autosave(): Promise<void>;
  /** 창 안의 영역을 그림으로 (Bethlehem: capturePage). 없으면 피커 멈춤 그림과 Comment shot 이 없다 */
  capture?(rect: { x: number; y: number; width: number; height: number }): Promise<{ bytes: Uint8Array; w: number; h: number } | null>;
  /** URL 화면을 실시간으로 띄울 수 있으면 (Bethlehem 의 webview). 없으면 담아 둔 사본을 띄운다 */
  site?: { partition: string };
  /** 실시간 사이트의 지금 모습을 보낸 파일용 사본으로 */
  snapshotSite?(guestId: number): Promise<SiteSnap | null>;
  /** 따로 내보내기 — 지금 문서와 상관없는 새 파일로 (현재 탭만 저장). 없으면 브라우저 저장 대화상자나 다운로드 */
  exportFile?(html: string, suggestedName: string): Promise<string | null>;
}

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim();

/** 테라리움 문서 확장자 — 브라우저가 바로 여는 .html 앞에 .terr 를 붙인다 */
export const EXT = '.terr.html';
const HTML_EXT = /(\.terr)?\.html?$/i;

export function withExt(name: string): string {
  return name.replace(HTML_EXT, '') + EXT;
}

export function suggestedName(host: Host): string {
  const d = doc.value;
  const base = `${safe(d.meta.title)}_v${safe(d.meta.version)}`;
  if (host.kind === 'manna') {
    // 받은 문서는 원래 이름 뒤에 내 이름을 붙여 돌려보낸다
    const from = fileName.value ? fileName.value.replace(HTML_EXT, '') : base;
    return user.value && !from.endsWith(`_${safe(user.value)}`) ? `${from}_${safe(user.value)}${EXT}` : `${from}${EXT}`;
  }
  return fileName.value ? withExt(fileName.value) : `${base}${EXT}`;
}

export async function buildHtml(host: Host, only?: string[]): Promise<string> {
  const d = doc.value;
  if (host.kind === 'manna' && user.value) d.origin = { by: user.value, at: new Date().toISOString(), baseUpdatedAt: d.origin?.baseUpdatedAt ?? d.meta.updatedAt };
  // 일부 화면만 — 문서 id 는 그대로 둔다 (받은 사람이 돌려보내면 원래 문서에 그대로 합쳐진다). 그 화면이 쓰는 블롭만 담긴다
  const out = only ? { ...d, screens: d.screens.filter((s) => only.includes(s.id)) } : d;
  return serializeManna(out, blobs, await host.runtime());
}

/** 현재 탭만 저장 — 지금 화면 하나(모든 버전 · Comment · 자유 노트)를 새 파일로. 지금 문서의 저장 위치는 바꾸지 않는다 */
export async function saveScreenOnly(host: Host): Promise<boolean> {
  const s = doc.peek().screens.find((x) => x.id === screenId.peek());
  if (!s) return false;
  try {
    const html = await buildHtml(host, [s.id]);
    const name = `${safe(doc.peek().meta.title)}_${s.id}_${safe(s.title)}${EXT}`;
    let where: string | null;
    if (host.exportFile) where = await host.exportFile(html, name);
    else {
      const pick = picker();
      if (pick) {
        try {
          const h = await pick({ suggestedName: name, types: [{ description: '테라리움 문서', accept: { 'text/html': ['.html'] } }] });
          await writeHandle(h, html);
          where = h.name;
        } catch (e) {
          if ((e as Error).name === 'AbortError') return false;
          download(html, name);
          where = name;
        }
      } else {
        download(html, name);
        where = name;
      }
    }
    if (!where) return false;
    notify(`현재 탭(${s.id} ${s.title})만 저장했습니다 — ${where.split(/[\\/]/).pop()}`);
    return true;
  } catch (e) {
    notify(`저장하지 못했습니다: ${(e as Error).message}`, 'error');
    return false;
  }
}

/** 사용자가 누른 저장 — 결과를 알린다 */
export async function save(host: Host, saveAs = false): Promise<boolean> {
  try {
    const ok = await host.save(saveAs);
    return ok;
  } catch (e) {
    saveState.value = { kind: 'error', message: (e as Error).message };
    notify(`저장하지 못했습니다: ${(e as Error).message}`, 'error');
    return false;
  }
}

/** 자동 저장 — 고친 뒤 조용해지면 (App 이 rev 를 보고 부른다) */
let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | null = null;
export function scheduleAutosave(host: Host, delay = 1200): void {
  clearTimeout(timer);
  saveState.value = { ...saveState.value, kind: 'pending' };
  timer = setTimeout(() => flushAutosave(host), delay);
}
export async function flushAutosave(host: Host): Promise<void> {
  clearTimeout(timer);
  if (running) await running;
  if (!dirty.peek()) return;
  const at = rev.peek();
  running = (async () => {
    try {
      saveState.value = { ...saveState.value, kind: 'saving' };
      await host.autosave();
      if (rev.peek() === at) dirty.value = false;
    } catch (e) {
      saveState.value = { kind: 'error', message: (e as Error).message };
    } finally {
      running = null;
    }
  })();
  await running;
}

/* ── 브라우저에서 연 문서 ─────────────────────────────────────────────
 * 브라우저는 열린 파일에 마음대로 쓸 수 없다. 그래서
 *   1) 고칠 때마다 이 브라우저의 저장소(IndexedDB)에 초안을 남긴다 — 다시 열면 이어진다.
 *   2) 파일을 한 번 지정하면(Chrome·Edge) 그 뒤로는 그 파일에도 자동으로 쓴다. 핸들도 기억해 다음에는 허용만 누르면 된다.
 */
type Writable = { write(d: string): Promise<void>; close(): Promise<void> };
type FileHandle = {
  name: string;
  createWritable(): Promise<Writable>;
  queryPermission?(o: object): Promise<string>;
  requestPermission?(o: object): Promise<string>;
};
type Picker = (o: object) => Promise<FileHandle>;

let handle: FileHandle | null = null;
let baseShas = new Set<string>();

function download(html: string, name: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const picker = () => (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker;

async function writeHandle(h: FileHandle, html: string): Promise<void> {
  const w = await h.createWritable();
  await w.write(html);
  await w.close();
}

interface Draft {
  doc: MannaDoc;
  blobs: [string, EncodedBlob][];
  savedAt: string;
  /** 이 초안을 시작한 파일의 판(meta.updatedAt) — 작성자가 새 판을 보내면 다르다 */
  base?: string;
}

/** 지금 연 파일의 판 */
let fileBase = '';

/** 문서를 열 때 — 이 브라우저에 더 새 초안이 있으면 이어서, 기억한 파일 핸들이 있으면 다시 쓴다 */
export async function browserResume(apply: (d: MannaDoc, extra: [string, EncodedBlob][]) => void): Promise<void> {
  baseShas = new Set(blobs.keys());
  const d = doc.peek();
  fileBase = d.meta.updatedAt;
  const draft = await idbGet<Draft>('drafts', d.id);
  if (draft && draft.base === d.meta.updatedAt) {
    // 같은 파일을 다시 열었다 — 이 브라우저에서 하던 것을 이어서
    if (draft.doc.meta.updatedAt > d.meta.updatedAt) {
      apply(draft.doc, draft.blobs);
      notify(`이 브라우저에 남아 있던 변경(${new Date(draft.savedAt).toLocaleString('ko-KR')})을 이어서 엽니다.`);
    }
  } else if (draft) {
    // 다른 판의 파일이다(작성자가 새로 보냈다) — 파일을 그대로 열고, 이 브라우저에서 단 것만 그 위에 합친다.
    // 예전 초안이 새 판을 덮으면 새 화면 · 새 Comment 가 사라진다
    const merged: MannaDoc = JSON.parse(JSON.stringify(d));
    const mine: MannaDoc = JSON.parse(JSON.stringify(draft.doc));
    mine.origin = { by: user.peek() ?? mine.origin?.by ?? '수신자', at: draft.savedAt, baseUpdatedAt: draft.base ?? draft.savedAt };
    const r = mergeDoc(merged, mine, blobs, new Map(draft.blobs));
    const n = r.added + r.updated + r.replies + r.clips;
    if (n > 0) {
      apply(merged, draft.blobs);
      notify(`새 판을 열고, 이 브라우저에서 예전 판에 단 것(Comment ${r.added} · 고침 ${r.updated} · 답글 ${r.replies})을 합쳤습니다.`);
    }
  }
  const h = await idbGet<FileHandle>('handles', d.id);
  if (h) {
    const perm = await h.queryPermission?.({ mode: 'readwrite' }).catch(() => 'denied');
    if (perm === 'granted') handle = h;
    else {
      handle = null;
      pendingHandle = h;
    }
  }
  saveState.value = { kind: handle ? 'saved' : 'local', where: handle?.name };
}

let pendingHandle: FileHandle | null = null;

/** 저장 상태 표시의 "파일에도 저장" — 사용자가 누를 때만 권한을 물을 수 있다 */
export async function connectFile(): Promise<void> {
  if (pendingHandle?.requestPermission) {
    const perm = await pendingHandle.requestPermission({ mode: 'readwrite' }).catch(() => 'denied');
    if (perm === 'granted') {
      handle = pendingHandle;
      pendingHandle = null;
      dirty.value = true;
      await browserHost.autosave();
      return;
    }
  }
  await browserHost.save(true);
}

export function canConnectFile(): boolean {
  return !!picker();
}

export const browserHost: Host = {
  kind: 'manna',
  author: false,
  async runtime() {
    return {
      js: document.getElementById('manna-runtime')?.textContent ?? '',
      css: document.getElementById('manna-style')?.textContent ?? '',
    };
  },
  async autosave() {
    const d = doc.peek();
    const used = referencedShas(d);
    const extra = [...blobs].filter(([sha]) => !baseShas.has(sha) && used.has(sha));
    await idbPut('drafts', d.id, { doc: JSON.parse(JSON.stringify(d)), blobs: extra, savedAt: new Date().toISOString(), base: fileBase } satisfies Draft);
    if (handle) {
      await writeHandle(handle, await buildHtml(browserHost));
      saveState.value = { kind: 'saved', where: handle.name, at: Date.now() };
    } else {
      saveState.value = { kind: 'local', at: Date.now() };
    }
  },
  async save(saveAs) {
    const html = await buildHtml(browserHost);
    const name = suggestedName(browserHost);
    const pick = picker();
    if (pick) {
      try {
        if (!handle || saveAs) {
          const h = await pick({ suggestedName: name, types: [{ description: '테라리움 문서', accept: { 'text/html': ['.html'] } }] });
          handle = h;
          await idbPut('handles', doc.peek().id, h);
        }
        await writeHandle(handle, html);
        fileName.value = handle.name;
        dirty.value = false;
        saveState.value = { kind: 'saved', where: handle.name, at: Date.now() };
        notify(`저장했습니다 — ${handle.name}. 이제부터 이 파일에 자동으로 저장됩니다.`);
        return true;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return false;
        handle = null; // 권한이 막혔으면 다운로드로 넘어간다
      }
    }
    download(html, name);
    fileName.value = name;
    dirty.value = false;
    saveState.value = { kind: 'local', where: name, at: Date.now() };
    notify(`내려받았습니다 — ${name}`);
    return true;
  },
};
