/* 연결 — Comment · 화면 위 영역 · 화면 전체를 서로 잇는다 (탭과 상관없이)
 *
 * 기획안(하이파이 화면)과 실제 제품 화면을 오가며 보려고 쓴다. 연결은 양방향이라 어느 끝에서든 눌러 반대쪽으로 간다.
 * 문서의 connections 에 끝 두 개(a · b)로 남는다. Comment 끝은 Comment id 로 잇고 "SCR-002 #3" 처럼 탭-번호로 보인다.
 * 영역 끝은 화면 좌표 박스(핀처럼 그 자리에 박힌다)이고, Comment 가 없어도 된다.
 *
 * 만드는 순서: 시작할 끝을 정하고(Comment 의 "연결" · 영역 그리기) → 다른 탭으로 가도 되는 상태에서 → 반대쪽을 고른다
 * (Comment 를 누르거나, 영역을 그리거나, 화면 전체, 목록에서).
 */
import { signal } from '@preact/signals';
import type { Connection, LinkEnd, MannaDoc } from '@core';
import { displayNo, latest, now, touchParticipant, uid } from '@core';
import { doc, mutate, notify, popHidden, requestReveal, screenId, selectScreen, selected, user, versionNo } from './store';

/** 연결을 만드는 중 — 시작한 끝 */
export const linking = signal<{ from: LinkEnd } | null>(null);
/** 연결 영역 그리기 (Comment 없이 화면의 한 자리) */
export const areaTool = signal(false);
/** 연결을 따라 왔을 때 잠깐 반짝일 영역 */
export const flashArea = signal<{ key: string; at: number } | null>(null);
/** 다른 탭의 Comment 로 왔을 때 — 그 화면이 다 뜬 뒤 자리를 찾을 Comment */
export const revealAfterLoad = signal<string | null>(null);
/** 연결을 따라 오기 전 자리 — "돌아가기" */
export const jumpBack = signal<{ label: string; screen: string; version: number; selected: string | null } | null>(null);

export const areaKey = (c: Connection, side: 'a' | 'b') => `${c.id}:${side}`;

export function sameEnd(x: LinkEnd, y: LinkEnd): boolean {
  if (x.kind !== y.kind || x.screen !== y.screen) return false;
  if (x.kind === 'comment' && y.kind === 'comment') return x.ann === y.ann;
  if (x.kind === 'area' && y.kind === 'area') return x.version === y.version && x.box.join() === y.box.join();
  return true;
}

/** 끝이 아직 문서에 있는가 (지운 화면 · Comment 를 가리키면 없다) */
export function endExists(d: MannaDoc, e: LinkEnd): boolean {
  const s = d.screens.find((x) => x.id === e.screen);
  if (!s) return false;
  if (e.kind === 'comment') return s.annotations.some((a) => a.id === e.ann);
  if (e.kind === 'area') return s.versions.some((v) => v.v === e.version);
  return true;
}

/** 사람이 읽는 이름 — "SCR-002 #3 제목", "SCR-002 영역 · 이름", "SCR-002 화면이름" */
export function endLabel(d: MannaDoc, e: LinkEnd): { tag: string; text: string; missing: boolean } {
  const s = d.screens.find((x) => x.id === e.screen);
  if (!s) return { tag: e.screen, text: '지운 화면', missing: true };
  const ver = (v: number) => (s.versions.length > 1 ? ` v${v}` : '');
  if (e.kind === 'comment') {
    const a = s.annotations.find((x) => x.id === e.ann);
    if (!a) return { tag: e.screen, text: '지운 Comment', missing: true };
    const words = (a.title || a.body.replace(/[#>*`_[\]-]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 40);
    return { tag: `${s.id}${ver(a.version)} #${displayNo(s, a)}`, text: words, missing: false };
  }
  if (e.kind === 'area') return { tag: `${s.id}${ver(e.version)} 영역`, text: e.name ?? s.title, missing: false };
  return { tag: s.id, text: s.title, missing: false };
}

export const labelText = (d: MannaDoc, e: LinkEnd) => {
  const l = endLabel(d, e);
  return l.text ? `${l.tag} ${l.text}` : l.tag;
};

/** 이 끝에 닿은 연결들 — 반대쪽 끝과 함께 */
export function linksOf(d: MannaDoc, match: (e: LinkEnd) => boolean): { c: Connection; here: 'a' | 'b'; other: LinkEnd }[] {
  const out: { c: Connection; here: 'a' | 'b'; other: LinkEnd }[] = [];
  for (const c of d.connections ?? []) {
    if (match(c.a)) out.push({ c, here: 'a', other: c.b });
    if (match(c.b)) out.push({ c, here: 'b', other: c.a });
  }
  return out;
}

/** 지금 있는 자리 — 돌아갈 곳 */
function here(): { label: string; screen: string; version: number; selected: string | null } | null {
  const d = doc.peek();
  const id = screenId.peek();
  const v = versionNo.peek();
  if (!id || v == null) return null;
  const sel = selected.peek();
  const label = sel ? labelText(d, { kind: 'comment', screen: id, ann: sel }) : labelText(d, { kind: 'screen', screen: id });
  return { label, screen: id, version: v, selected: sel };
}

/** 연결을 따라 그 끝으로 간다 — 다른 탭이면 그 탭을 열고, Comment 면 골라서 그 자리를 찾아가고, 영역이면 반짝인다 */
export function goTo(e: LinkEnd, flash?: string): void {
  const d = doc.peek();
  const s = d.screens.find((x) => x.id === e.screen);
  if (!s || !endExists(d, e)) return notify('연결된 곳이 문서에 없습니다 (지운 화면이나 Comment).', 'error');
  const back = here();
  if (e.kind === 'comment') {
    const a = s.annotations.find((x) => x.id === e.ann)!;
    const moving = screenId.peek() !== s.id || versionNo.peek() !== a.version;
    if (moving) selectScreen(s.id, a.version);
    selected.value = a.id;
    popHidden.value = false;
    if (a.anchor && a.kind !== 'capture') {
      if (moving) revealAfterLoad.value = a.id;
      else requestReveal(a.id);
    }
  } else if (e.kind === 'area') {
    if (screenId.peek() !== s.id || versionNo.peek() !== e.version) selectScreen(s.id, e.version);
    else selected.value = null;
    if (flash) flashArea.value = { key: flash, at: Date.now() };
  } else if (screenId.peek() !== s.id) selectScreen(s.id, latest(s).v);
  if (back && back.screen !== e.screen || (back && e.kind === 'comment' && back.selected !== e.ann)) jumpBack.value = back;
}

export function goBack(): void {
  const b = jumpBack.peek();
  if (!b) return;
  jumpBack.value = null;
  const s = doc.peek().screens.find((x) => x.id === b.screen);
  if (!s) return;
  selectScreen(b.screen, s.versions.some((v) => v.v === b.version) ? b.version : latest(s).v);
  if (b.selected && s.annotations.some((a) => a.id === b.selected)) {
    selected.value = b.selected;
    popHidden.value = false;
  }
}

export function startLinking(from: LinkEnd): void {
  if (!user.peek()) return notify('이름을 먼저 정해 주세요.', 'error');
  areaTool.value = false;
  linking.value = { from };
}

export function cancelLinking(): void {
  linking.value = null;
  areaTool.value = false;
}

/** 반대쪽을 골랐다 — 연결을 만든다 */
export function finishLinking(to: LinkEnd): boolean {
  const l = linking.peek();
  if (!l) return false;
  const d = doc.peek();
  if (sameEnd(l.from, to)) {
    notify('같은 곳끼리는 이을 수 없습니다. 다른 Comment · 영역 · 화면을 고르세요.', 'error');
    return false;
  }
  if ((d.connections ?? []).some((c) => (sameEnd(c.a, l.from) && sameEnd(c.b, to)) || (sameEnd(c.b, l.from) && sameEnd(c.a, to)))) {
    notify('이미 이어져 있습니다.');
    cancelLinking();
    return false;
  }
  const c: Connection = { id: uid(), a: l.from, b: to, author: user.peek()!, at: now() };
  mutate((x) => {
    (x.connections ??= []).push(c);
    touchParticipant(x, user.peek()!);
  }, { label: '연결' });
  cancelLinking();
  const from = l.from;
  notify(`연결했습니다 — ${labelText(doc.peek(), from)} ↔ ${labelText(doc.peek(), to)}`, 'info', { label: '시작한 곳으로', run: () => goTo(from, from.kind === 'area' ? areaKey(c, 'a') : undefined) });
  return true;
}

export function removeConnection(id: string): void {
  mutate((x) => {
    x.connections = (x.connections ?? []).filter((c) => c.id !== id);
    if (!x.connections.length) delete x.connections;
  }, { label: '연결 끊기' });
}

/** 지운 화면 · Comment 를 가리키는 연결을 걷는다 (mutate 안에서 부른다) */
export function pruneConnections(x: MannaDoc): void {
  if (!x.connections) return;
  x.connections = x.connections.filter((c) => endExists(x, c.a) && endExists(x, c.b));
  if (!x.connections.length) delete x.connections;
}
