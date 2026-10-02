/* 마커 줄 — 탭 아래. 지금 화면 버전의 Comment 번호를 늘어놓는다 ①②③…
 * 화면에 붙어 보이는 것 · 다른 상태라 지금은 안 보이는 것 · 캡처 · 화면 전체를 모양으로 가른다. 누르면 그 Comment 를 연다.
 */
import { Camera } from 'lucide-preact';
import type { Annotation } from '@core';
import { displayNo } from '@core';
import { annotations, hovered, popHidden, requestReveal, rev, screen, selected, shotView, visible } from '../store';
import { MARK_LABEL, markState, type MarkState } from '../ui/labels';
import { plainText } from '../ui/editor/MarkdownEditor';

const ORDER: MarkState[] = ['live', 'other', 'capture', 'screen'];

/** 패널 카드와 마커 줄이 같이 쓰는 "Comment 열기" */
export function openComment(a: Annotation): void {
  const st = markState(a, visible.peek());
  selected.value = a.id;
  popHidden.value = false;
  shotView.value = true;
  if (st === 'other') requestReveal(a.id);
}

export function MarkerStrip() {
  rev.value;
  const scr = screen.value;
  const list = annotations.value;
  const vis = visible.value;
  if (!scr || !list.length) return null;
  const states = list.map((a) => markState(a, vis));
  const used = ORDER.filter((k) => states.includes(k));
  return (
    <div class="mk-strip" role="toolbar" aria-label="Comment 번호">
      <div class="mk-list">
        {list.map((a, i) => {
          const st = states[i]!;
          const on = selected.value === a.id;
          const first = plainText(a.body).split('\n').find((l) => l.trim()) ?? '';
          return (
            <button
              key={a.id}
              type="button"
              class={`mk mk-${st} ${on ? 'is-sel' : ''}`}
              data-id={a.id}
              data-state={st}
              aria-pressed={on}
              title={`${displayNo(scr, a)} · ${MARK_LABEL[st]}${first ? ` — ${first.slice(0, 60)}` : ''}`}
              onClick={() => (on && !popHidden.peek() ? (selected.value = null) : openComment(a))}
              onPointerEnter={() => (hovered.value = a.id)}
              onPointerLeave={() => (hovered.value = null)}
            >
              {st === 'capture' && <Camera size={11} strokeWidth={2} aria-hidden="true" />}
              {displayNo(scr, a)}
            </button>
          );
        })}
      </div>
      <span class="grow" />
      <div class="mk-legend" aria-hidden="true">
        {used.map((k) => (
          <span key={k} class="mk-key"><span class={`mk mk-${k} mk-dot`}>{k === 'capture' ? <Camera size={9} strokeWidth={2.4} /> : null}</span>{MARK_LABEL[k]}</span>
        ))}
      </div>
    </div>
  );
}
