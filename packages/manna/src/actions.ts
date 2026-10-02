/* 문서를 고치는 동작들 — 패널·툴바·스테이지가 같이 쓴다. 모두 mutate 를 거치므로 되돌릴 수 있다 */
import type { Annotation, Clip, MarkerColor, Shot } from '@core';
import { moveAnnotation, now, setField, sha256, toBase64, touchParticipant, uid } from '@core';
import type { SiteSnap } from './host';
import { startRecording, type Recorder } from './stage/record';
import {
  addBlobs, askName, blobs, draft, mutate, notify, recording, screen, selected, stagePage, stageRef, still, user, version,
} from './store';

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
export async function addFromDraft(body: string): Promise<string | null> {
  const d = draft.peek();
  const s = screen.peek();
  const v = version.peek();
  if (!d || !s || !v || !body.trim() || needName()) return null;
  const p = d.picked;
  let shot: Shot | undefined;
  const st = still.peek();
  if (st) {
    const sha = await shaOf(st.bytes);
    blobs.set(sha, { enc: 'b64', data: toBase64(st.bytes) });
    const { w, h } = v.viewport;
    shot = { sha, w: st.w, h: st.h, box: { x: p.rect[0] / w, y: p.rect[1] / h, w: p.rect[2] / w, h: p.rect[3] / h } };
  }
  const a: Annotation = {
    ...blank(body),
    anchor: { fp: p.fp, ...(p.region ? { region: p.region } : {}), trail: p.trail, props: p.props, path: p.path, ...(stagePage.peek() ? { page: stagePage.peek() } : {}) },
    ...(shot ? { shot } : {}),
  };
  mutate((x) => {
    s.annotations.push(a);
    touchParticipant(x, user.value!);
  }, { label: 'Comment 추가' });
  draft.value = null;
  selected.value = a.id;
  return a.id;
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

export function reorder(id: string, to: number): void {
  const s = screen.peek();
  if (!s) return;
  mutate(() => moveAnnotation(s, id, to), { label: '순서 변경' });
}

export function editNotes(text: string): void {
  const s = screen.peek();
  if (!s) return;
  mutate(() => (s.notes = text), { label: '개요 수정', merge: `notes:${s.id}` });
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
