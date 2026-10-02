/* 문서를 품은 쪽 — 브라우저(Manna)인지 Bethlehem 인지에 따라 저장 방식이 다르다 (docs/ARCHITECTURE.md §7.1) */
import type { Runtime } from '@core';
import { serializeManna } from '@core';
import { blobs, dirty, doc, fileName, notify, user } from './store';

export interface Host {
  kind: 'manna' | 'bethlehem';
  /** 작성자 권한 — 번호 부여, 문서 정보 편집, 남의 항목 삭제 */
  author: boolean;
  runtime(): Promise<Runtime>;
  /** 저장. 저장한 파일 이름을 돌려주고, 취소하면 null */
  write(html: string, suggestedName: string, saveAs: boolean): Promise<string | null>;
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

export async function save(host: Host, saveAs = false): Promise<boolean> {
  try {
    const d = doc.value;
    if (host.kind === 'manna' && user.value) d.origin = { by: user.value, at: new Date().toISOString(), baseUpdatedAt: d.origin?.baseUpdatedAt ?? d.meta.updatedAt };
    const html = serializeManna(d, blobs, await host.runtime());
    const name = await host.write(html, suggestedName(host), saveAs);
    if (!name) return false;
    fileName.value = name;
    dirty.value = false;
    notify(`저장했습니다 — ${name}`);
    return true;
  } catch (e) {
    notify(`저장하지 못했습니다: ${(e as Error).message}`, 'error');
    return false;
  }
}

/* ── 브라우저에서 연 Manna ─────────────────────────────────────────────── */

type SaveHandle = { name: string; createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> };
type Picker = (o: object) => Promise<SaveHandle>;

let handle: SaveHandle | null = null;

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

export const browserHost: Host = {
  kind: 'manna',
  author: false,
  async runtime() {
    return {
      js: document.getElementById('manna-runtime')?.textContent ?? '',
      css: document.getElementById('manna-style')?.textContent ?? '',
    };
  },
  async write(html, name, saveAs) {
    const picker = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker;
    if (picker) {
      try {
        if (!handle || saveAs) {
          handle = await picker({ suggestedName: name, types: [{ description: '테라리움 문서', accept: { 'text/html': ['.html'] } }] });
        }
        const w = await handle.createWritable();
        await w.write(html);
        await w.close();
        return handle.name;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return null;
        handle = null; // 권한이 막혔으면 다운로드로 넘어간다
      }
    }
    download(html, name);
    return name;
  },
};
