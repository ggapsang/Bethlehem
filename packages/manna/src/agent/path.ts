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

const pointOf = (el: Element, x: number, y: number) => {
  const r = el.getBoundingClientRect();
  return { cx: r.left + x * r.width, cy: r.top + y * r.height };
};

/** 그 자리에서 맨 위에 있는 요소가 대상(이나 그 안쪽)인가 — 스플래시·로딩 막이 덮고 있으면 아니다 */
function onTop(el: Element, x: number, y: number): boolean {
  const { cx, cy } = pointOf(el, x, y);
  const top = el.ownerDocument.elementFromPoint(cx, cy);
  return !!top && (top === el || el.contains(top) || top.contains(el));
}

/** 대상 요소가 나타나고, 그 자리를 다른 것이 덮고 있지 않을 때까지 기다린다 */
async function waitFor(doc: Document, step: Step, timeout: number): Promise<Element | null> {
  const end = Date.now() + timeout;
  let seenAt = 0;
  while (Date.now() < end) {
    const el = resolve(doc, step.fp)?.el;
    if (el && shown(el) && onTop(el, step.x, step.y)) {
      // 막 나타난 화면은 그리기가 한 박자 늦다 — 잠깐 더 본다
      if (!seenAt) seenAt = Date.now();
      else if (Date.now() - seenAt > 250) return el;
    } else seenAt = 0;
    await sleep(100);
  }
  return null;
}

/** 실제 클릭과 같은 순서로 이벤트를 낸다 — 마우스를 먼저 올리고(호버로 대상을 정하는 화면) pointer → mouse → click */
export function clickAt(el: Element, x: number, y: number): void {
  const doc = el.ownerDocument;
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  if (!win) return;
  const { cx, cy } = pointOf(el, x, y);
  const target = doc.elementFromPoint(cx, cy) ?? el;
  const base = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy, button: 0, view: win };
  const ptr = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true };
  target.dispatchEvent(new win.PointerEvent('pointerover', { ...ptr, buttons: 0 }));
  target.dispatchEvent(new win.MouseEvent('mouseover', { ...base, buttons: 0 }));
  target.dispatchEvent(new win.PointerEvent('pointermove', { ...ptr, buttons: 0 }));
  target.dispatchEvent(new win.MouseEvent('mousemove', { ...base, buttons: 0 }));
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
    const el = await waitFor(doc, s, 15000);
    if (!el) return false;
    clickAt(el, s.x, s.y);
    await sleep(450);
  }
  return true;
}
