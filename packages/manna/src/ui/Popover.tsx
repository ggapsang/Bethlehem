/* 대상 옆 팝업 — 새 Comment 쓰기와 Comment 보기·답글. 시선을 오른쪽 패널로 옮기지 않아도 된다 */
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import { Film, Trash2, X } from 'lucide-preact';
import type { Annotation, Clip } from '@core';
import { displayNo } from '@core';
import { addFromDraft, addReply, editBody, editReply, removeClip, removeComment } from '../actions';
import type { Host } from '../host';
import { annotations, draft, popHidden, rev, screen, selected, user, version } from '../store';
import { useBlobUrl } from '../stage/media';
import { MarkdownEditor } from './editor/MarkdownEditor';
import { ago } from './labels';

const ICON = { size: 16, strokeWidth: 1.5 };
const W = 380;
const GAP = 12;

type Box = { x: number; y: number; w: number; h: number };

export interface PopoverProps {
  host: Host;
  fit: { s: number; ox: number; oy: number };
  /** 대상 — 화면 뷰포트 좌표. 없으면 스테이지 오른쪽 위 */
  target: Box | null;
  areaRef: RefObject<HTMLDivElement>;
}

export function StagePopover({ host, fit, target, areaRef }: PopoverProps) {
  rev.value;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; side: string } | null>(null);
  const d = draft.value;
  const sel = !d && !popHidden.value ? annotations.value.find((a) => a.id === selected.value) ?? null : null;
  const v = version.value;
  const open = !!d || !!sel;

  useLayoutEffect(() => {
    const area = areaRef.current;
    const el = ref.current;
    if (!open || !area || !el || !v) return setPos(null);
    // 확대해 스크롤했으면 보이는 자리 안에 둔다
    const sl = area.scrollLeft;
    const st = area.scrollTop;
    const aw = area.clientWidth;
    const ah = area.clientHeight;
    const ph = el.offsetHeight;
    const { s, ox, oy } = fit;
    let left: number;
    let top: number;
    let side = 'right';
    if (target) {
      const tx = ox + target.x * s;
      const ty = oy + target.y * s;
      const tw = target.w * s;
      const th = target.h * s;
      if (tx + tw + GAP + W <= sl + aw - 8) left = tx + tw + GAP;
      else if (tx - GAP - W >= sl + 8) {
        left = tx - GAP - W;
        side = 'left';
      } else {
        left = Math.min(Math.max(sl + 8, tx), sl + aw - W - 8);
        side = 'below';
      }
      top = side === 'below' ? ty + th + GAP : ty;
    } else {
      left = ox + v.viewport.w * s - W - GAP;
      top = oy + GAP;
      side = 'corner';
    }
    top = Math.min(Math.max(st + 8, top), Math.max(st + 8, st + ah - ph - 8));
    left = Math.min(Math.max(sl + 8, left), sl + aw - W - 8);
    setPos((old) => (old && Math.abs(old.left - left) < 1 && Math.abs(old.top - top) < 1 && old.side === side ? old : { left, top, side }));
  });

  if (!open) return null;
  return (
    <div
      ref={ref}
      class={`popover-card pop-${pos?.side ?? 'right'}`}
      style={{ left: `${pos?.left ?? -9999}px`, top: `${pos?.top ?? 0}px`, width: `${W}px` }}
      role="dialog"
      aria-label={d ? '새 Comment' : 'Comment'}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {d ? <Composer /> : sel && <Detail key={sel.id} a={sel} host={host} />}
    </div>
  );
}

function Composer() {
  const text = useRef('');
  const add = () => addFromDraft(text.current);
  return (
    <div class="composer" aria-label="새 Comment">
      <div class="row">
        <strong>새 Comment</strong>
        <span class="grow" />
        <button type="button" class="btn-icon btn-xs" aria-label="취소" onClick={() => (draft.value = null)}><X {...ICON} /></button>
      </div>
      <MarkdownEditor
        value=""
        minRows={6}
        autoFocus
        onChange={(t) => (text.current = t)}
        onSubmit={add}
        onEscape={() => (draft.value = null)}
        placeholder="Comment"
        label="새 Comment 본문"
        class="body-editor"
      />
      <div class="row">
        <span class="grow" />
        <button type="button" class="btn btn-ghost" onClick={() => (draft.value = null)}>취소</button>
        <button type="button" class="btn btn-primary" onClick={add}>추가</button>
      </div>
    </div>
  );
}

export function Detail({ a, host }: { a: Annotation; host: Host }) {
  rev.value; // 문서는 제자리에서 고치므로 props 가 같아도 다시 그려야 한다
  const me = user.value ?? '';
  const mine = a.author === me || host.author;
  const reply = useRef('');
  const [replyKey, setReplyKey] = useState(0);
  const scr = screen.value!;

  const send = () => {
    if (!reply.current.trim()) return;
    addReply(a, reply.current);
    reply.current = '';
    setReplyKey((k) => k + 1);
  };

  return (
    <div class="detail">
      <div class="row detail-head">
        <span class={`no ${a.anchor ? '' : 'no-screen'}`}>{displayNo(scr, a)}</span>
        <span class="card-meta">{a.author} · {ago(a.createdAt)}</span>
        <span class="grow" />
        <button type="button" class="btn-icon btn-xs" aria-label="닫기" title="팝업 닫기 (선택은 그대로)" onClick={() => (popHidden.value = true)}><X {...ICON} /></button>
      </div>
      <MarkdownEditor
        key={a.id}
        value={a.body}
        editable={mine}
        allowCheck
        minRows={5}
        autoFocus={mine && !a.body}
        onChange={(t) => editBody(a, t)}
        placeholder={mine ? 'Comment' : ''}
        label={`${a.id} Comment 본문`}
        class="body-editor"
      />
      {(a.clips ?? []).map((c) => <ClipView key={c.id} clip={c} canRemove={c.author === me || host.author} onRemove={() => removeClip(a, c.id)} />)}
      {a.replies.length > 0 && (
        <ol class="replies">
          {a.replies.map((r) => (
            <li key={r.id} class="reply">
              <span class="reply-meta">{r.author} · {ago(r.at)}</span>
              <MarkdownEditor value={r.body} editable={r.author === me} allowCheck onChange={(t) => editReply(a, r.id, t)} label="답글" />
            </li>
          ))}
        </ol>
      )}
      <div class="reply-box">
        <MarkdownEditor
          key={replyKey}
          value=""
          minRows={2}
          onChange={(t) => (reply.current = t)}
          onSubmit={send}
          placeholder="답글"
          label="답글 쓰기"
          class="reply-editor"
        />
        <div class="row">
          {mine && (
            <button type="button" class="btn btn-ghost btn-danger" onClick={() => confirm('이 Comment 를 지울까요? 답글도 함께 지워집니다. (Ctrl+Z 로 되돌릴 수 있습니다)') && removeComment(a)}>
              <Trash2 {...ICON} /> 삭제
            </button>
          )}
          <span class="grow" />
          <button type="button" class="btn btn-secondary" onClick={send}>답글</button>
        </div>
      </div>
    </div>
  );
}

function ClipView({ clip, canRemove, onRemove }: { clip: Clip; canRemove: boolean; onRemove: () => void }) {
  const src = useBlobUrl(clip.sha, clip.type);
  return (
    <figure class="clip">
      {src ? <video src={src} controls loop muted playsInline style={{ aspectRatio: `${clip.w} / ${clip.h}` }} /> : <div class="clip-missing">클립을 불러오는 중…</div>}
      <figcaption class="row muted small">
        <Film {...ICON} size={14} /> {(clip.ms / 1000).toFixed(1)}초 · {clip.author}
        <span class="grow" />
        {canRemove && <button type="button" class="btn-icon btn-xs" aria-label="클립 지우기" onClick={onRemove}><X {...ICON} size={14} /></button>}
      </figcaption>
    </figure>
  );
}
