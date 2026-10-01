/* Leaven — 요소 지문과 찾기 (docs/ARCHITECTURE.md §6.4)
 * 어떤 Document 에도 동작한다(품은 화면 iframe 의 문서). 다른 버전으로의 재부착에도 같은 점수를 쓴다.
 */
import type { Fingerprint } from './types';

const ATTRS = ['aria-label', 'role', 'name', 'type', 'title', 'alt', 'href', 'for', 'placeholder'];
const TEXT_MAX = 80;

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/* CSS.escape 가 없는 환경(Node 테스트)을 위한 최소 구현 */
const cssEscape = (s: string) =>
  typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/([^\w-])/g, '\\$1').replace(/^(\d)/, '\\3$1 ');

function ownText(el: Element): string {
  // 큰 컨테이너는 textContent 가 화면 전체가 되므로, 자기 직속 텍스트를 우선한다
  let t = '';
  for (const n of Array.from(el.childNodes)) if (n.nodeType === 3) t += n.textContent;
  t = norm(t);
  if (!t && el.children.length <= 3) t = norm(el.textContent);
  return t.slice(0, TEXT_MAX);
}

/** 가장 가까운 id 조상부터 nth-of-type 경로 */
export function selectorOf(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1 && cur.tagName !== 'HTML') {
    if (cur.id) {
      parts.unshift(`#${cssEscape(cur.id)}`);
      break;
    }
    const tag = cur.tagName.toLowerCase();
    const parent: Element | null = cur.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const same = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(cur) + 1})` : tag);
    cur = parent;
  }
  return parts.join(' > ');
}

export function fingerprint(el: Element): Fingerprint {
  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) {
    if (ATTRS.includes(a.name) || (a.name.startsWith('data-') && a.value.length <= 60)) attrs[a.name] = a.value;
  }
  const ancestry: string[] = [];
  for (let p = el.parentElement; p && ancestry.length < 6; p = p.parentElement) if (p.id) ancestry.push(p.id);
  const text = ownText(el);
  return {
    ...(el.id ? { id: el.id } : {}),
    selector: selectorOf(el),
    tag: el.tagName.toLowerCase(),
    classes: Array.from(el.classList).slice(0, 12),
    ...(text ? { text } : {}),
    attrs,
    ancestry,
  };
}

/** 지문과 요소의 닮음 점수. 같은 요소면 대략 10 이상 */
export function score(fp: Fingerprint, el: Element): number {
  if (el.tagName.toLowerCase() !== fp.tag) return 0;
  let s = 1;
  if (fp.id && el.id === fp.id) s += 6;
  if (fp.classes.length) {
    const cls = new Set(Array.from(el.classList));
    const hit = fp.classes.filter((c) => cls.has(c)).length;
    s += (3 * hit) / Math.max(fp.classes.length, cls.size);
  }
  if (fp.text) {
    const t = ownText(el);
    if (t === fp.text) s += 3;
    else if (t && (t.startsWith(fp.text.slice(0, 20)) || fp.text.startsWith(t.slice(0, 20)))) s += 1.5;
  }
  const keys = Object.keys(fp.attrs);
  for (const k of keys) if (el.getAttribute(k) === fp.attrs[k]) s += 4 / keys.length;
  if (fp.ancestry.length) {
    const anc: string[] = [];
    for (let p = el.parentElement; p && anc.length < 6; p = p.parentElement) if (p.id) anc.push(p.id);
    if (anc[0] === fp.ancestry[0]) s += 2;
    s += fp.ancestry.filter((id) => anc.includes(id)).length / fp.ancestry.length;
  }
  try {
    if (el.ownerDocument.querySelector(fp.selector) === el) s += 3;
  } catch {
    /* 잘못된 선택자 */
  }
  return s;
}

export interface Match {
  el: Element;
  score: number;
  /** 0~1. 정확히 같은 경로·id 로 찾았으면 1 */
  confidence: number;
}

const FULL = 19; // id + 클래스 + 텍스트 + 속성 + 조상 + 선택자 + 기본점 의 대략 최대치

/** id → 선택자 → 점수 순으로 찾는다 */
export function resolve(doc: Document, fp: Fingerprint, minScore = 6): Match | null {
  if (fp.id) {
    const el = doc.getElementById(fp.id);
    if (el && el.tagName.toLowerCase() === fp.tag) return { el, score: FULL, confidence: 1 };
  }
  try {
    const el = doc.querySelector(fp.selector);
    if (el) {
      const s = score(fp, el);
      if (s >= minScore + 3) return { el, score: s, confidence: Math.min(1, s / (FULL - 6)) };
    }
  } catch {
    /* 잘못된 선택자 */
  }
  let best: Match | null = null;
  const all = doc.getElementsByTagName(fp.tag);
  const n = Math.min(all.length, 5000);
  for (let i = 0; i < n; i++) {
    const s = score(fp, all[i]);
    if (s >= minScore && (!best || s > best.score)) best = { el: all[i], score: s, confidence: 0 };
  }
  if (best) best.confidence = Math.min(1, best.score / FULL);
  return best;
}

/** 개발자에게 보여 줄 계산된 스타일 */
export function styleProps(el: Element): Record<string, string> {
  const win = el.ownerDocument.defaultView;
  if (!win) return {};
  const cs = win.getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const props: Record<string, string> = {
    크기: `${Math.round(r.width)} × ${Math.round(r.height)}`,
    글꼴: `${cs.fontWeight} ${cs.fontSize} / ${cs.lineHeight}`,
    서체: cs.fontFamily.split(',')[0].replace(/["']/g, ''),
    글자색: cs.color,
    배경: cs.backgroundColor,
  };
  if (cs.padding !== '0px') props['안쪽 여백'] = cs.padding;
  if (cs.borderRadius !== '0px') props['모서리'] = cs.borderRadius;
  if (cs.borderStyle !== 'none' && cs.borderWidth !== '0px') props['테두리'] = `${cs.borderWidth} ${cs.borderStyle} ${cs.borderColor}`;
  return props;
}

/** 지금 선택되어 있는 탭·토글의 레이블 — "어느 화면 상태에서 달았는지" 안내용 */
export function trailOf(doc: Document): string[] {
  const out: string[] = [];
  const sel = '[aria-selected="true"], [aria-pressed="true"], [aria-current]:not([aria-current="false"])';
  for (const el of Array.from(doc.querySelectorAll(sel))) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const label = norm(el.getAttribute('aria-label') || el.textContent).slice(0, 24);
    if (label && !out.includes(label)) out.push(label);
    if (out.length >= 5) break;
  }
  return out;
}
