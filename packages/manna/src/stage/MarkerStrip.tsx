/* 마커 줄 — 탭 아래. 지금 화면 버전의 Comment 번호를 늘어놓는다 ①②③…
 * 화면에 붙어 보이는 것 · 다른 상태라 지금은 안 보이는 것 · 캡처 · 화면 전체를 모양으로 가른다. 누르면 그 Comment 를 연다.
 * 그룹별로 볼 때는 패널과 같은 차례(그룹 없음 → 그룹들)로 늘어놓고 그룹 이름으로 가른다. 접힌 그룹은 이름 하나로 줄인다(누르면 편다).
 */
import { Camera, ChevronRight } from 'lucide-preact';
import type { Annotation } from '@core';
import { displayNo } from '@core';
import { toggleGroup } from '../actions';
import { commentSections } from '../groups';
import { doc, groupView, shownAnnotations, hovered, popHidden, requestReveal, rev, screen, selected, shotView, version, visible } from '../store';
import { MARK_LABEL, markState, type MarkState } from '../ui/labels';
import { plainText } from '../ui/editor/MarkdownEditor';
import { whoText } from '../ui/Who';

const ORDER: MarkState[] = ['live', 'other', 'capture', 'screen'];

/** 패널 카드와 마커 줄이 같이 쓰는 "Comment 열기" */
export function openComment(a: Annotation): void {
  const st = markState(a, visible.peek(), version.peek()?.source?.mode === 'site');
  selected.value = a.id;
  popHidden.value = false;
  shotView.value = true;
  if (st === 'other') requestReveal(a.id);
}

export function MarkerStrip() {
  rev.value;
  const scr = screen.value;
  const list = shownAnnotations.value;
  const vis = visible.value;
  if (!scr || !list.length) return null;
  const site = version.value?.source?.mode === 'site';
  const gs = doc.value.meta.groups ?? [];
  const grouped = gs.length > 0 && groupView.value;
  const sections = grouped ? commentSections(list, gs).filter((sec) => sec.cards.length) : [{ id: null, name: '', collapsed: false, cards: list }];
  const used = ORDER.filter((k) => list.some((a) => markState(a, vis, site) === k));
  const mark = (a: Annotation) => {
    const st = markState(a, vis, site);
    const on = selected.value === a.id;
    const first = plainText(a.body).split('\n').find((l) => l.trim()) ?? '';
    return (
      <button
        key={a.id}
        type="button"
        class={`mk mk-${st} ${on ? 'is-sel' : ''} ${a.done ? 'is-done' : ''}`}
        data-id={a.id}
        data-state={st}
        aria-pressed={on}
        title={`${displayNo(scr, a)} · ${whoText(a)} · ${a.done ? '완료 · ' : ''}${MARK_LABEL[st]}${first ? ` — ${first.slice(0, 60)}` : ''}`}
        onClick={() => (on && !popHidden.peek() ? (selected.value = null) : openComment(a))}
        onPointerEnter={() => (hovered.value = a.id)}
        onPointerLeave={() => (hovered.value = null)}
      >
        {st === 'capture' && <Camera size={11} strokeWidth={2} aria-hidden="true" />}
        {displayNo(scr, a)}
      </button>
    );
  };
  return (
    <div class="mk-strip" role="toolbar" aria-label="Comment 번호">
      <div class="mk-list">
        {sections.map((sec) =>
          !sec.id ? (
            sec.cards.map(mark)
          ) : sec.collapsed ? (
            <button key={sec.id} type="button" class="mk-group is-collapsed" data-group={sec.id} title={`${sec.name} — 접힌 그룹 ${sec.cards.length}개, 눌러서 펴기`} onClick={() => toggleGroup(sec.id!)}>
              <ChevronRight size={12} strokeWidth={2} aria-hidden="true" />
              {sec.name} <span class="mk-group-n">{sec.cards.length}</span>
            </button>
          ) : (
            [
              <button key={`g-${sec.id}`} type="button" class="mk-group" data-group={sec.id} title={`${sec.name} — 눌러서 접기`} onClick={() => toggleGroup(sec.id!)}>{sec.name}</button>,
              ...sec.cards.map(mark),
            ]
          ),
        )}
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
