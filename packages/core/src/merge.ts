/* 돌아온 문서 합치기 — 같은 문서(doc.id)의 회신본을 원본에 합친다 (docs/ARCHITECTURE.md §8.3)
 *
 * - Comment·답글은 id 로 맞춘다. 원본에 없는 것은 덧붙인다.
 * - 같은 Comment 의 본문이 다르면: 원본이 보낸 뒤로 그대로면 회신본을 쓰고, 원본도 바뀌었으면 충돌 —
 *   원본 본문은 두고 회신본 본문을 답글로 남긴다 (아무것도 잃지 않는다).
 * - 개요도 같은 규칙. 클립·달 때 화면은 합집합.
 */
import type { Annotation, BlobStore, EncodedBlob, MannaDoc } from './types';
import { now, uid } from './doc';

export interface MergeReport {
  added: number;
  updated: number;
  replies: number;
  clips: number;
  notes: number;
  conflicts: string[];
}

/** 회신본이 보내질 때의 원본 시각 — 그 뒤로 원본이 바뀌었는지 판단한다 */
function sentAt(incoming: MannaDoc): string {
  return incoming.origin?.baseUpdatedAt ?? '';
}

export function mergeDoc(base: MannaDoc, incoming: MannaDoc, baseBlobs: BlobStore, incomingBlobs: BlobStore): MergeReport {
  if (base.id !== incoming.id) throw new Error('다른 문서의 회신본입니다 (문서 id 가 다릅니다).');
  const r: MergeReport = { added: 0, updated: 0, replies: 0, clips: 0, notes: 0, conflicts: [] };
  const since = sentAt(incoming);
  const by = incoming.origin?.by ?? '수신자';
  const takeBlob = (sha: string) => {
    if (baseBlobs.has(sha)) return;
    const b = incomingBlobs.get(sha) as EncodedBlob | undefined;
    if (b) baseBlobs.set(sha, b);
  };

  for (const inc of incoming.screens) {
    const s = base.screens.find((x) => x.id === inc.id);
    if (!s) continue; // 원본에서 지운 화면 — 합치지 않는다
    const versions = new Set(s.versions.map((v) => v.v));
    const latest = Math.max(...s.versions.map((v) => v.v));

    // 자유 노트의 다른 탭 — 없는 탭은 더하고, 원본이 그대로면 회신본 내용으로
    for (const t of inc.moreNotes ?? []) {
      const mine = (s.moreNotes ??= []).find((x) => x.id === t.id);
      if (!mine) {
        s.moreNotes.push({ ...t });
        r.notes++;
      } else if (mine.body !== t.body || mine.title !== t.title) {
        if (!since || base.meta.updatedAt <= since) {
          Object.assign(mine, t);
          r.notes++;
        } else r.conflicts.push(`${s.id} 노트 "${mine.title}" — 원본도 바뀌어 원본을 남겼습니다`);
      }
    }
    if (!s.moreNotes?.length) delete s.moreNotes;
    if ((inc.notes ?? '') !== (s.notes ?? '')) {
      if (!since || base.meta.updatedAt <= since) {
        s.notes = inc.notes;
        r.notes++;
      } else {
        r.conflicts.push(`${s.id} 개요 — 원본도 바뀌어 원본을 남겼습니다`);
      }
    }

    for (const ia of inc.annotations) {
      const a = s.annotations.find((x) => x.id === ia.id);
      if (!a) {
        const copy: Annotation = JSON.parse(JSON.stringify(ia));
        if (!versions.has(copy.version)) copy.version = latest;
        s.annotations.push(copy);
        for (const c of copy.clips ?? []) takeBlob(c.sha);
        if (copy.shot) takeBlob(copy.shot.sha);
        r.added++;
        continue;
      }
      // 제목 — 작성 프로그램 쪽이 그대로면 회신본 것으로 (충돌이면 이쪽 것을 둔다)
      // 회신본이 보낸 뒤로 이 Comment 를 고치지 않았다면 다른 것은 작성자 쪽이 새로운 것이다 — 그대로 둔다
      const theyEdited = !since || ia.updatedAt > since;
      if (theyEdited && (ia.title ?? '') !== (a.title ?? '') && !(since && a.updatedAt > since)) {
        a.history.push({ at: now(), by, field: 'title', from: a.title ?? '', to: ia.title ?? '' });
        a.title = ia.title;
      }
      if (theyEdited && ia.body !== a.body) {
        const baseChanged = !!since && a.updatedAt > since;
        if (!baseChanged) {
          a.history.push({ at: now(), by, field: 'body', from: a.body, to: ia.body });
          a.body = ia.body;
          a.updatedAt = ia.updatedAt;
          r.updated++;
        } else {
          a.replies.push({ id: uid(), author: ia.author === by ? by : `${by} (병합)`, at: ia.updatedAt, body: `> 병합 충돌 — 회신본의 본문\n\n${ia.body}` });
          r.conflicts.push(`${s.id} Comment "${a.body.slice(0, 20)}…" — 양쪽이 고쳐 회신본 본문을 답글로 남겼습니다`);
        }
      }
      for (const rp of ia.replies) {
        const mine = a.replies.find((x) => x.id === rp.id);
        if (!mine) {
          a.replies.push({ ...rp });
          r.replies++;
        } else if (mine.body !== rp.body && rp.author === by) {
          mine.body = rp.body;
          r.replies++;
        }
      }
      for (const c of ia.clips ?? []) {
        if ((a.clips ?? []).some((x) => x.id === c.id)) continue;
        a.clips = [...(a.clips ?? []), c];
        takeBlob(c.sha);
        r.clips++;
      }
      if (!a.shot && ia.shot) {
        a.shot = ia.shot;
        takeBlob(ia.shot.sha);
      }
    }
  }
  for (const p of incoming.participants) if (!base.participants.some((x) => x.name === p.name)) base.participants.push({ ...p });
  base.changelog.push({ version: base.meta.version, date: now(), author: by, note: `회신 병합 — 추가 ${r.added} · 수정 ${r.updated} · 답글 ${r.replies}${r.conflicts.length ? ` · 충돌 ${r.conflicts.length}` : ''}` });
  return r;
}
