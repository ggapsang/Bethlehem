/* 대상 옆 팝업 — 새 Comment 쓰기와 Comment 보기·답글. 시선을 오른쪽 패널로 옮기지 않아도 된다 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import { Camera, Circle, Film, Pin, Square, Trash2, X } from 'lucide-preact';
import type { Annotation, Clip } from '@core';
import { displayNo } from '@core';
import { addFromDraft, addReply, editBody, editReply, editTitle, removeClip, removeComment, toggleSnipRecording } from '../actions';
import type { Host } from '../host';
import { annotations, draft, draftClip, popHidden, rev, screen, selected, snipMode, snipRec, stageRef, still, user, version } from '../store';
import { useBlobUrl } from '../stage/media';
import { MarkdownEditor } from './editor/MarkdownEditor';
import { ago } from './labels';

const ICON = { size: 16, strokeWidth: 1.5 };
/** 기본 폭 — 클립(영상)이 있으면 훨씬 크게. 오른쪽 아래 모서리를 끌어 크기를 바꾼다 */
const W = 400;
const W_CLIP = 680;
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
  const w0 = (sel?.clips?.length ?? 0) > 0 || (d && draftClip.value) ? W_CLIP : W;

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
    const W = el.offsetWidth || w0;
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
      key={d ? 'draft' : sel?.id}
      style={{ left: `${pos?.left ?? -9999}px`, top: `${pos?.top ?? 0}px`, width: `${w0}px` }}
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
  const title = useRef('');
  const add = () => addFromDraft(text.current, title.current);
  return (
    <div class="composer" aria-label="새 Comment">
      <div class="row">
        <strong>새 Comment</strong>
        <span class="grow" />
        <button type="button" class="btn-icon btn-xs" aria-label="취소" onClick={() => (draft.value = null)}><X {...ICON} /></button>
      </div>
      <SnipBar />
      <input
        class="input title-input"
        placeholder="제목 (없어도 됩니다)"
        aria-label="Comment 제목"
        onInput={(e) => (title.current = e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add();
          if (e.key === 'Escape') draft.value = null;
        }}
      />
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

/** 영역을 그렸을 때 — 윈도우 캡처 도구처럼 캡처(기본) · 그 자리만 녹화 · 화면에 붙이기 */
function SnipBar() {
  const d = draft.value;
  const can = !!d?.picked.region && !!still.value && version.value?.source?.mode !== 'image';
  const rec = snipRec.value;
  const clip = draftClip.value;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [rec]);
  if (!can) return null;
  const m = snipMode.value;
  const sec = rec ? Math.floor((Date.now() - rec.startedAt) / 1000) : 0;
  return (
    <>
      <div class="snip-bar" role="group" aria-label="영역 Comment 방식">
        <button type="button" class="snip-btn" aria-pressed={m === 'capture'} title="그린 영역을 그림으로 남깁니다. 실시간 화면에는 마커가 붙지 않습니다." onClick={() => (snipMode.value = 'capture')}>
          <Camera {...ICON} /> 캡처
        </button>
        <button
          type="button"
          class={`snip-btn ${rec ? 'is-rec' : ''}`}
          aria-pressed={!!rec}
          title={rec ? '녹화 멈추기' : '그린 영역만 녹화합니다 (최대 30초)'}
          onClick={() => toggleSnipRecording(stageRef.snip)}
        >
          {rec ? <><Square {...ICON} size={12} fill="currentColor" /> 멈추기 {`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`}</> : <><Circle {...ICON} /> 녹화</>}
        </button>
        <button type="button" class="snip-btn" aria-pressed={m === 'pin'} title="실시간 화면의 이 자리에 마커를 붙입니다" onClick={() => (snipMode.value = 'pin')}>
          <Pin {...ICON} /> 화면에 붙이기
        </button>
      </div>
      {clip && <ClipView clip={clip} canRemove onRemove={() => (draftClip.value = null)} />}
    </>
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
        <span class="card-meta"><strong class="author">{a.author}</strong> · {ago(a.createdAt)}</span>
        <span class="grow" />
        <button type="button" class="btn-icon btn-xs" aria-label="닫기" title="팝업 닫기 (선택은 그대로)" onClick={() => (popHidden.value = true)}><X {...ICON} /></button>
      </div>
      {mine ? (
        <input
          key={`t-${a.id}`}
          class="input title-input"
          placeholder="제목 (없어도 됩니다)"
          aria-label="Comment 제목"
          defaultValue={a.title ?? ''}
          onChange={(e) => editTitle(a, e.currentTarget.value)}
        />
      ) : (
        a.title && <h3 class="detail-title">{a.title}</h3>
      )}
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
