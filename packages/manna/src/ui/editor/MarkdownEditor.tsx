/* 마크다운 편집기 — Comment 본문, 답글, 화면 설명이 모두 이것을 쓴다 */
import { useEffect, useRef } from 'preact/hooks';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorSelection, EditorState, type StateCommand } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { checkable, livePreview } from './livePreview';
import { continueList, markdown } from './markdownLang';

export interface EditorProps {
  value: string;
  onChange?: (value: string) => void;
  editable?: boolean;
  /** 읽기 전용이어도 체크박스는 누를 수 있게 */
  allowCheck?: boolean;
  placeholder?: string;
  minRows?: number;
  autoFocus?: boolean;
  onSubmit?: () => void;
  onEscape?: () => void;
  label?: string;
  class?: string;
}

const highlight = HighlightStyle.define([
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.92em', backgroundColor: 'var(--bg-hover)', borderRadius: '4px' },
  { tag: tags.link, color: 'var(--accent-text)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--text-tertiary)' },
  { tag: tags.heading, fontWeight: '700' },
  { tag: tags.quote, color: 'var(--text-secondary)' },
  { tag: [tags.processingInstruction, tags.contentSeparator], color: 'var(--text-tertiary)' },
]);

/** 선택 영역을 기호로 감싸거나 푼다 (Ctrl+B 굵게, Ctrl+I 기울임) */
function wrap(mark: string): StateCommand {
  return ({ state, dispatch }) => {
    const tr = state.changeByRange((r) => {
      const text = state.sliceDoc(r.from, r.to);
      const before = state.sliceDoc(r.from - mark.length, r.from);
      const after = state.sliceDoc(r.to, r.to + mark.length);
      if (before === mark && after === mark) {
        return {
          changes: [{ from: r.from - mark.length, to: r.from }, { from: r.to, to: r.to + mark.length }],
          range: EditorSelection.range(r.from - mark.length, r.to - mark.length),
        };
      }
      return {
        changes: { from: r.from, to: r.to, insert: mark + text + mark },
        range: EditorSelection.range(r.from + mark.length, r.to + mark.length),
      };
    });
    dispatch(state.update(tr, { userEvent: 'input.format' }));
    return true;
  };
}

export function MarkdownEditor(p: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const props = useRef(p);
  props.current = p;
  const conf = useRef({ editable: new Compartment(), check: new Compartment() });
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const flush = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const v = view.current;
    if (v && props.current.onChange) {
      const text = v.state.doc.toString();
      if (text !== props.current.value) props.current.onChange(text);
    }
  };

  useEffect(() => {
    const editable = p.editable !== false;
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: p.value,
        extensions: [
          history(),
          keymap.of([
            { key: 'Mod-Enter', run: () => (flush(), props.current.onSubmit?.(), !!props.current.onSubmit) },
            { key: 'Escape', run: () => (flush(), props.current.onEscape?.(), !!props.current.onEscape) },
            { key: 'Mod-b', run: wrap('**') },
            { key: 'Mod-i', run: wrap('*') },
            { key: 'Enter', run: continueList },
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          markdown(),
          syntaxHighlighting(highlight),
          livePreview,
          EditorView.lineWrapping,
          conf.current.editable.of([EditorView.editable.of(editable), EditorState.readOnly.of(!editable)]),
          conf.current.check.of(checkable.of(!!p.allowCheck)),
          p.placeholder ? placeholderExt(p.placeholder) : [],
          EditorView.contentAttributes.of({ 'aria-label': p.label ?? '마크다운 편집기' }),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            // 체크박스 토글은 바로, 타이핑은 잠깐 모아서 문서에 반영한다
            if (u.transactions.some((t) => t.isUserEvent('input.check'))) return flush();
            clearTimeout(timer.current);
            timer.current = setTimeout(flush, 400);
          }),
          EditorView.domEventHandlers({ blur: () => flush() }),
        ],
      }),
    });
    view.current = v;
    if (p.autoFocus) requestAnimationFrame(() => v.focus());
    return () => {
      flush();
      v.destroy();
      view.current = null;
    };
  }, []);

  /* 밖에서 값이 바뀌면(되돌리기·다른 항목 선택) 편집기 내용도 바꾼다 */
  useEffect(() => {
    const v = view.current;
    if (!v || timer.current) return;
    const cur = v.state.doc.toString();
    if (cur !== p.value) v.dispatch({ changes: { from: 0, to: cur.length, insert: p.value } });
  }, [p.value]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const editable = p.editable !== false;
    v.dispatch({
      effects: [
        conf.current.editable.reconfigure([EditorView.editable.of(editable), EditorState.readOnly.of(!editable)]),
        conf.current.check.reconfigure(checkable.of(!!p.allowCheck)),
      ],
    });
  }, [p.editable, p.allowCheck]);

  return (
    <div
      ref={host}
      class={`md-editor ${p.editable === false ? 'is-readonly' : ''} ${p.class ?? ''}`}
      style={{ '--md-min-rows': String(p.minRows ?? 1) }}
    />
  );
}

/** 접힌 카드 미리보기용 — 마크다운 기호를 걷어낸 한두 줄 */
export function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+\[( |x|X)\]\s+/gm, (_m, c) => (c === ' ' ? '☐ ' : '☑ '))
    .replace(/^\s*([-*+]|\d+\.)\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|~~|`)/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
