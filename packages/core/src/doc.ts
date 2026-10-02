/* 문서 조작 도우미 — 순수 함수. UI 상태 관리와 무관하다 */
import type { Annotation, MannaDoc, Screen, ScreenVersion } from './types';
import { FORMAT } from './types';

export const now = () => new Date().toISOString();

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function newDoc(title = '새 화면정의서'): MannaDoc {
  const t = now();
  return {
    format: FORMAT,
    id: uid(),
    meta: { title, version: '0.1', createdAt: t, updatedAt: t },
    changelog: [],
    participants: [],
    screens: [],
  };
}

export function nextScreenId(doc: MannaDoc): string {
  const nums = doc.screens.map((s) => Number(/(\d+)$/.exec(s.id)?.[1] ?? 0));
  return `SCR-${String(Math.max(0, ...nums) + 1).padStart(3, '0')}`;
}

export function latest(screen: Screen): ScreenVersion {
  return screen.versions[screen.versions.length - 1];
}

/** 화면 버전 안에서의 순서 = 번호 (1부터) */
export function displayNo(screen: Screen, a: Annotation): number {
  return screen.annotations.filter((x) => x.version === a.version).indexOf(a) + 1;
}

/** 같은 버전의 Comment 들 사이에서 id 를 to 번째 자리로 옮긴다. 다른 버전 항목의 자리는 그대로 */
export function moveAnnotation(screen: Screen, id: string, to: number): void {
  const a = screen.annotations.find((x) => x.id === id);
  if (!a) return;
  const slots: number[] = [];
  screen.annotations.forEach((x, i) => x.version === a.version && slots.push(i));
  const order = slots.map((i) => screen.annotations[i]).filter((x) => x !== a);
  order.splice(Math.max(0, Math.min(to, order.length)), 0, a);
  slots.forEach((slot, k) => (screen.annotations[slot] = order[k]));
}

export function touchParticipant(doc: MannaDoc, name: string): void {
  if (name && !doc.participants.some((p) => p.name === name)) doc.participants.push({ name });
}

/** 필드 변경을 history 에 남기며 적용 (병합 때 필드별 최신값 판단 근거) */
export function setField<K extends keyof Annotation>(a: Annotation, field: K, value: Annotation[K], by: string): void {
  if (a[field] === value) return;
  const at = now();
  a.history.push({ at, by, field: field as string, from: a[field], to: value });
  a[field] = value;
  a.updatedAt = at;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
