/* 화면 상태 — Manna 와 Bethlehem 이 같은 모듈을 공유한다
 * 문서는 제자리에서 고치고 rev 를 올려 다시 그린다. 문서 객체가 그대로 저장 대상이기 때문이다.
 * 되돌리기는 고치기 직전 문서의 JSON 스냅숏을 쌓는다 (블롭은 덧붙기만 하므로 함께 되돌릴 필요가 없다).
 */
import { computed, effect, signal } from '@preact/signals';
import type { BlobStore, EncodedBlob, MannaDoc } from '@core';
import type { Picked } from './agent/protocol';
import { latest, newDoc, now } from '@core';

export type Mode = 'view' | 'annotate';
export type Theme = 'light' | 'dark';

/** 피커로 잡은 대상 — 에이전트가 화면 안에서 만든 지문·영역·경로 */
export interface Draft {
  picked: Picked;
}

/** 피커를 켤 때 찍어 둔 스테이지 그림 — 고르는 동안 화면을 멈춰 보이고, Comment 의 shot 이 된다 */
export interface Still {
  url: string;
  bytes: Uint8Array;
  w: number;
  h: number;
}

export interface Miss {
  url: string;
}

/* notes 는 키를 바꿨다 — 개요는 이제 기본으로 접혀 있다 (전에 펼쳐 둔 기록을 따르지 않는다) */
const LS = {
  theme: 'manna.theme', user: 'manna.user', panelW: 'manna.panelW', panel: 'manna.panel', notes: 'terr.notesOpen', comments: 'terr.commentsOpen', titleW: 'terr.titleW', notesRatio: 'terr.notesRatio', fit: 'terr.fit', labels: 'terr.markerLabels', fullPin: 'terr.fullPanelPin', showDone: 'terr.showDone', boxes: 'terr.showBoxes',
  tabs: (docId: string) => `terr.tabs.${docId}`,
};

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
/** Comment 팝업만 닫았다 — 선택(카드·마커 강조)은 그대로 둔다. 다른 Comment 를 고르면 다시 뜬다 */
export const popHidden = signal(false);
effect(() => {
  selected.value;
  popHidden.value = false;
});
export const still = signal<Still | null>(null);
/** 선택한 Comment 의 '달 때 화면'을 스테이지에 덮어 보일지 */
export const shotView = signal(true);
export const visible = signal<ReadonlySet<string>>(new Set());
export const misses = signal<Miss[]>([]);
/** 기본은 다크 — 사용자가 라이트로 바꾸면 그 브라우저에 기억한다 */
export const theme = signal<Theme>(lsGet(LS.theme) === 'light' ? 'light' : 'dark');
export const user = signal<string | null>(lsGet(LS.user));
export const askName = signal(false);
export interface ToastAction {
  label: string;
  run: () => void;
}
export const toast = signal<{ text: string; tone: 'info' | 'error'; action?: ToastAction } | null>(null);

/** 저장 상태 — 자동 저장이 어디까지 됐는지 툴바에 보인다 */
export type SaveKind = 'idle' | 'pending' | 'saving' | 'saved' | 'local' | 'error';
export const saveState = signal<{ kind: SaveKind; where?: string; at?: number; message?: string }>({ kind: 'idle' });
export const fullscreen = signal(false);
export const panelOpen = signal(lsGet(LS.panel) !== '0');
export const panelWidth = signal(Number(lsGet(LS.panelW)) || 400);
export const notesOpen = signal(lsGet(LS.notes) === '1');
/** 툴바의 문서 제목 칸 폭 — 휠이나 손잡이로 늘이고 줄인다 */
export const titleWidth = signal(Math.min(720, Math.max(120, Number(lsGet(LS.titleW)) || 320)));
/** 열린 화면 탭 — 브라우저 탭처럼 여러 화면을 띄워 두고 오간다 */
export const openTabs = signal<string[]>([]);
/** 화면 배율 — null 이면 남는 자리에 맞춘다 */
export const zoom = signal<number | null>(null);
/** 지금 실제 배율 — 맞춤일 때도 (메뉴의 확대·축소가 여기서 한 단계씩) */
export const stageScale = signal(1);
/** Comment 목록 펼침 — 개요처럼 접을 수 있다 (기본 펼침) */
export const commentsOpen = signal(lsGet(LS.comments) !== '0');
/** 개요가 패널에서 차지하는 몫 — 기본 절반, 개요와 Comment 사이 손잡이로 바꾼다 */
export const notesRatio = signal(Math.min(0.85, Math.max(0.15, Number(lsGet(LS.notesRatio)) || 0.5)));
/** 화면 맞춤 — 'fit' 여백을 두고 비율 그대로 · 'fill' 탭을 꽉 채운다(높이를 탭에 맞춰 화면이 다시 배치된다) */
export type FitMode = 'fit' | 'fill';
export const fitMode = signal<FitMode>(lsGet(LS.fit) === 'fill' ? 'fill' : 'fit');
/** 지금 스테이지가 쓰는 뷰포트 — 꽉 채우기면 높이가 버전의 기준과 다르다 */
/** 화면의 마커 옆에 제목 · 이름을 보일지 (기본 보임) */
export const markerLabels = signal(lsGet(LS.labels) !== '0');
/** 전체화면에서 오른쪽 패널을 붙여 둘지 — 아니면 오른쪽 끝에 마우스를 대면 그 위로 뜬다 */
export const fullPanelPinned = signal(lsGet(LS.fullPin) === '1');
export function setFullPanelPinned(on: boolean): void {
  fullPanelPinned.value = on;
  lsSet(LS.fullPin, on ? '1' : '0');
}
export function setMarkerLabels(on: boolean): void {
  markerLabels.value = on;
  lsSet(LS.labels, on ? '1' : '0');
}
export const stageViewport = signal<{ w: number; h: number }>({ w: 1920, h: 1080 });
/** 영역 Comment 작성 방식 — 캡처(기본) · 화면에 붙이기. 녹화는 캡처에 클립을 더한다 */
export const snipMode = signal<'capture' | 'pin'>('capture');
/** 작성 중인 영역 Comment 에 붙일 클립 */
export const draftClip = signal<import('@core').Clip | null>(null);
/** 영역만 녹화하는 중 — 그동안 멈춤 그림을 걷고 화면을 돌린다 */
export const snipRec = signal<{ startedAt: number } | null>(null);
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
  // URL 화면은 사본이 바뀌어도 다시 불러오지 않는다 (편집기에서는 실시간 사이트가 돈다)
  if (v.source?.mode === 'site') return `${s.id}|${v.v}|site|${v.source.url}`;
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

/** 핀 꽂기 — 고른 모양으로 화면을 한 번 누르면 박힌다 */
export const pinTool = signal<'pin' | 'nav' | null>(null);
/** 고른 핀 (Delete 로 지운다) · 이름 짓는 중인 핀 */
export const pinSel = signal<string | null>(null);
export const pinNaming = signal<string | null>(null);
/** 모든 Comment 의 대상 박스를 늘 보일지 (기본은 고르거나 마우스를 올릴 때만) */
export const showBoxes = signal(lsGet(LS.boxes) === '1');
export function setShowBoxes(on: boolean): void {
  showBoxes.value = on;
  lsSet(LS.boxes, on ? '1' : '0');
}

/** 완료한 Comment 도 보일지 — 기본은 숨긴다 (지운 것이 아니다) */
export const showDone = signal(lsGet(LS.showDone) === '1');
export function setShowDone(on: boolean): void {
  showDone.value = on;
  lsSet(LS.showDone, on ? '1' : '0');
}
/** 지금 보일 Comment — 완료한 것은 "완료 보기" 일 때만. 번호는 annotations(전체) 순서 그대로다 */
export const shownAnnotations = computed(() => (showDone.value ? annotations.value : annotations.value.filter((a) => !a.done)));

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
  /** false 면 되돌리기 단계를 남기지 않는다 (URL 화면 사본 갱신처럼 사용자가 한 일이 아닌 것) */
  undoable?: boolean;
}

/** 문서를 고친다. 되돌리기 단계를 남기고, 다시 그리고, 저장 안 됨으로 표시한다 */
export function mutate(fn: (d: MannaDoc) => void, opts: MutateOptions = {}): void {
  const t = Date.now();
  const top = undoStack[undoStack.length - 1];
  if (opts.undoable === false) {
    /* 되돌리기 없이 */
  } else if (opts.merge && top?.merge === opts.merge && t - top.at < 2000) top.at = t;
  else {
    undoStack.push({ snap: JSON.stringify(doc.value), label: opts.label ?? '변경', merge: opts.merge, at: t });
    if (undoStack.length > MAX_STEPS) undoStack.shift();
  }
  if (opts.undoable !== false) redoStack.length = 0;
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
  lastVer.clear();
  /* 열어 둔 탭 — 이 브라우저에 { open, known } 로 기억한다.
     지난번에 없던 화면(작성자가 새 판에 더한 화면)은 저절로 탭으로 연다. 기억이 없으면 모든 화면 */
  let tabs: string[] = [];
  let known: string[] | null = null;
  try {
    const saved = JSON.parse(lsGet(LS.tabs(d.id)) ?? 'null') as string[] | { open: string[]; known: string[] } | null;
    if (Array.isArray(saved)) tabs = saved; // 예전 형식 — 무엇을 알았는지 몰라 모든 화면을 새로 친다
    else if (saved) {
      tabs = saved.open;
      known = saved.known;
    }
  } catch {
    /* 기록이 깨졌다 — 처음처럼 */
  }
  tabs = tabs.filter((id) => d.screens.some((s) => s.id === id));
  const fresh = d.screens.map((s) => s.id).filter((id) => !tabs.includes(id) && (!known || !known.includes(id)));
  tabs = [...tabs, ...fresh];
  const first = d.screens.find((s) => s.id === tabs[0]) ?? d.screens[0];
  openTabs.value = tabs;
  if (d.screens.length) saveTabs();
  screenId.value = first?.id ?? null;
  versionNo.value = first ? latest(first).v : null;
  zoom.value = null;
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

/** 탭마다 마지막으로 보던 버전 */
const lastVer = new Map<string, number>();

function saveTabs(): void {
  lsSet(LS.tabs(doc.peek().id), JSON.stringify({ open: openTabs.peek(), known: doc.peek().screens.map((s) => s.id) }));
}

export function selectScreen(id: string, v?: number): void {
  const s = doc.value.screens.find((x) => x.id === id);
  if (!s) return;
  const remembered = lastVer.get(id);
  const ver = v ?? (remembered != null && s.versions.some((x) => x.v === remembered) ? remembered : latest(s).v);
  if (screenId.peek() !== id) zoom.value = null;
  if (!openTabs.peek().includes(id)) {
    // 지금 탭 바로 뒤에 연다 (브라우저처럼)
    const tabs = [...openTabs.peek()];
    const at = tabs.indexOf(screenId.peek() ?? '');
    tabs.splice(at < 0 ? tabs.length : at + 1, 0, id);
    openTabs.value = tabs;
    saveTabs();
  }
  lastVer.set(id, ver);
  screenId.value = id;
  versionNo.value = ver;
  selected.value = null;
  draft.value = null;
  misses.value = [];
}

/** 탭 닫기 — 지금 탭이면 옆 탭으로. 마지막 하나는 닫지 않는다 */
export function closeTab(id: string): void {
  const tabs = openTabs.peek().filter((x) => doc.peek().screens.some((s) => s.id === x));
  if (tabs.length <= 1 || !tabs.includes(id)) return;
  const at = tabs.indexOf(id);
  const rest = tabs.filter((x) => x !== id);
  openTabs.value = rest;
  saveTabs();
  if (screenId.peek() === id) selectScreen(rest[Math.min(at, rest.length - 1)]!);
}

/** 지운 화면의 탭을 뺀다 */
export function dropTab(id: string): void {
  if (!openTabs.peek().includes(id)) return;
  openTabs.value = openTabs.peek().filter((x) => x !== id);
  saveTabs();
}

/** 탭 순서 바꾸기 */
export function moveTab(id: string, to: number): void {
  const tabs = openTabs.peek().filter((x) => x !== id);
  tabs.splice(Math.max(0, Math.min(to, tabs.length)), 0, id);
  openTabs.value = tabs;
  saveTabs();
}

const ZOOMS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 3];
/** 한 단계 키우기/줄이기 — cur 는 지금 실제 배율(맞춤일 때도) */
export function zoomStep(dir: 1 | -1, cur: number): void {
  const next = dir > 0 ? ZOOMS.find((z) => z > cur + 0.001) : [...ZOOMS].reverse().find((z) => z < cur - 0.001);
  zoom.value = next ?? (dir > 0 ? ZOOMS[ZOOMS.length - 1]! : ZOOMS[0]!);
}

export function setTitleWidth(w: number): void {
  titleWidth.value = Math.min(720, Math.max(120, Math.round(w)));
  lsSet(LS.titleW, String(titleWidth.value));
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

export function setNotesRatio(r: number): void {
  notesRatio.value = Math.min(0.85, Math.max(0.15, r));
  lsSet(LS.notesRatio, notesRatio.value.toFixed(3));
}

export function setFitMode(m: FitMode): void {
  fitMode.value = m;
  zoom.value = null;
  lsSet(LS.fit, m);
}

export function toggleComments(open = !commentsOpen.value): void {
  commentsOpen.value = open;
  lsSet(LS.comments, open ? '1' : '0');
}

export function toggleNotes(open = !notesOpen.value): void {
  notesOpen.value = open;
  lsSet(LS.notes, open ? '1' : '0');
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function notify(text: string, tone: 'info' | 'error' = 'info', action?: ToastAction): void {
  toast.value = { text, tone, ...(action ? { action } : {}) };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), action ? 15000 : tone === 'error' ? 8000 : 3000);
}

/* ── 다른 화면 상태에 있는 Comment 로 이동 요청 (패널 → 스테이지) ─────── */
export const reveal = signal<{ id: string; nonce: number } | null>(null);
export const revealing = signal(false);
export function requestReveal(id: string): void {
  reveal.value = { id, nonce: Date.now() };
}

/** 스테이지가 지금 보고 있는 페이지 (패키지 경로 또는 사이트 주소) — Comment 에 함께 적는다 */
export const stagePage = signal('');

/** 녹화 대상 — 스테이지 프레임 요소 */
export const stageRef: { frame: HTMLElement | null; snip: HTMLElement | null } = { frame: null, snip: null };
