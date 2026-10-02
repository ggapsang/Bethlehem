/* 마크다운 언어 — @codemirror/lang-markdown 은 HTML·CSS·JS 언어 지원까지 끌고 와(약 0.5MB) 문서마다 실리므로,
 * 같은 파서(@lezer/markdown + GFM)로 언어만 직접 만든다. 강조 규칙(styleTags)은 파서에 들어 있다.
 * 목록 이어 쓰기(Enter)도 여기서 직접 구현한다.
 */
import { Language, LanguageSupport, defineLanguageFacet } from '@codemirror/language';
import { EditorSelection, type StateCommand } from '@codemirror/state';
import { GFM, parser as base } from '@lezer/markdown';

const data = defineLanguageFacet({ commentTokens: { block: { open: '<!--', close: '-->' } } });

export const markdownLanguage = new Language(data, base.configure([GFM]), [], 'markdown');

export function markdown(): LanguageSupport {
  return new LanguageSupport(markdownLanguage);
}

const ITEM = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?/;
const QUOTE = /^(\s*>\s?)/;

/** Enter — 목록·체크박스·인용 줄이면 다음 줄에 같은 표시를 잇는다. 빈 항목에서 누르면 목록을 끝낸다 */
export const continueList: StateCommand = ({ state, dispatch }) => {
  let handled = true;
  const tr = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.head);
    const before = line.text.slice(0, range.head - line.from);
    const m = ITEM.exec(line.text) ?? QUOTE.exec(line.text);
    if (!range.empty || !m || before.length < m[0].length) {
      handled = false;
      return { range };
    }
    if (line.text.trim() === m[0].trim()) {
      // 빈 항목 — 표시를 지우고 목록에서 나온다
      return { changes: { from: line.from, to: line.to, insert: '' }, range: EditorSelection.cursor(line.from) };
    }
    let mark: string;
    if (m.length > 2 && m[2]) {
      const num = /^(\d+)([.)])$/.exec(m[2]);
      mark = `${m[1]}${num ? `${Number(num[1]) + 1}${num[2]}` : m[2]}${m[3]}${m[4] ? '[ ] ' : ''}`;
    } else mark = m[1];
    const insert = `\n${mark}`;
    return { changes: { from: range.head, insert }, range: EditorSelection.cursor(range.head + insert.length) };
  });
  if (!handled) return false;
  dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input' }));
  return true;
};
