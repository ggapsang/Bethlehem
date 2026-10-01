/* Bethlehem 세션 — 작업 파일(= Manna HTML) 열기·새로 만들기·화면 등록 */
import { signal } from '@preact/signals';
import type { MannaDoc, Screen, Viewport } from '@core';
import { isManna, latest, newDoc, nextScreenId, now, parseManna } from '@core';
import type { PackResult } from '@core/node/pack';
import type { Host } from '@manna/host';
import { save } from '@manna/host';
import { addBlobs, dirty, doc, fileName, loadDocument, mutate, notify, screenId, selectScreen, user } from '@manna/store';

const api = window.bethlehem;

export const filePath = signal<string | null>(null);

/** 화면 등록 대화상자 — 새 화면이거나 기존 화면의 새 버전 */
export type ImportTarget = { dir: string; screenId?: string };
export const importing = signal<ImportTarget | null>(null);

const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;

export const host: Host = {
  kind: 'bethlehem',
  author: true,
  runtime: () => api.runtime(),
  async write(html, suggestedName, saveAs) {
    const p = await api.saveFile({ html, path: filePath.value, suggestedName, saveAs });
    if (!p) return null;
    filePath.value = p;
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
    notify(`${name} 은 Manna 문서가 아닙니다. 화면으로 등록하려면 그 파일이 든 폴더를 창에 끌어다 놓으세요.`, 'error');
    return;
  }
  const { doc: d, blobs } = parseManna(html);
  loadDocument(d, blobs, name);
  filePath.value = path;
  notify(`${name} 을 열었습니다 — 화면 ${d.screens.length}개`);
}

export async function openDocument(): Promise<void> {
  if (!confirmDiscard()) return;
  try {
    const f = await api.openFile();
    if (f) openHtml(f.path, f.name, f.html);
  } catch (e) {
    notify(`문서를 열지 못했습니다: ${(e as Error).message}`, 'error');
  }
}

export async function addScreenFromPicker(screenId?: string): Promise<void> {
  const dir = await api.pickFolder();
  if (dir) importing.value = { dir, screenId };
}

/** 창에 끌어다 놓은 것 — 폴더면 화면 등록, .html 이면 문서 열기 */
export async function handleDrop(files: FileList): Promise<void> {
  const file = files[0];
  if (!file) return;
  const g = await api.grantDropped(file);
  if (!g) return notify('끌어다 놓은 항목의 경로를 알 수 없습니다.', 'error');
  if (g.isDir) {
    importing.value = { dir: g.path };
  } else if (/\.html?$/i.test(g.name)) {
    if (!confirmDiscard()) return;
    const f = await api.openPath(g.path);
    openHtml(f.path, f.name, f.html);
  } else {
    notify('화면 폴더(index.html 이 든 폴더)나 Manna 문서(.html)를 끌어다 놓아 주세요.', 'error');
  }
}

export interface ImportChoice {
  title: string;
  label?: string;
  viewport: Viewport;
  moveAnnotations: boolean;
}

/** 패키징 결과를 문서에 넣는다 */
export function applyImport(target: ImportTarget, r: PackResult, choice: ImportChoice): void {
  addBlobs(r.blobs);
  let id = target.screenId;
  let v = 1;
  mutate((d: MannaDoc) => {
    const t = now();
    const existing = id ? d.screens.find((s) => s.id === id) : undefined;
    if (existing) {
      v = latest(existing).v + 1;
      existing.versions.push({ v, createdAt: t, ...(choice.label ? { label: choice.label } : {}), ...r.version });
      if (r.description) existing.description = r.description;
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
      const s: Screen = {
        id,
        title: choice.title,
        ...(r.description ? { description: r.description } : {}),
        versions: [{ v, createdAt: t, ...(choice.label ? { label: choice.label } : {}), ...r.version }],
        annotations: [],
      };
      d.screens.push(s);
      if (d.screens.length === 1 && d.meta.title === '새 화면정의서') d.meta.title = `${choice.title} 화면정의서`;
    }
    d.changelog.push({ version: d.meta.version, date: t, author: user.value ?? '', note: existing ? `${id} v${v} 추가` : `${id} 등록` });
  });
  selectScreen(id!, v);
  if (doc.value.screens.length === 1 && !fileName.value) notify('화면을 등록했습니다. Ctrl+S 로 Manna 문서로 저장하세요.');
}

export function removeScreen(id: string): void {
  const s = doc.value.screens.find((x) => x.id === id);
  if (!s || !confirm(`${s.id} ${s.title} 을 문서에서 지울까요? 어노테이션 ${s.annotations.length}개도 함께 지워집니다.`)) return;
  mutate((d) => (d.screens = d.screens.filter((x) => x.id !== id)));
  const first = doc.value.screens[0];
  if (first) selectScreen(first.id);
  else screenId.value = null;
}

api.onRequestSave(async () => {
  if (await save(host)) api.closeNow();
});
