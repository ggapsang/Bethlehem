/* Bethlehem 세션 — 작업 파일(= 테라리움 문서 HTML) 열기·새로 만들기·화면 등록·URL 담기 */
import { signal } from '@preact/signals';
import type { EncodedBlob, MannaDoc, Screen, ScreenVersion } from '@core';
import { isManna, latest, newDoc, nextScreenId, now, parseManna } from '@core';
import type { Host } from '@manna/host';
import { save } from '@manna/host';
import { addBlobs, dirty, doc, loadDocument, mutate, notify, screenId, selectScreen, user } from '@manna/store';
import type { RecentItem } from '../../shared/api';

const api = window.bethlehem;

export const filePath = signal<string | null>(null);
export const recent = signal<{ files: RecentItem[]; folders: RecentItem[] }>({ files: [], folders: [] });

export async function refreshRecent(): Promise<void> {
  recent.value = await api.recent().catch(() => ({ files: [], folders: [] }));
}

/** 화면 등록 대화상자 — 새 화면이거나 기존 화면의 새 버전 */
export type ImportTarget = { dir: string; screenId?: string };
export const importing = signal<ImportTarget | null>(null);
/** URL 담기 대화상자 */
export const urlAsk = signal<{ screenId?: string } | null>(null);

const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;
const clean = (m: string) => m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export const host: Host = {
  kind: 'bethlehem',
  author: true,
  runtime: () => api.runtime(),
  async write(html, suggestedName, saveAs) {
    const p = await api.saveFile({ html, path: filePath.value, suggestedName, saveAs });
    if (!p) return null;
    filePath.value = p;
    refreshRecent();
    return basename(p);
  },
};

function confirmDiscard(): boolean {
  return !dirty.value || confirm('저장하지 않은 변경이 있습니다. 버리고 계속할까요?');
}

export function newDocument(): void {
  if (!confirmDiscard()) return;
  loadDocument(newDoc(), new Map(), null);
  filePath.value = null;
}

export function openHtml(path: string, name: string, html: string): void {
  if (!isManna(html)) {
    notify(`${name} 은 테라리움 문서가 아닙니다. 화면으로 등록하려면 그 파일이 든 폴더를 창에 끌어다 놓으세요.`, 'error');
    return;
  }
  const { doc: d, blobs } = parseManna(html);
  loadDocument(d, blobs, name);
  filePath.value = path;
  refreshRecent();
}

export async function openDocument(path?: string): Promise<void> {
  if (!confirmDiscard()) return;
  try {
    const f = path ? await api.openPath(path) : await api.openFile();
    if (f) openHtml(f.path, f.name, f.html);
  } catch (e) {
    notify(`문서를 열지 못했습니다: ${clean((e as Error).message)}`, 'error');
  }
}

export async function addScreenFromFolder(screenId?: string, folder?: string): Promise<void> {
  try {
    const dir = folder ? await api.useFolder(folder) : await api.pickFolder();
    if (dir) importing.value = { dir, screenId };
    refreshRecent();
  } catch (e) {
    notify(clean((e as Error).message), 'error');
  }
}

/** 창에 끌어다 놓은 것 — 폴더면 화면 등록, .html 이면 문서 열기 */
export async function handleDrop(files: FileList): Promise<void> {
  const file = files[0];
  if (!file) return;
  const g = await api.grantDropped(file);
  if (!g) return notify('끌어다 놓은 항목의 경로를 알 수 없습니다.', 'error');
  if (g.isDir) {
    importing.value = { dir: g.path, screenId: undefined };
    refreshRecent();
  } else if (/\.html?$/i.test(g.name)) {
    await openDocument(g.path);
  } else {
    notify('화면 폴더(index.html 이 든 폴더)나 테라리움 문서(.terr.html)를 끌어다 놓아 주세요.', 'error');
  }
}

export interface Imported {
  version: Omit<ScreenVersion, 'v' | 'createdAt'>;
  blobs: [string, EncodedBlob][];
  notes?: string;
}

export interface ImportChoice {
  title: string;
  label?: string;
  moveAnnotations: boolean;
}

/** 패키징·URL 담기 결과를 문서에 넣는다 */
export function applyImport(targetId: string | undefined, r: Imported, choice: ImportChoice): void {
  addBlobs(r.blobs);
  let id = targetId;
  let v = 1;
  mutate((d: MannaDoc) => {
    const t = now();
    const existing = id ? d.screens.find((s) => s.id === id) : undefined;
    const version = { createdAt: t, ...(choice.label ? { label: choice.label } : {}), ...r.version };
    if (existing) {
      v = latest(existing).v + 1;
      existing.versions.push({ v, ...version });
      if (r.notes != null) existing.notes = r.notes;
      existing.title = choice.title || existing.title;
      if (choice.moveAnnotations) {
        for (const a of existing.annotations) {
          if (a.version === v - 1) {
            a.history.push({ at: t, by: user.value ?? '', field: 'version', from: a.version, to: v });
            a.version = v;
          }
        }
      }
    } else {
      id = nextScreenId(d);
      const s: Screen = { id, title: choice.title, notes: r.notes ?? '', versions: [{ v, ...version }], annotations: [] };
      d.screens.push(s);
      if (d.screens.length === 1 && d.meta.title === '새 화면정의서') d.meta.title = `${choice.title} 화면정의서`;
    }
    d.changelog.push({ version: d.meta.version, date: t, author: user.value ?? '', note: existing ? `${id} v${v} 추가` : `${id} 등록` });
  }, { label: targetId ? '새 버전 등록' : '화면 등록' });
  selectScreen(id!, v);
}

export function removeScreen(id: string): void {
  const s = doc.value.screens.find((x) => x.id === id);
  if (!s || !confirm(`${s.id} ${s.title} 을 문서에서 지울까요? Comment ${s.annotations.length}개도 함께 지워집니다. (Ctrl+Z 로 되돌릴 수 있습니다)`)) return;
  mutate((d) => (d.screens = d.screens.filter((x) => x.id !== id)), { label: '화면 삭제' });
  const first = doc.value.screens[0];
  if (first) selectScreen(first.id);
  else screenId.value = null;
}

export function startSnapshot(url: string, targetId?: string): void {
  api.openSnapshot({ url: url || undefined, screenId: targetId });
}

api.onSnapshot(({ screenId: target, result }) => {
  if (!result) return;
  const existing = target ? doc.value.screens.find((s) => s.id === target) : undefined;
  applyImport(target, result, {
    title: existing?.title ?? result.title,
    label: `${result.version.source?.mode === 'live' ? '동작 포함' : '보이는 그대로'} · ${new URL(result.version.entry).host}`,
    moveAnnotations: true,
  });
  notify(`URL 화면을 담았습니다 — 응답 ${result.stats.files}개`);
});

api.onRequestSave(async () => {
  if (await save(host)) api.closeNow();
});

refreshRecent();
