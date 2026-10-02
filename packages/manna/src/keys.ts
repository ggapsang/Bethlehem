/* 전역 단축키 — 부모 창과 품은 화면(iframe) 양쪽에서 같은 처리를 한다
 *   Ctrl+S 저장 · Ctrl+Shift+S 다른 이름으로 · Ctrl+Z 되돌리기 · Ctrl+Shift+Z / Ctrl+Y 다시 실행
 *   Ctrl 을 누르고 있는 동안 피커 (keys 가 아니라 holdPick 으로)
 * 글을 쓰는 중(입력창·마크다운 편집기)에는 되돌리기를 그 입력창에 맡긴다.
 */
import type { Host } from './host';
import { save } from './host';
import { draft, fullscreen, holdPick, mode, redo, undo } from './store';

let host: Host | null = null;
export function setKeyHost(h: Host): void {
  host = h;
}

export function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  if (!t || !t.tagName) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable;
}

export function onKeyDown(e: KeyboardEvent, inScreen = false): void {
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Control' || e.key === 'Meta') {
    if (!e.repeat && !isTyping(e)) holdPick.value = true;
    return;
  }
  if (mod) {
    // Ctrl+문자 조합이면 잠깐 켠 피커는 끈다
    holdPick.value = false;
    const k = e.key.toLowerCase();
    if (k === 's') {
      e.preventDefault();
      if (host) save(host, e.shiftKey);
    } else if ((k === 'z' && !e.shiftKey) && !isTyping(e)) {
      e.preventDefault();
      undo();
    } else if (((k === 'z' && e.shiftKey) || k === 'y') && !isTyping(e)) {
      e.preventDefault();
      redo();
    }
    return;
  }
  if (e.key === 'Escape' && !isTyping(e)) {
    if (draft.peek()) draft.value = null;
    else if (mode.peek() === 'annotate') mode.value = 'view';
    else if (fullscreen.peek() && !inScreen) document.exitFullscreen?.().catch(() => {});
  }
}

export function onKeyUp(e: KeyboardEvent): void {
  if (e.key === 'Control' || e.key === 'Meta') holdPick.value = false;
}
