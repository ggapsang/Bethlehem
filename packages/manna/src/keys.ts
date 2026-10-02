/* 전역 단축키 — 부모 창과 품은 화면(iframe) 양쪽에서 같은 처리를 한다
 *   Ctrl+S 저장 · Ctrl+Shift+S 다른 이름으로 · Ctrl+Z 되돌리기 · Ctrl+Shift+Z / Ctrl+Y 다시 실행
 *   Ctrl 을 누르고 있는 동안 피커 (keys 가 아니라 holdPick 으로)
 * 글을 쓰는 중(입력창·마크다운 편집기)에는 되돌리기를 그 입력창에 맡긴다.
 */
import type { Host } from './host';
import { save } from './host';
import { removeComment, removePin } from './actions';
import { pinSel, pinTool, annotations, draft, fullscreen, holdPick, mode, notify, popHidden, redo, selected, stageScale, undo, user, zoom, zoomStep } from './store';

let host: Host | null = null;
export function setKeyHost(h: Host): void {
  host = h;
}

export function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  if (!t || !t.tagName) return false;
  // 닫힌 편집기가 포커스를 쥔 채 떨어져 나갔다 — 글을 쓰는 중이 아니다 (Delete · Esc 가 먹히게)
  if (!t.isConnected) return false;
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
    } else if (k === '=' || k === '+') {
      // Ctrl+= / Ctrl+- / Ctrl+0 — 화면 배율 (테라리움 창 자체를 키우지 않는다)
      e.preventDefault();
      zoomStep(1, stageScale.peek());
    } else if (k === '-') {
      e.preventDefault();
      zoomStep(-1, stageScale.peek());
    } else if (k === '0') {
      e.preventDefault();
      zoom.value = null;
    }
    return;
  }
  // Delete — 고른 Comment 를 지운다 (되돌릴 수 있다)
  if (e.key === 'Delete' && !isTyping(e) && !e.altKey && !e.shiftKey && pinSel.peek()) {
    e.preventDefault();
    removePin(pinSel.peek()!);
    notify('핀을 지웠습니다.', 'info', { label: '되돌리기', run: undo });
    return;
  }
  if (e.key === 'Escape' && !isTyping(e) && (pinTool.peek() || pinSel.peek())) {
    pinTool.value = null;
    pinSel.value = null;
    return;
  }
  if (e.key === 'Delete' && !isTyping(e) && !e.altKey && !e.shiftKey) {
    const a = annotations.peek().find((x) => x.id === selected.peek());
    if (!a) return;
    if (!(host?.author || a.author === user.peek())) {
      notify('다른 사람이 단 Comment 는 지울 수 없습니다.', 'error');
      return;
    }
    e.preventDefault();
    removeComment(a);
    notify('Comment 를 지웠습니다.', 'info', { label: '되돌리기', run: undo });
    return;
  }
  if (e.key === 'Escape' && !isTyping(e)) {
    if (draft.peek()) draft.value = null;
    else if (selected.peek() && !popHidden.peek()) popHidden.value = true;
    else if (selected.peek()) selected.value = null;
    else if (mode.peek() === 'annotate') mode.value = 'view';
    else if (fullscreen.peek() && !inScreen) document.exitFullscreen?.().catch(() => {});
  }
}

export function onKeyUp(e: KeyboardEvent): void {
  if (e.key === 'Control' || e.key === 'Meta') holdPick.value = false;
}
