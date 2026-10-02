/* 문서를 고치는 동작들 — 패널·툴바·스테이지가 같이 쓴다. 모두 mutate 를 거치므로 되돌릴 수 있다 */
import type { Annotation, Clip, MarkerColor, Shot } from '@core';
import { moveAnnotation, now, setField, sha256, toBase64, touchParticipant, uid } from '@core';
import type { SiteSnap } from './host';
import { startRecording, type Recorder } from './stage/record';
import {
  pinSel, annotations, shownAnnotations, showDone, undo, dropTab, doc, openTabs, screenId, selectScreen, addBlobs, askName, blobs, draft, draftClip, mutate, notify, recording, screen, selected, snipMode, snipRec, stagePage, stageRef,
  stageViewport, still, user, version,
} from './store';

/** 영역 Comment 를 캡처로 다는가 — 찍을 그림이 있고(작성 프로그램), 그림 화면이 아니고, 영역을 그렸을 때 */
export function captureMode(): boolean {
  if (version.peek()?.source?.mode === 'site') return snipAvailable(); // URL 화면은 늘 캡처
  return snipAvailable() && snipMode.peek() === 'capture';
}

/** 캡처 · 녹화 · 붙이기를 고를 수 있는가 — 찍을 그림이 있고, 그림 화면이 아니고, 영역을 그렸거나 URL 화면일 때.
 * URL 화면은 사이트가 언제 어떻게 바뀔지 몰라 요소를 골라도 캡처가 기본이다 */
export function snipAvailable(): boolean {
  const d = draft.peek();
  const mode = version.peek()?.source?.mode;
  return !!d && !!still.peek() && mode !== 'image' && (!!d.picked.region || mode === 'site');
}

export function needName(): boolean {
  if (user.value) return false;
  askName.value = true;
  return true;
}

function blank(body: string): Annotation {
  const t = now();
  return { id: uid(), version: version.peek()!.v, body, author: user.value!, createdAt: t, updatedAt: t, replies: [], history: [] };
}

/** 지금 잡은 대상(draft)에 Comment 를 단다. 피커를 켤 때 찍어 둔 화면(still)은 이 Comment 의 shot 이 된다 */
export async function addFromDraft(body: string, title = '', assignee = ''): Promise<string | null> {
  const d = draft.peek();
  const s = screen.peek();
  const v = version.peek();
  if (!d || !s || !v || (!body.trim() && !title.trim()) || needName()) return null;
  const p = d.picked;
  let shot: Shot | undefined;
  const st = still.peek();
  if (st) {
    const sha = await shaOf(st.bytes);
    blobs.set(sha, { enc: 'b64', data: toBase64(st.bytes) });
    const { w, h } = stageViewport.peek();
    shot = { sha, w: st.w, h: st.h, box: { x: p.rect[0] / w, y: p.rect[1] / h, w: p.rect[2] / w, h: p.rect[3] / h } };
  }
  const capture = captureMode();
  const clip = draftClip.peek();
  const a: Annotation = {
    ...blank(body),
    ...(title.trim() ? { title: title.trim() } : {}),
    ...(assignee.trim() ? { assignee: assignee.trim() } : {}),
    anchor: { fp: p.fp, ...(p.region ? { region: p.region } : {}), trail: p.trail, props: p.props, path: p.path, ...(stagePage.peek() ? { page: stagePage.peek() } : {}), ...(p.html ? { html: p.html } : {}) },
    ...(capture && shot ? { kind: 'capture' as const } : {}),
    ...(shot ? { shot } : {}),
    ...(clip ? { clips: [clip] } : {}),
  };
  mutate((x) => {
    s.annotations.push(a);
    touchParticipant(x, user.value!);
    if (a.assignee) touchParticipant(x, a.assignee);
  }, { label: 'Comment 추가' });
  draft.value = null;
  draftClip.value = null;
  selected.value = a.id;
  return a.id;
}

/* ── 영역 녹화 — 그린 박스 자리만 짧게 (윈도우 캡처 도구처럼) ─────────────── */

let snip: Recorder | null = null;
let snipLimit: ReturnType<typeof setTimeout> | undefined;
const SNIP_MAX_MS = 30_000;

export async function toggleSnipRecording(target: HTMLElement | null): Promise<void> {
  if (snip) return stopSnipRecording();
  if (!target || !draft.peek() || rec) return;
  try {
    snipRec.value = { startedAt: Date.now() };
    // 멈춤 그림이 걷히고 화면이 다시 도는 것을 한 박자 기다린다
    await new Promise((r) => setTimeout(r, 120));
    snip = await startRecording(target);
    snip.onEnded(() => stopSnipRecording());
    snipLimit = setTimeout(() => stopSnipRecording(), SNIP_MAX_MS);
  } catch (e) {
    snip = null;
    snipRec.value = null;
    if ((e as Error).name !== 'NotAllowedError') notify(`녹화를 시작하지 못했습니다: ${(e as Error).message}`, 'error');
  }
}

export async function stopSnipRecording(): Promise<void> {
  const r = snip;
  if (!r) return void (snipRec.value = null);
  snip = null;
  clearTimeout(snipLimit);
  try {
    const clip = await r.stop();
    const sha = await shaOf(clip.bytes);
    blobs.set(sha, { enc: 'b64', data: toBase64(clip.bytes) });
    draftClip.value = { id: uid(), sha, type: clip.type, ms: clip.ms, w: clip.w, h: clip.h, author: user.value ?? '', at: now() };
    snipMode.value = 'capture';
  } catch (e) {
    notify(`녹화를 저장하지 못했습니다: ${(e as Error).message}`, 'error');
  } finally {
    snipRec.value = null;
  }
}

/** 대상 없이 화면 전체에 단다 */
export function addScreenComment(body = ''): string | null {
  const s = screen.peek();
  if (!s || needName()) return null;
  const a = blank(body);
  mutate((x) => {
    s.annotations.push(a);
    touchParticipant(x, user.value!);
  }, { label: 'Comment 추가' });
  selected.value = a.id;
  return a.id;
}

/* ── 핀 ──────────────────────────────────────────────────────────────── */
export function addPin(x: number, y: number, shape: 'pin' | 'nav'): string | null {
  const s = screen.peek();
  const v = version.peek();
  if (!s || !v || needName()) return null;
  const id = uid();
  const page = stagePage.peek();
  mutate((d) => {
    (s.pins ??= []).push({ id, version: v.v, x: Math.round(x), y: Math.round(y), shape, author: user.value!, at: now(), ...(page && page !== v.entry && page !== v.source?.url ? { page } : {}) });
    touchParticipant(d, user.value!);
  }, { label: shape === 'nav' ? '화살표 꽂기' : '핀 꽂기' });
  return id;
}
const pinOf = (id: string) => screen.peek()?.pins?.find((p) => p.id === id);
export function movePin(id: string, x: number, y: number): void {
  const p = pinOf(id);
  if (p) mutate(() => Object.assign(p, { x: Math.round(x), y: Math.round(y), at: now() }), { label: '핀 옮기기' });
}
export function renamePin(id: string, name: string): void {
  const p = pinOf(id);
  const v = name.trim();
  if (!p || (p.name ?? '') === v) return;
  mutate(() => {
    if (v) p.name = v;
    else delete p.name;
    p.at = now();
  }, { label: '핀 이름' });
}
export function removePin(id: string): void {
  const s = screen.peek();
  if (!s?.pins?.some((p) => p.id === id)) return;
  mutate(() => {
    s.pins = s.pins!.filter((p) => p.id !== id);
    if (!s.pins.length) delete s.pins;
  }, { label: '핀 지우기' });
  if (pinSel.peek() === id) pinSel.value = null;
}

/** 완료 체크 · 풀기 — 지우지 않고 숨긴다. 번호는 그대로 */
export function toggleDone(a: Annotation): void {
  if (needName()) return;
  const done = !a.done;
  mutate(() => setField(a, 'done', done ? { by: user.value!, at: now() } : undefined, user.value!), { label: done ? 'Comment 완료' : 'Comment 완료 풀기' });
  if (done && !showDone.peek()) {
    if (selected.peek() === a.id) selected.value = null;
    notify('완료 — 숨겼습니다 (완료 보기로 다시 봅니다)', 'info', { label: '되돌리기', run: undo });
  }
}

/** 담당 — 비우면 담당 없음 */
export function editAssignee(a: Annotation, name: string): void {
  if (needName()) return;
  const v = name.trim();
  mutate((x) => {
    setField(a, 'assignee', v || undefined, user.value!);
    if (!a.assignee) delete a.assignee;
    if (v) touchParticipant(x, v);
  }, { label: 'Comment 담당' });
}

export function editTitle(a: Annotation, title: string): void {
  if (needName()) return;
  mutate(() => setField(a, 'title', title.trim() || undefined, user.value!), { label: 'Comment 제목', merge: `title:${a.id}` });
}

export function editBody(a: Annotation, body: string): void {
  if (needName()) return;
  mutate(() => setField(a, 'body', body, user.value!), { label: 'Comment 수정', merge: `body:${a.id}` });
}

export function addReply(a: Annotation, body: string): void {
  if (!body.trim() || needName()) return;
  mutate((x) => {
    a.replies.push({ id: uid(), author: user.value!, at: now(), body });
    a.updatedAt = now();
    touchParticipant(x, user.value!);
  }, { label: '답글' });
}

export function editReply(a: Annotation, id: string, body: string): void {
  const r = a.replies.find((x) => x.id === id);
  if (!r || needName()) return;
  mutate(() => {
    r.body = body;
    a.updatedAt = now();
  }, { label: '답글 수정', merge: `reply:${id}` });
}

export function removeComment(a: Annotation): void {
  const s = screen.peek();
  if (!s) return;
  mutate(() => (s.annotations = s.annotations.filter((x) => x.id !== a.id)), { label: 'Comment 삭제' });
  if (selected.peek() === a.id) selected.value = null;
}

/** 순서 바꾸기 — to 는 보이는 카드들 사이의 자리. 숨긴(완료) Comment 사이에서도 제자리를 찾는다 */
export function reorder(id: string, to: number): void {
  const s = screen.peek();
  if (!s) return;
  const all = annotations.peek().filter((a) => a.id !== id);
  const shown = shownAnnotations.peek().filter((a) => a.id !== id);
  const before = shown[to];
  const idx = before ? all.indexOf(before) : shown.length ? all.indexOf(shown[shown.length - 1]!) + 1 : 0;
  mutate(() => moveAnnotation(s, id, idx), { label: '순서 변경' });
}

export function editNotes(text: string): void {
  const s = screen.peek();
  if (!s) return;
  mutate(() => (s.notes = text), { label: '노트 수정', merge: `notes:${s.id}` });
}

/** 화면을 문서에서 지운다 — 확인을 한 번 받는다. 지우면 옆 탭으로 */
export function deleteScreen(id: string): boolean {
  const d = doc.peek();
  const s = d.screens.find((x) => x.id === id);
  if (!s) return false;
  const n = s.annotations.length;
  if (!confirm(`${s.id} ${s.title} 화면을 지울까요?${n ? ` Comment ${n}개도 함께 지워집니다.` : ''} (Ctrl+Z 로 되돌릴 수 있습니다)`)) return false;
  const tabs = openTabs.peek();
  const at = tabs.indexOf(id);
  const wasCurrent = screenId.peek() === id;
  mutate((x) => (x.screens = x.screens.filter((y) => y.id !== id)), { label: '화면 삭제' });
  dropTab(id);
  if (wasCurrent) {
    const rest = openTabs.peek();
    const next = rest[Math.min(Math.max(0, at), rest.length - 1)] ?? doc.peek().screens[0]?.id;
    if (next) selectScreen(next);
    else screenId.value = null;
  }
  return true;
}

/* ── 자유 노트 탭 — 첫 탭은 notes(·notesTitle), 나머지는 moreNotes ─────────── */
export const MAIN_NOTE = 'main';

export function noteTabs(s: { notes: string; notesTitle?: string; moreNotes?: { id: string; title: string; body: string }[] }) {
  return [{ id: MAIN_NOTE, title: s.notesTitle || '개요', body: s.notes }, ...(s.moreNotes ?? [])];
}

export function editNoteTab(id: string, body: string): void {
  const s = screen.peek();
  if (!s) return;
  if (id === MAIN_NOTE) return editNotes(body);
  const t = s.moreNotes?.find((x) => x.id === id);
  if (t) mutate(() => (t.body = body), { label: '노트 수정', merge: `note:${s.id}:${id}` });
}

export function renameNoteTab(id: string, title: string): void {
  const s = screen.peek();
  const v = title.trim();
  if (!s || !v) return;
  mutate(() => {
    if (id === MAIN_NOTE) s.notesTitle = v === '개요' ? undefined : v;
    else {
      const t = s.moreNotes?.find((x) => x.id === id);
      if (t) t.title = v;
    }
  }, { label: '노트 이름' });
}

export function addNoteTab(): string | null {
  const s = screen.peek();
  if (!s) return null;
  const id = uid().slice(0, 8);
  mutate(() => {
    const n = (s.moreNotes?.length ?? 0) + 2;
    (s.moreNotes ??= []).push({ id, title: `노트 ${n}`, body: '' });
  }, { label: '노트 탭 추가' });
  return id;
}

/** 노트 탭 지우기 — 확인을 한 번 받는다. 첫 탭을 지우면 다음 탭이 첫 탭이 되고, 탭이 하나뿐이면 내용만 비운다 */
export function removeNoteTab(id: string): boolean {
  const s = screen.peek();
  if (!s) return false;
  const tabs = noteTabs(s);
  const t = tabs.find((x) => x.id === id);
  if (!t) return false;
  const only = tabs.length === 1;
  if (!confirm(only ? `"${t.title}" 노트의 내용을 지울까요? (Ctrl+Z 로 되돌릴 수 있습니다)` : `"${t.title}" 노트 탭을 지울까요? (Ctrl+Z 로 되돌릴 수 있습니다)`)) return false;
  mutate(() => {
    if (id === MAIN_NOTE) {
      const next = s.moreNotes?.[0];
      if (next) {
        s.notes = next.body;
        s.notesTitle = next.title;
        s.moreNotes = s.moreNotes!.slice(1);
      } else {
        s.notes = '';
        delete s.notesTitle;
      }
    } else s.moreNotes = (s.moreNotes ?? []).filter((x) => x.id !== id);
    if (!s.moreNotes?.length) delete s.moreNotes;
  }, { label: '노트 탭 삭제' });
  return true;
}

/* ── 녹화 ─────────────────────────────────────────────────────────────── */

let rec: Recorder | null = null;
const MAX_MS = 60_000;
let limit: ReturnType<typeof setTimeout> | undefined;

async function shaOf(bytes: Uint8Array): Promise<string> {
  try {
    return await sha256(bytes);
  } catch {
    // 안전하지 않은 출처에서는 crypto.subtle 이 없다 — 내용 해시 대신 무작위 열쇠
    const r = new Uint8Array(32);
    crypto.getRandomValues(r);
    return Array.from(r, (b) => b.toString(16).padStart(2, '0')).join('');
  }
}

export async function toggleRecording(): Promise<void> {
  if (rec) return stopRecording();
  if (!screen.peek() || !stageRef.frame || needName()) return;
  try {
    rec = await startRecording(stageRef.frame);
    rec.onEnded(() => stopRecording());
    recording.value = { startedAt: Date.now() };
    limit = setTimeout(() => stopRecording(), MAX_MS);
  } catch (e) {
    rec = null;
    if ((e as Error).name !== 'NotAllowedError') notify(`녹화를 시작하지 못했습니다: ${(e as Error).message}`, 'error');
  }
}

export async function stopRecording(): Promise<void> {
  const r = rec;
  if (!r) return;
  rec = null;
  clearTimeout(limit);
  recording.value = null;
  try {
    const clip = await r.stop();
    const sha = await shaOf(clip.bytes);
    blobs.set(sha, { enc: 'b64', data: toBase64(clip.bytes) }); // webm 은 이미 압축되어 있어 gzip 하지 않는다
    const c: Clip = { id: uid(), sha, type: clip.type, ms: clip.ms, w: clip.w, h: clip.h, author: user.value!, at: now() };
    const s = screen.peek()!;
    const target = s.annotations.find((a) => a.id === selected.peek() && a.version === version.peek()?.v);
    if (target) {
      mutate(() => (target.clips = [...(target.clips ?? []), c]), { label: '클립 첨부' });
      notify(`클립(${(clip.ms / 1000).toFixed(1)}초)을 ${s.annotations.filter((x) => x.version === target.version).indexOf(target) + 1}번 Comment 에 붙였습니다.`);
    } else {
      const id = addScreenComment('');
      const a = s.annotations.find((x) => x.id === id);
      if (a) mutate(() => (a.clips = [c]), { label: '클립 첨부', merge: `clip:${a.id}` });
      notify(`클립(${(clip.ms / 1000).toFixed(1)}초)으로 새 Comment 를 만들었습니다. 설명을 적어 주세요.`);
    }
  } catch (e) {
    notify(`녹화를 저장하지 못했습니다: ${(e as Error).message}`, 'error');
  }
}

export function removeClip(a: Annotation, clipId: string): void {
  mutate(() => (a.clips = (a.clips ?? []).filter((c) => c.id !== clipId)), { label: '클립 삭제' });
}

/** URL 화면의 사본을 바꾼다 — 사용자가 한 일이 아니므로 되돌리기에 남기지 않는다 */
export function applySiteSnapshot(screenId: string, v: number, snap: SiteSnap): void {
  addBlobs(snap.blobs);
  mutate((d) => {
    const ver = d.screens.find((s) => s.id === screenId)?.versions.find((x) => x.v === v);
    if (!ver) return;
    ver.entry = snap.entry;
    ver.external = snap.external;
  }, { undoable: false });
}

export function setMarkerColor(c: MarkerColor): void {
  mutate((d) => (d.meta.marker = c), { label: '마커 색' });
}
