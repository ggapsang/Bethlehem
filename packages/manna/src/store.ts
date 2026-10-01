/* 화면 상태 — Manna 와 Bethlehem 이 같은 모듈을 공유한다
 * 문서는 제자리에서 고치고 rev 를 올려 다시 그린다. 문서 객체가 그대로 저장 대상이기 때문이다.
 */
import { computed, signal } from '@preact/signals';
import type { BlobStore, MannaDoc, Region } from '@core';
import { latest, newDoc, now } from '@core';

export type Mode = 'view' | 'annotate';
export type Theme = 'light' | 'dark';

export interface Draft {
  el: Element;
  region?: Region;
}

export interface Miss {
  url: string;
}

const LS_THEME = 'manna.theme';
const LS_USER = 'manna.user';

function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* 저장소가 막힌 환경 — 다음에 다시 물을 뿐이다 */
  }
}

export const doc = signal<MannaDoc>(newDoc());
export let blobs: BlobStore = new Map();
export const rev = signal(0);
export const dirty = signal(false);
export const fileName = signal<string | null>(null);

export const screenId = signal<string | null>(null);
export const versionNo = signal<number | null>(null);
export const mode = signal<Mode>('view');
export const paused = signal(false);
export const selected = signal<string | null>(null);
export const hovered = signal<string | null>(null);
export const draft = signal<Draft | null>(null);
export const visible = signal<ReadonlySet<string>>(new Set());
export const misses = signal<Miss[]>([]);
export const tab = signal<'todo' | 'desc'>('todo');
export const theme = signal<Theme>(lsGet(LS_THEME) === 'dark' ? 'dark' : 'light');
export const user = signal<string | null>(lsGet(LS_USER));
export const askName = signal(false);
export const toast = signal<{ text: string; tone: 'info' | 'error' } | null>(null);

export const screen = computed(() => {
  rev.value;
  return doc.value.screens.find((s) => s.id === screenId.value) ?? null;
});

export const version = computed(() => {
  rev.value;
  const s = screen.value;
  if (!s) return null;
  return s.versions.find((v) => v.v === versionNo.value) ?? latest(s);
});

/* 문서는 제자리에서 고치므로 객체 동일성으로는 변화를 알 수 없다 — rev 를 읽어 매번 다시 계산하고, 새 배열을 돌려준다 */
export const annotations = computed(() => {
  rev.value;
  const s = screen.value;
  const v = version.value;
  if (!s || !v) return [];
  return s.annotations.filter((a) => a.version === v.v);
});

export function loadDocument(d: MannaDoc, b: BlobStore, name: string | null = null): void {
  blobs = b;
  doc.value = d;
  fileName.value = name;
  const first = d.screens[0];
  screenId.value = first?.id ?? null;
  versionNo.value = first ? latest(first).v : null;
  selected.value = null;
  draft.value = null;
  misses.value = [];
  dirty.value = false;
  rev.value++;
}

export function addBlobs(entries: Iterable<[string, { enc: 'gz64' | 'b64'; data: string }]>): void {
  for (const [sha, b] of entries) blobs.set(sha, b);
}

/** 문서를 고친다. 다시 그리고, 저장 안 됨으로 표시한다 */
export function mutate(fn: (d: MannaDoc) => void): void {
  fn(doc.value);
  doc.value.meta.updatedAt = now();
  dirty.value = true;
  rev.value++;
}

export function selectScreen(id: string, v?: number): void {
  const s = doc.value.screens.find((x) => x.id === id);
  if (!s) return;
  screenId.value = id;
  versionNo.value = v ?? latest(s).v;
  selected.value = null;
  draft.value = null;
  misses.value = [];
}

export function setTheme(t: Theme): void {
  theme.value = t;
  lsSet(LS_THEME, t);
}

export function setUser(name: string): void {
  user.value = name;
  lsSet(LS_USER, name);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function notify(text: string, tone: 'info' | 'error' = 'info'): void {
  toast.value = { text, tone };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), tone === 'error' ? 8000 : 3000);
}
