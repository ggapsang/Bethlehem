/* 화면 상태 경로 — 화면을 연 뒤의 클릭을 적어 두었다가, 다른 상태에 있는 Comment 로 갈 때 다시 누른다.
 * 캔버스 위 클릭(FAB 조망 → BAY-4)도 요소 안의 상대 위치로 다시 낼 수 있다.
 */
import type { Step } from '@core';
import { fingerprint, resolve } from '@core';

const MAX = 24;

/** 지금 화면에서 사람이 누른 순서 */
export const pathLog: Step[] = [];

export function resetPath(steps: Step[] = []): void {
  pathLog.length = 0;
  pathLog.push(...steps);
}

export function recordClick(e: MouseEvent): void {
  if (!e.isTrusted || e.button !== 0) return;
  const el = e.target as Element | null;
  if (!el || el.nodeType !== 1 || el === el.ownerDocument.documentElement) return;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return;
  pathLog.push({ fp: fingerprint(el), x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  if (pathLog.length > MAX) pathLog.shift();
}

function shown(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const cv = (el as Element & { checkVisibility?: (o: object) => boolean }).checkVisibility;
  return cv ? cv.call(el, { opacityProperty: true, visibilityProperty: true }) : true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 대상 요소가 나타날 때까지 기다린다 */
async function waitFor(doc: Document, step: Step, timeout: number): Promise<Element | null> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const el = resolve(doc, step.fp)?.el;
    if (el && shown(el)) return el;
    await sleep(120);
  }
  return null;
}

/** 실제 클릭과 같은 순서로 이벤트를 낸다 (pointer → mouse → click) */
export function clickAt(el: Element, x: number, y: number): void {
  const doc = el.ownerDocument;
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  if (!win) return;
  const r = el.getBoundingClientRect();
  const cx = r.left + x * r.width;
  const cy = r.top + y * r.height;
  const target = doc.elementFromPoint(cx, cy) ?? el;
  const base = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy, button: 0, view: win };
  const ptr = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true };
  target.dispatchEvent(new win.PointerEvent('pointerdown', { ...ptr, buttons: 1 }));
  target.dispatchEvent(new win.MouseEvent('mousedown', { ...base, buttons: 1 }));
  target.dispatchEvent(new win.PointerEvent('pointerup', { ...ptr, buttons: 0 }));
  target.dispatchEvent(new win.MouseEvent('mouseup', { ...base, buttons: 0 }));
  target.dispatchEvent(new win.MouseEvent('click', { ...base, buttons: 0 }));
}

const TABLIKE = '[role="tab"], [aria-selected], [aria-pressed], [aria-expanded]';

/** 다시 불러오지 않고 해 보는 빠른 길 — 경로 중 탭·토글만, 지금 선택 안 된 것만 누른다 */
export async function quickReveal(doc: Document, steps: Step[]): Promise<void> {
  for (const s of steps) {
    const el = resolve(doc, s.fp)?.el;
    if (!el || !shown(el)) continue;
    const tab = el.closest(TABLIKE);
    if (!tab) continue;
    if (tab.getAttribute('aria-selected') === 'true' || tab.getAttribute('aria-pressed') === 'true') continue;
    clickAt(el, s.x, s.y);
    await sleep(250);
  }
}

/** 처음부터 다시 — 막 불러온 화면에서 경로 전체를 순서대로 누른다 */
export async function replay(doc: Document, steps: Step[], alive: () => boolean): Promise<boolean> {
  for (const s of steps) {
    if (!alive()) return false;
    const el = await waitFor(doc, s, 10000);
    if (!el) return false;
    clickAt(el, s.x, s.y);
    await sleep(350);
  }
  return true;
}
