/* Comment 내보내기 창 — 지금 화면 · 버전의 Comment 를 골라 HTML 한 장으로 (export-comments.ts) */
import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { FileOutput } from 'lucide-preact';
import { displayNo } from '@core';
import { exportComments } from '../export-comments';
import { annotations, blobs, screen, selected } from '../store';

export const exportAsk = signal(false);

const ICON = { size: 16, strokeWidth: 1.5 };

export function ExportCommentsDialog() {
  const open = exportAsk.value;
  const s = screen.value;
  const list = annotations.value;
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [clips, setClips] = useState(true);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  // 열 때 — 고른 Comment 가 있으면 그것만, 없으면 완료하지 않은 것 모두
  useEffect(() => {
    if (!open) return;
    const sel = selected.peek();
    setPick(new Set(sel && list.some((a) => a.id === sel) ? [sel] : list.filter((a) => !a.done).map((a) => a.id)));
    setBusy(false);
    setTimeout(() => first.current?.focus(), 0);
  }, [open]);
  if (!open || !s) return null;
  const chosen = list.filter((a) => pick.has(a.id));
  const clipBytes = chosen.flatMap((a) => a.clips ?? []).reduce((n, c) => n + (blobs.get(c.sha)?.data.length ?? 0) * 0.75, 0);
  const toggle = (id: string) => {
    const next = new Set(pick);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPick(next);
  };
  const close = () => !busy && (exportAsk.value = false);
  const go = async () => {
    setBusy(true);
    const ok = await exportComments(s, chosen, { clips });
    setBusy(false);
    if (ok) exportAsk.value = false;
  };
  return createPortal(
    <div class="modal-backdrop" onClick={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div class="modal export-modal" role="dialog" aria-labelledby="exp-title">
        <h2 id="exp-title"><FileOutput {...ICON} /> Comment 내보내기</h2>
        <p class="muted small">고른 Comment 만 HTML 한 장으로 — 브라우저 · 메신저 미리보기 · 메일 첨부로 바로 열립니다. 달 때 찍은 화면에 대상 박스를 그려 넣습니다.</p>
        <div class="row export-all">
          <label class="row"><input type="checkbox" checked={chosen.length === list.length && list.length > 0} onChange={(e) => setPick(new Set(e.currentTarget.checked ? list.map((a) => a.id) : []))} /> 모두</label>
          <span class="muted small">{s.id} · {chosen.length}/{list.length}개</span>
        </div>
        <ul class="export-list">
          {list.map((a, i) => (
            <li key={a.id}>
              <label class={`row ${a.done ? 'is-done' : ''}`}>
                <input type="checkbox" checked={pick.has(a.id)} onChange={() => toggle(a.id)} ref={i === 0 ? (first as never) : undefined} />
                <span class="mono">#{displayNo(s, a)}</span>
                <span class="ellipsis">{a.title || a.body.replace(/\s+/g, ' ').slice(0, 60) || '(본문 없음)'}</span>
                {a.done && <span class="muted small">완료</span>}
                {(a.clips?.length ?? 0) > 0 && <span class="muted small">영상 {a.clips!.length}</span>}
              </label>
            </li>
          ))}
        </ul>
        <label class="row">
          <input type="checkbox" checked={clips} onChange={() => setClips(!clips)} />
          녹화 영상도 넣기 {clipBytes > 0 && <span class="muted small">(약 {(clipBytes / 1048576).toFixed(1)}MB)</span>}
        </label>
        <div class="row">
          <span class="grow" />
          <button type="button" class="btn btn-ghost" onClick={close} disabled={busy}>취소</button>
          <button type="button" class="btn btn-primary" disabled={!chosen.length || busy} onClick={go}>
            {busy ? '만드는 중…' : `${chosen.length}개 내보내기`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
