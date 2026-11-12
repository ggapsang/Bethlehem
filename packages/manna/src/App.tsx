/* Manna 와 Bethlehem 이 같이 쓰는 화면 틀 — 툴바 한 줄(문서 · 탭 · 화면 조작) · 스테이지 | 오른쪽 노트·Comment 패널
 * 패널은 세 가지(panelMode): 붙여 두기(손잡이로 폭 조절) · 마우스를 대면(오른쪽 줄에 마커 번호, 대거나 패널에서 작업하는 동안만 화면 위로) · 숨김 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { EyeOff, PanelRight, Pin, PinOff } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import type { Host } from './host';
import { flushAutosave, scheduleAutosave } from './host';
import { onKeyDown, onKeyUp, setKeyHost } from './keys';
import { Stage } from './stage/Stage';
import type { WindowTools } from './stage/ScreenTabs';
import {
  askName, dirty, fullscreen, holdPick, mode, panelMode, panelWidth, rev, screen, setPanelMode, setPanelWidth, setUser, theme,
  toast, user, fullPanelPinned, setFullPanelPinned,
} from './store';
import { MarkerStrip } from './stage/MarkerStrip';
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
  /** 탭을 새 창으로 빼기 · 복제 보기 (Bethlehem) */
  windowTools?: WindowTools;
  /** 툴바 맨 앞 — 창 메뉴(파일 · 편집 · 화면 · 보기 · 도움말)를 펼친다 (Bethlehem) */
  appMenu?: ToolbarProps['appMenu'];
}

const MIN_PANEL = 300;

export function App({ host, start, tabTools, versionTools, screenActions, empty, bottom, windowTools, appMenu }: AppProps) {
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
  const has = !!screen.value;
  const pm = panelMode.value;
  /* 붙여 두기 — 화면 옆에 붙고 화면은 그만큼 줄어든다. 전체화면은 따로 (fullPanelPinned) */
  const docked = has && (full ? fullPanelPinned.value : pm === 'pin');
  /* 마우스를 대면 — 화면 위로 뜬다. 전체화면에서는 오른쪽 끝, 아니면 오른쪽 줄(마커 번호)에 */
  const floating = has && (full ? !fullPanelPinned.value : pm === 'auto');
  const rail = floating && !full;
  const width = Math.max(MIN_PANEL, Math.min(panelWidth.value, Math.round(window.innerWidth * 0.7)));
  const pinned = full ? fullPanelPinned.value : pm === 'pin';
  const setPinned = (on: boolean) => (full ? setFullPanelPinned(on) : setPanelMode(on ? 'pin' : 'auto'));
  const head = (
    <div class="panel-top">
      {/* 마커 줄 — 오른쪽 줄이 없을 때(붙여 두었거나 전체화면) 패널 머리에 */}
      {rail ? <span class="grow" /> : <MarkerStrip />}
      <button
        type="button"
        class={`btn-icon btn-xs panel-pin ${pinned ? 'is-on' : ''}`}
        aria-pressed={pinned}
        aria-label={pinned ? '패널 고정 풀기' : '패널 고정'}
        title={pinned ? '고정 풀기 — 오른쪽에 마우스를 댈 때만 뜬다' : '고정 — 화면 옆에 붙여 두고 화면은 그만큼 줄인다'}
        onClick={() => setPinned(!pinned)}
      >
        {pinned ? <PinOff size={14} strokeWidth={1.75} /> : <Pin size={14} strokeWidth={1.75} />}
      </button>
      {!full && (
        <button type="button" class="btn-icon btn-xs" aria-label="패널 숨기기" title="패널 숨기기 — 툴바의 패널 단추로 다시 연다" onClick={() => setPanelMode('hide')}>
          <EyeOff size={14} strokeWidth={1.75} />
        </button>
      )}
    </div>
  );

  return (
    <div class={`app ${full ? 'is-full' : ''} ${holdPick.value || mode.value === 'annotate' ? 'is-picking' : ''}`}>
      {!full && <Toolbar host={host} start={start} appMenu={appMenu} />}
      <div class="workspace" style={{ gridTemplateColumns: docked ? `1fr auto ${width}px` : rail ? '1fr auto' : '1fr' }}>
        <main class="main">
          <Stage host={host} empty={empty ?? <p class="muted">이 문서에는 아직 화면이 없습니다.</p>} tabTools={tabTools} versionTools={versionTools} screenActions={screenActions} windowTools={windowTools} />
        </main>
        {docked && <Splitter />}
        {docked && (
          <div class="panel-dock">
            {head}
            <Panel host={host} />
          </div>
        )}
        {floating && <FloatPanel width={width} rail={rail} head={head} host={host} />}
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

/* 마우스를 대면 뜨는 패널 — 늘 그려 두고(쓰던 글 · 스크롤 · 열어 둔 창이 그대로) 펴고 접기만 한다.
 * 펴는 때: 오른쪽 줄(전체화면이면 오른쪽 끝)이나 패널 위에 마우스가 있는 동안, 패널 안에서 글을 쓰거나 끄는 동안.
 * 오른쪽 줄의 번호를 누르면 그 Comment 가 화면에서 보이도록, 마우스가 줄을 떠날 때까지 접어 둔다 */
function FloatPanel({ width, rail, head, host }: { width: number; rail: boolean; head: ComponentChildren; host: Host }) {
  const [hover, setHover] = useState(false);
  const [work, setWork] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const on = (ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setHover(true), ms);
  };
  const off = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setHover(false), 350);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  /* 글을 쓰는 중(입력 칸 · 편집기에 포커스) — 마우스가 나가도 접지 않는다 */
  const editing = (el: Element | null) => !!el?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""], .cm-editor');
  const onFocusIn = (e: FocusEvent) => setWork(editing(e.target as Element));
  const onFocusOut = (e: FocusEvent) => {
    const to = e.relatedTarget as Element | null;
    setWork(!!to && !!box.current?.contains(to) && editing(to));
  };
  /* 쓰던 칸이 사라지면(이름 바꾸기를 마치는 등) 포커스가 빠져도 알림이 없다 — 쓰는 동안 가끔 확인한다 */
  useEffect(() => {
    if (!work) return;
    const t = setInterval(() => {
      const a = document.activeElement;
      if (!a || !box.current?.contains(a) || !editing(a)) setWork(false);
    }, 250);
    return () => clearInterval(t);
  }, [work]);
  /* 끄는 동안(카드 · 그룹 옮기기 · 폭 바꾸기) — 놓을 때까지. 누르는 그 순간에 걸어 둔다 (다시 그린 뒤에 걸면 빠른 클릭의 놓기를 놓친다) */
  const onDown = () => {
    setDragging(true);
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  };
  const open = (hover && !quiet) || work || dragging;
  return (
    <>
      {rail ? (
        <aside
          class={`panel-rail ${open ? 'is-open' : ''}`}
          aria-label="Comment 번호 — 마우스를 대면 패널이 뜬다"
          onPointerEnter={() => on(120)}
          onPointerLeave={() => {
            setQuiet(false);
            off();
          }}
          onClickCapture={(e) => (e.target as Element).closest?.('.mk') && setQuiet(true)}
        >
          <button
            type="button"
            class="btn-icon btn-xs rail-open"
            aria-label="노트·Comment 패널 붙여 두기"
            title="마우스를 대면 패널이 뜬다 — 누르면 화면 옆에 붙여 둔다"
            onClick={() => setPanelMode('pin')}
          >
            <PanelRight size={16} strokeWidth={1.75} />
          </button>
          <MarkerStrip />
        </aside>
      ) : (
        <div class="panel-hot" aria-hidden="true" onPointerEnter={() => on(0)} onPointerLeave={off} />
      )}
      <div
        ref={box}
        class={`panel-float ${rail ? 'by-rail' : ''} ${open ? 'is-open' : ''}`}
        style={{ width: `${width}px` }}
        onPointerEnter={() => on(0)}
        onPointerLeave={off}
        onPointerDown={onDown}
        onFocusIn={onFocusIn}
        onFocusOut={onFocusOut}
      >
        {head}
        <Panel host={host} />
      </div>
    </>
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
