/* 옵시디언식 라이브 미리보기 — 커서가 있는 줄만 마크다운 원문을 보이고, 나머지는 서식만 보인다.
 * 체크박스(- [ ])는 누르면 바로 토글된다. 읽기 전용 편집기에서도 체크는 된다(checkable).
 */
import { syntaxTree } from '@codemirror/language';
import { Facet, type EditorState, type Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';

/** 읽기 전용이어도 체크박스 토글을 허용할지 */
export const checkable = Facet.define<boolean, boolean>({ combine: (v) => v.some(Boolean) });

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(o: CheckboxWidget) {
    return o.checked === this.checked;
  }
  toDOM(view: EditorView) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-task';
    box.checked = this.checked;
    box.disabled = !view.state.facet(EditorView.editable) && !view.state.facet(checkable);
    box.setAttribute('aria-label', this.checked ? '완료한 할 일' : '할 일');
    box.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (box.disabled) return;
      const pos = view.posAtDOM(box);
      const text = view.state.sliceDoc(pos, pos + 3);
      if (!/^\[[ xX]\]$/.test(text)) return;
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: this.checked ? ' ' : 'x' }, userEvent: 'input.check' });
    });
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-bullet';
    s.textContent = '•';
    return s;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-hr';
    return s;
  }
}

const hidden = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });
const rule = Decoration.replace({ widget: new RuleWidget() });

function activeLines(view: EditorView): Set<number> {
  const out = new Set<number>();
  if (!view.hasFocus || !view.state.facet(EditorView.editable)) return out;
  const { doc } = view.state;
  for (const r of view.state.selection.ranges) {
    for (let l = doc.lineAt(r.from).number; l <= doc.lineAt(r.to).number; l++) out.add(l);
  }
  return out;
}

function build(view: EditorView): DecorationSet {
  const state: EditorState = view.state;
  const { doc } = state;
  const active = activeLines(view);
  const isActive = (pos: number) => active.has(doc.lineAt(pos).number);
  const out: Range<Decoration>[] = [];
  const lineClass = (pos: number, cls: string) => out.push(Decoration.line({ class: cls }).range(doc.lineAt(pos).from));
  const hide = (from: number, to: number) => from < to && out.push(hidden.range(from, to));

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        const name = node.name;
        const h = /^(?:ATX|Setext)Heading(\d)$/.exec(name);
        if (h) {
          lineClass(node.from, `cm-h cm-h${h[1]}`);
          return;
        }
        switch (name) {
          case 'HeaderMark': {
            if (isActive(node.from)) return;
            const after = state.sliceDoc(node.to, node.to + 1) === ' ' ? 1 : 0;
            hide(node.from, node.to + after);
            return;
          }
          case 'EmphasisMark':
          case 'StrikethroughMark':
          case 'LinkMark':
            if (!isActive(node.from)) hide(node.from, node.to);
            return;
          case 'CodeMark':
            if (node.node.parent?.name === 'InlineCode') {
              if (!isActive(node.from)) hide(node.from, node.to);
            } else if (!isActive(node.from)) {
              lineClass(node.from, 'cm-fence');
              hide(node.from, doc.lineAt(node.from).to);
            }
            return;
          case 'CodeInfo':
            return;
          case 'URL':
            if (node.node.parent?.name === 'Link' && !isActive(node.from)) hide(node.from, node.to);
            return;
          case 'FencedCode':
            for (let l = doc.lineAt(node.from).number; l <= doc.lineAt(node.to).number; l++) lineClass(doc.line(l).from, 'cm-codeblock');
            return;
          case 'Blockquote':
            for (let l = doc.lineAt(node.from).number; l <= doc.lineAt(node.to).number; l++) lineClass(doc.line(l).from, 'cm-quote');
            return;
          case 'QuoteMark':
            if (!isActive(node.from)) hide(node.from, node.to + (state.sliceDoc(node.to, node.to + 1) === ' ' ? 1 : 0));
            return;
          case 'ListMark': {
            const next = node.node.nextSibling;
            const isTask = next?.name === 'Task';
            const mark = state.sliceDoc(node.from, node.to);
            if (isActive(node.from)) return;
            if (isTask) hide(node.from, node.to + 1);
            else if (/^[-*+]$/.test(mark)) out.push(bullet.range(node.from, node.to));
            return;
          }
          case 'TaskMarker': {
            const checked = /x/i.test(state.sliceDoc(node.from, node.to));
            if (checked) lineClass(node.from, 'cm-done');
            if (!isActive(node.from)) out.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(node.from, node.to));
            return;
          }
          case 'HorizontalRule':
            if (!isActive(node.from)) out.push(rule.range(node.from, node.to));
            return;
        }
      },
    });
  }
  return Decoration.set(out, true);
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged || u.transactions.some((t) => t.reconfigured)) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
