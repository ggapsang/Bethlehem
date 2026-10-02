/* 누가 → 누구에게 — "이상현 → 한재준 · 1시간 전". 담당이 없으면 쓴 사람만 */
import type { Annotation } from '@core';
import { doc, rev } from '../store';
import { ago } from './labels';

export function Who({ a }: { a: Annotation }) {
  return (
    <span class="card-meta">
      <strong class="author">{a.author}</strong>
      {a.assignee && (
        <>
          <span class="who-arrow" title="담당">→</span>
          <strong class="assignee" title="담당">{a.assignee}</strong>
        </>
      )}
      {' · '}
      {ago(a.createdAt)}
    </span>
  );
}

/** 마커 이름표 · 툴팁에 쓰는 글 */
export const whoText = (a: Annotation) => `${a.author}${a.assignee ? ` → ${a.assignee}` : ''}`;

/** 담당 칸의 고르기 목록 — 참여자 · 지금까지 쓴 사람 · 담당했던 사람 */
export function PeopleList() {
  rev.value; // 문서는 제자리에서 고친다 — 새 담당이 생기면 다시 그린다
  const d = doc.value;
  const names = new Set<string>();
  for (const p of d.participants) names.add(p.name);
  for (const s of d.screens) for (const a of s.annotations) {
    names.add(a.author);
    if (a.assignee) names.add(a.assignee);
  }
  names.delete('');
  return (
    <datalist id="terr-people">
      {[...names].sort((x, y) => x.localeCompare(y, 'ko')).map((n) => <option key={n} value={n} />)}
    </datalist>
  );
}
