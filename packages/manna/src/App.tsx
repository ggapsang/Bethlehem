/* Manna 와 Bethlehem 이 같이 쓰는 화면 틀 — 툴바 · 스테이지 | 크기 조절 손잡이 | 개요·Comment 패널 */
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Host } from './host';
import { flushAutosave, scheduleAutosave } from './host';
import { onKeyDown, onKeyUp, setKeyHost } from './keys';
import { Stage } from './stage/Stage';
import {
  askName, dirty, fullscreen, holdPick, mode, panelOpen, panelWidth, rev, screen, setPanelWidth, setUser, theme,
  toast, user,
} from './store';
import { Panel } from './ui/Panel';
import { Toolbar, type ToolbarProps } from './ui/Toolbar';

export interface AppProps {
  host: Host;
  start?: ToolbarProps['start'];
  /** 탭 줄 끝 (Bethlehem: 화면 추가) */
  tabTools?: ComponentChildren;
  /** 버전 칩 옆 (Bethlehem: 새 버전) */
  versionTools?: ComponentChildren;
  /** 화면 막대 끝 (Bethlehem: 화면 지우기) */
  screenActions?: ComponentChildren;
  /** 화면이 하나도 없을 때 */
  empty?: ComponentChildren;
  /** 창 아래 (Bethlehem: 터미널) */
  bottom?: ComponentChildren;
}

const MIN_PANEL = 300;

export function App({ host, start, tabTools, versionTools, screenActions, empty, bottom }: AppProps) {
  rev.value; // 문서가 바뀌면 틀 전체를 다시 그린다 (제목·버전 등)
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme.value;
  }, [theme.value]);

  useEffect(() => {
    setKeyHost(host);
    const down = (e: KeyboardEvent) => onKeyDown(e);
    const blur = () => (holdPick.value = false);
    // Ctrl 을 뗀 신호를 놓쳐도(포커스가 화면과 오가는 사이) 마우스가 Ctrl 없이 움직이면 피커를 끈다
    const mods = (e: PointerEvent) => holdPick.peek() && !e.ctrlKey && !e.metaKey && !e.buttons && (holdPick.value = false);
    const onLeave = (e: BeforeUnloadEvent) => {
      if (host.kind === 'manna' && dirty.peek()) {
        flushAutosave(host);
        e.preventDefault();
      }
    };
    const onFs = () => (fullscreen.value = !!document.fullscreenElement);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', blur);
    window.addEventListener('pointermove', mods, true);
    window.addEventListener('beforeunload', onLeave);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', blur);
      window.removeEventListener('pointermove', mods, true);
      window.removeEventListener('beforeunload', onLeave);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, [host]);

  /* 라이브 문서 — 고치면 잠시 뒤 저장한다 */
  const r = rev.value;
  useEffect(() => {
    if (dirty.peek()) scheduleAutosave(host);
  }, [r]);
  useEffect(() => {
    const hide = () => document.visibilityState === 'hidden' && flushAutosave(host);
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, [host]);

  const full = fullscreen.value;
  const showPanel = panelOpen.value && !!screen.value;
  const width = Math.max(MIN_PANEL, Math.min(panelWidth.value, Math.round(window.innerWidth * 0.7)));

  return (
    <div class={`app ${full ? 'is-full' : ''} ${holdPick.value || mode.value === 'annotate' ? 'is-picking' : ''}`}>
      {!full && <Toolbar host={host} start={start} />}
      <div class="workspace" style={{ gridTemplateColumns: showPanel ? `1fr auto ${width}px` : '1fr' }}>
        <main class="main">
          <Stage host={host} empty={empty ?? <p class="muted">이 문서에는 아직 화면이 없습니다.</p>} tabTools={tabTools} versionTools={versionTools} screenActions={screenActions} />
        </main>
        {showPanel && <Splitter />}
        {showPanel && <Panel host={host} />}
      </div>
      {!full && bottom}
      {askName.value && <NameDialog host={host} />}
      {toast.value && (
        <div class={`toast toast-${toast.value.tone}`} role={toast.value.tone === 'error' ? 'alert' : 'status'}>
          <span>{toast.value.text}</span>
          {toast.value.action && (
            <button
              type="button"
              class="toast-btn"
              onClick={() => {
                const a = toast.value?.action;
                toast.value = null;
                a?.run();
              }}
            >
              {toast.value.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* 메인과 패널 사이 — 끌어서 패널 폭을 바꾼다. 끄는 동안 iframe 이 포인터를 가져가지 않게 막는다 */
function Splitter() {
  const onDown = (e: PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    document.body.classList.add('is-resizing');
    const move = (ev: PointerEvent) => {
      const w = Math.max(MIN_PANEL, Math.min(window.innerWidth - ev.clientX, window.innerWidth * 0.7));
      panelWidth.value = w;
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      document.body.classList.remove('is-resizing');
      setPanelWidth(panelWidth.value);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  return (
    <div
      class="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label="패널 폭 조절"
      tabIndex={0}
      onPointerDown={onDown}
      onDblClick={() => setPanelWidth(400)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') setPanelWidth(panelWidth.value + 24);
        if (e.key === 'ArrowRight') setPanelWidth(Math.max(MIN_PANEL, panelWidth.value - 24));
      }}
    />
  );
}

function NameDialog(_p: { host: Host }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const submit = (e: Event) => {
    e.preventDefault();
    const name = input.current?.value.trim();
    if (!name) return;
    setUser(name);
    askName.value = false;
  };
  return (
    <div class="modal-backdrop" onClick={(e) => e.target === e.currentTarget && user.value && (askName.value = false)}>
      <form class="modal" onSubmit={submit} aria-labelledby="name-title">
        <h2 id="name-title">이름을 알려 주세요</h2>
        <input ref={input} class="input" placeholder="예: 홍길동" defaultValue={user.value ?? ''} maxLength={40} />
        <div class="row">
          <span class="grow" />
          <button type="button" class="btn btn-ghost" onClick={() => (askName.value = false)}>
            {user.value ? '취소' : '보기만 할게요'}
          </button>
          <button type="submit" class="btn btn-primary">확인</button>
        </div>
      </form>
    </div>
  );
}
