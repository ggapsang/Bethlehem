/* 화면 상태 — Manna 와 Bethlehem 이 같은 모듈을 공유한다
 * 문서는 제자리에서 고치고 rev 를 올려 다시 그린다. 문서 객체가 그대로 저장 대상이기 때문이다.
 * 되돌리기는 고치기 직전 문서의 JSON 스냅숏을 쌓는다 (블롭은 덧붙기만 하므로 함께 되돌릴 필요가 없다).
 */
import { computed, signal } from '@preact/signals';
import type { BlobStore, EncodedBlob, MannaDoc, Region } from '@core';
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

const LS = { theme: 'manna.theme', user: 'manna.user', panelW: 'manna.panelW', panel: 'manna.panel', notes: 'manna.notesOpen' };

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
    /* 저장소가 막힌 환경 — 기본값으로 돌 뿐이다 */
  }
}

export const doc = signal<MannaDoc>(newDoc());
export let blobs: BlobStore = new Map();
export const rev = signal(0);
export const dirty = signal(false);
export const fileName = signal<string | null>(null);

export const screenId = signal<string | null>(null);
export const versionNo = signal<number | null>(null);
/** 'annotate' = 피커 고정. Ctrl 을 누르고 있는 동안은 picking 이 켜진다 */
export const mode = signal<Mode>('view');
export const holdPick = signal(false);
export const picking = computed(() => mode.value === 'annotate' || holdPick.value);
export const paused = signal(false);
export const recording = signal<{ startedAt: number } | null>(null);
export const selected = signal<string | null>(null);
export const hovered = signal<string | null>(null);
export const draft = signal<Draft | null>(null);
export const visible = signal<ReadonlySet<string>>(new Set());
export const misses = signal<Miss[]>([]);
export const theme = signal<Theme>(lsGet(LS.theme) === 'dark' ? 'dark' : 'light');
export const user = signal<string | null>(lsGet(LS.user));
export const askName = signal(false);
export const toast = signal<{ text: string; tone: 'info' | 'error' } | null>(null);
export const fullscreen = signal(false);
export const panelOpen = signal(lsGet(LS.panel) !== '0');
export const panelWidth = signal(Number(lsGet(LS.panelW)) || 400);
export const notesOpen = signal(lsGet(LS.notes) !== '0');
export const canUndo = signal(false);
export const canRedo = signal(false);

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

/** 화면을 다시 불러와야 하는지 판단하는 열쇠 — 되돌리기로 객체가 바뀌어도 같은 버전이면 같다 */
export const versionKey = computed(() => {
  const s = screen.value;
  const v = version.value;
  if (!s || !v) return '';
  const entry = v.files[v.entry]?.sha ?? v.external.find((e) => e.url === v.entry)?.sha ?? '';
  return `${s.id}|${v.v}|${v.entry}|${entry}`;
});

/* 문서는 제자리에서 고치므로 객체 동일성으로는 변화를 알 수 없다 — rev 를 읽어 매번 다시 계산하고, 새 배열을 돌려준다 */
export const annotations = computed(() => {
  rev.value;
  const s = screen.value;
  const v = version.value;
  if (!s || !v) return [];
  return s.annotations.filter((a) => a.version === v.v);
});

/* ── 되돌리기 ──────────────────────────────────────────────────────────── */

interface Step {
  snap: string;
  label: string;
  merge?: string;
  at: number;
}
const MAX_STEPS = 100;
const undoStack: Step[] = [];
const redoStack: Step[] = [];

function syncHistory(): void {
  canUndo.value = undoStack.length > 0;
  canRedo.value = redoStack.length > 0;
}

export interface MutateOptions {
  /** 되돌리기 알림에 쓰는 이름 */
  label?: string;
  /** 같은 열쇠의 연속 변경(타이핑 등)은 2초 안이면 한 단계로 묶는다 */
  merge?: string;
}

/** 문서를 고친다. 되돌리기 단계를 남기고, 다시 그리고, 저장 안 됨으로 표시한다 */
export function mutate(fn: (d: MannaDoc) => void, opts: MutateOptions = {}): void {
  const t = Date.now();
  const top = undoStack[undoStack.length - 1];
  if (opts.merge && top?.merge === opts.merge && t - top.at < 2000) top.at = t;
  else {
    undoStack.push({ snap: JSON.stringify(doc.value), label: opts.label ?? '변경', merge: opts.merge, at: t });
    if (undoStack.length > MAX_STEPS) undoStack.shift();
  }
  redoStack.length = 0;
  fn(doc.value);
  doc.value.meta.updatedAt = now();
  dirty.value = true;
  rev.value++;
  syncHistory();
}

function restore(snap: string): void {
  doc.value = JSON.parse(snap) as MannaDoc;
  const d = doc.value;
  if (!d.screens.some((s) => s.id === screenId.value)) {
    screenId.value = d.screens[0]?.id ?? null;
    versionNo.value = d.screens[0] ? latest(d.screens[0]).v : null;
  } else {
    const s = d.screens.find((x) => x.id === screenId.value)!;
    if (!s.versions.some((v) => v.v === versionNo.value)) versionNo.value = latest(s).v;
  }
  if (selected.value && !d.screens.some((s) => s.annotations.some((a) => a.id === selected.value))) selected.value = null;
  dirty.value = true;
  rev.value++;
}

export function undo(): void {
  const step = undoStack.pop();
  if (!step) return;
  redoStack.push({ ...step, snap: JSON.stringify(doc.value) });
  restore(step.snap);
  syncHistory();
  notify(`되돌림: ${step.label}`);
}

export function redo(): void {
  const step = redoStack.pop();
  if (!step) return;
  undoStack.push({ ...step, snap: JSON.stringify(doc.value), at: 0 });
  restore(step.snap);
  syncHistory();
  notify(`다시 실행: ${step.label}`);
}

/* ── 문서 열기 · 화면 고르기 ───────────────────────────────────────────── */

export function loadDocument(d: MannaDoc, b: BlobStore, name: string | null = null): void {
  for (const s of d.screens) s.notes ??= '';
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
  undoStack.length = 0;
  redoStack.length = 0;
  syncHistory();
  rev.value++;
}

export function addBlobs(entries: Iterable<[string, EncodedBlob]>): void {
  for (const [sha, b] of entries) blobs.set(sha, b);
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

/* ── 보기 설정 (이 브라우저에만 기억) ─────────────────────────────────── */

export function setTheme(t: Theme): void {
  theme.value = t;
  lsSet(LS.theme, t);
}

export function setUser(name: string): void {
  user.value = name;
  lsSet(LS.user, name);
}

export function setPanelWidth(w: number): void {
  panelWidth.value = w;
  lsSet(LS.panelW, String(Math.round(w)));
}

export function togglePanel(open = !panelOpen.value): void {
  panelOpen.value = open;
  lsSet(LS.panel, open ? '1' : '0');
}

export function toggleNotes(open = !notesOpen.value): void {
  notesOpen.value = open;
  lsSet(LS.notes, open ? '1' : '0');
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function notify(text: string, tone: 'info' | 'error' = 'info'): void {
  toast.value = { text, tone };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), tone === 'error' ? 8000 : 3000);
}

/* ── 다른 화면 상태에 있는 Comment 로 이동 요청 (패널 → 스테이지) ─────── */
export const reveal = signal<{ id: string; nonce: number } | null>(null);
export const revealing = signal(false);
export function requestReveal(id: string): void {
  reveal.value = { id, nonce: Date.now() };
}

/** 녹화 대상 — 스테이지 프레임 요소 */
export const stageRef: { frame: HTMLElement | null } = { frame: null };
