/* 툴바 — 창 맨 위 한 줄. 왼쪽부터 메뉴 · 문서(작업 폴더 · 제목 · 버전) → 탭 → 화면 막대(스테이지가 채운다) → 되돌리기 · 패널 · 나 · 저장
 * (가이드 §17: 현재 문서 → 현재 화면 → 작업 모드 → 저장). 작성 프로그램에서는 창 제목 표시줄도 이 줄이 대신한다 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import {
  Circle, Cloud, CloudAlert, CloudCheck, CloudUpload, FileOutput, FolderDown, Menu, Moon, PanelRight, PanelRightClose, PanelRightDashed, PencilLine, Redo2, Save, Square, Sun, Undo2, UserRound,
} from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import type { MarkerColor } from '@core';
import { MARKER_COLORS } from '@core';
import { setMarkerColor, toggleRecording } from '../actions';
import type { Host } from '../host';
import { canConnectFile, connectFile, downloadSource, save, saveScreenOnly } from '../host';
import { ago } from './labels';
import {
  askName, barSlots, openTabs, canRedo, canUndo, dirty, doc, rev, saveState, mutate, panelMode, recording, redo, screen,
  version, markerLabels, setMarkerLabels, setPanelMode, setTheme, setTitleWidth, theme, titleWidth, undo, user, type PanelMode,
} from '../store';
import { Logo } from './Logo';

const ICON = { size: 20, strokeWidth: 1.5 };

export const MARKER_LABEL: Record<MarkerColor, string> = {
  auto: '자동 (배경에 맞춤)', brand: '주황', black: '검정', white: '흰색', blue: '파랑', amber: '노랑', red: '빨강',
};

export function enterFullscreen(): void {
  // 누른 단추에 포커스가 남으면 숨겨야 할 화면 막대가 떠 있게 된다
  (document.activeElement as HTMLElement | null)?.blur?.();
  document.documentElement.requestFullscreen?.().catch(() => {});
}

export interface ToolbarProps {
  host: Host;
  /** 로고 옆 (Bethlehem: 새 문서·열기) */
  start?: ComponentChildren;
  /** 맨 앞 메뉴 단추 — 창 메뉴를 그 자리(창 좌표)에 펼친다 (Bethlehem) */
  appMenu?: (x: number, y: number) => void;
}

/** 문서 제목 칸 — 휠로(위로 굴리면 넓게) 또는 오른쪽 끝 손잡이를 끌어 폭을 바꾼다 */
function TitleBox({ children }: { children: ComponentChildren }) {
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey) return;
    e.preventDefault();
    setTitleWidth(titleWidth.peek() + (e.deltaY < 0 ? 24 : -24));
  };
  const onGrip = (e: PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const w0 = titleWidth.peek();
    const move = (ev: PointerEvent) => setTitleWidth(w0 + ev.clientX - x0);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  return (
    <div class="tb-titlebox" style={{ width: `${titleWidth.value}px` }} onWheel={onWheel} title="휠이나 오른쪽 끝을 끌어 폭을 바꿉니다">
      {children}
      <span
        class="tb-title-grip"
        role="separator"
        aria-orientation="vertical"
        aria-label="제목 칸 폭 조절"
        tabIndex={0}
        onPointerDown={onGrip}
        onDblClick={() => setTitleWidth(240)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setTitleWidth(titleWidth.peek() + 24);
          if (e.key === 'ArrowLeft') setTitleWidth(titleWidth.peek() - 24);
        }}
      />
    </div>
  );
}

export function Toolbar({ host, start, appMenu }: ToolbarProps) {
  rev.value; // 문서는 제자리에서 고치므로 props 가 같아도 다시 그려야 한다 (signals 의 얕은 비교를 피한다)
  const d = doc.value;
  /* 탭 · 화면 막대가 들어올 자리 — 스테이지가 이 자리로 그린다 */
  const tabsSlot = useRef<HTMLDivElement>(null);
  const screenSlot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    barSlots.value = { tabs: tabsSlot.current, screen: screenSlot.current };
    return () => {
      barSlots.value = { tabs: null, screen: null };
    };
  }, []);
  /* 줄 폭 — 좁아지면 덜 중요한 것부터 줄인다 (styles.css .toolbar.is-narrow · is-tight · is-cramped).
     탭이 가장 좁게 줄어도 넘치면 한 단계씩 더 줄인다 (폭이나 탭 수가 바뀌면 다시 잰다) */
  const bar = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      setWidth(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  openTabs.value; // 탭 수가 바뀌면 다시 잰다
  const [bump, setBump] = useState(0);
  const level = !width ? 0 : Math.min(3, (width < 1060 ? 3 : width < 1320 ? 2 : width < 1500 ? 1 : 0) + bump);
  /* 한 단계 줄일 때 탭 자리가 얼마나 늘었나 — 다시 펼 수 있는지 가늠한다 (돌아가기 칩처럼 잠깐 생긴 것이 사라지면 다시 편다) */
  const freed = useRef<number[]>([]);
  const prev = useRef<{ level: number; avail: number } | null>(null);
  useLayoutEffect(() => {
    const slot = tabsSlot.current;
    const strip = slot?.querySelector<HTMLElement>('.tabs-strip');
    if (!slot || !strip) return;
    const tools = slot.querySelector<HTMLElement>('.tabs-tools');
    const avail = slot.clientWidth - (tools?.offsetWidth ?? 0) - 12;
    const p = prev.current;
    if (p && level === p.level + 1) freed.current[p.level] = Math.max(0, avail - p.avail);
    prev.current = { level, avail };
    const need = strip.querySelectorAll('.tab').length * 98; // 탭 하나가 가장 좁을 때 (styles.css .toolbar .tab min-width + 틈)
    if (avail < need && level < 3) setBump((b) => b + 1);
    else if (bump > 0 && freed.current[level - 1] != null && avail - freed.current[level - 1] >= need + 8) setBump((b) => b - 1);
  });
  const fit = ['', 'is-narrow', 'is-narrow is-tight', 'is-narrow is-tight is-cramped'][level];

  return (
    <header class={`toolbar ${fit}`} ref={bar}>
      {appMenu && (
        <button
          type="button"
          class="btn-icon tb-menu"
          aria-label="메뉴"
          title="메뉴 — 파일 · 편집 · 화면 · 보기 · 도움말"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            appMenu(Math.round(r.left), Math.round(r.bottom));
          }}
        >
          <Menu {...ICON} size={18} />
        </button>
      )}
      <Logo size={20} />
      {start}
      <TitleBox>
        {host.author ? (
          <input
            class="tb-title input-bare"
            aria-label="문서 제목"
            title={d.meta.title}
            value={d.meta.title}
            onChange={(e) => mutate((x) => (x.meta.title = e.currentTarget.value || '제목 없음'), { label: '제목 변경' })}
          />
        ) : (
          <h1 class="tb-title" title={d.meta.title}>{d.meta.title}</h1>
        )}
      </TitleBox>
      {host.author ? (
        <label class="tb-ver" title="문서 버전">
          v
          <input
            class="input-bare"
            aria-label="문서 버전"
            value={d.meta.version}
            onChange={(e) => mutate((x) => (x.meta.version = e.currentTarget.value || '0.1'), { label: '버전 변경' })}
          />
        </label>
      ) : (
        <span class="tb-ver">v{d.meta.version}</span>
      )}

      <div class="tb-slot tb-slot-tabs" ref={tabsSlot} />
      <div class="tb-slot tb-slot-screen" ref={screenSlot} />

      <div class="tb-group tb-end">
        <button type="button" class="btn-icon" aria-label="되돌리기" title="되돌리기 (Ctrl+Z)" disabled={!canUndo.value} onClick={undo}><Undo2 {...ICON} /></button>
        <button type="button" class="btn-icon" aria-label="다시 실행" title="다시 실행 (Ctrl+Shift+Z)" disabled={!canRedo.value} onClick={redo}><Redo2 {...ICON} /></button>
        <PanelMenu />
        <UserMenu />
        <SaveStatus host={host} />
        <div class="split">
          <button type="button" class="btn btn-primary split-main" aria-label="저장" onClick={() => save(host, false)} title="저장 (Ctrl+S) — 고치면 자동으로도 저장됩니다">
            <Save {...ICON} size={16} />
          </button>
          <SaveMenu host={host} />
        </div>
      </div>
    </header>
  );
}

/** 펼침 메뉴 공용 — 밖을 누르거나 Esc 면 닫는다 */
function usePop(): [boolean, (o: boolean) => void, { current: HTMLDivElement | null }] {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  return [open, setOpen, ref];
}

const PANEL_MODES: { m: PanelMode; label: string; note: string }[] = [
  { m: 'pin', label: '붙여 두기', note: '화면 옆에 늘 — 화면은 그만큼 줄어든다' },
  { m: 'auto', label: '마우스를 대면', note: '오른쪽 줄에 대거나 패널에서 작업하는 동안만 화면 위로' },
  { m: 'hide', label: '숨기기', note: '화면을 가장 넓게' },
];

/** 노트·Comment 패널 — 붙여 두기 · 마우스를 대면 · 숨기기 */
function PanelMenu() {
  const [open, setOpen, ref] = usePop();
  const m = panelMode.value;
  const Icon = m === 'pin' ? PanelRight : m === 'auto' ? PanelRightDashed : PanelRightClose;
  return (
    <div class="popover-wrap" ref={ref}>
      <button
        type="button"
        class={`btn-icon ${m === 'pin' ? 'is-on-soft' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="노트·Comment 패널"
        title={`노트·Comment 패널 — ${PANEL_MODES.find((x) => x.m === m)!.label}`}
        onClick={() => setOpen(!open)}
      >
        <Icon {...ICON} />
      </button>
      {open && (
        <div class="popover" role="menu" aria-label="노트·Comment 패널">
          {PANEL_MODES.map((x) => (
            <button key={x.m} type="button" role="menuitemradio" aria-checked={m === x.m} class="popover-item panel-mode" onClick={() => { setPanelMode(x.m); setOpen(false); }}>
              <span class={`checkmark ${m === x.m ? 'is-on' : ''}`}>{m === x.m ? '✓' : ''}</span>
              <span class="panel-mode-text"><span>{x.label}</span><span class="muted small">{x.note}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 나 — 이름(Comment 에 남는다) · 테마 */
function UserMenu() {
  const [open, setOpen, ref] = usePop();
  const name = user.value;
  return (
    <div class="popover-wrap" ref={ref}>
      <button
        type="button"
        class="btn btn-ghost tb-user"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="내 이름 · 테마"
        title={`${name ?? '이름 없음'} — 이름 바꾸기 · 테마`}
        onClick={() => setOpen(!open)}
      >
        <UserRound {...ICON} size={16} /> <span class="tb-user-name">{name ?? '이름 입력'}</span>
      </button>
      {open && (
        <div class="popover" role="menu" aria-label="내 이름 · 테마">
          <button type="button" role="menuitem" class="popover-item" onClick={() => { setOpen(false); askName.value = true; }}>
            <UserRound {...ICON} size={16} /> 이름 바꾸기… <span class="grow" /><span class="muted small ellipsis">{name ?? ''}</span>
          </button>
          <button type="button" role="menuitem" class="popover-item" aria-label="테마 전환" onClick={() => { setTheme(theme.value === 'light' ? 'dark' : 'light'); setOpen(false); }}>
            {theme.value === 'light' ? <Moon {...ICON} size={16} /> : <Sun {...ICON} size={16} />} {theme.value === 'light' ? '다크 테마로' : '라이트 테마로'}
          </button>
        </div>
      )}
    </div>
  );
}

/** 저장 옆 단추 — 펼치면 다른 이름으로 저장 · 현재 탭만 저장 */
function SaveMenu({ host }: { host: Host }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  const scr = screen.value;
  const isSite = version.value?.source?.mode === 'site';
  return (
    <div class="popover-wrap" ref={ref}>
      <button type="button" class="btn btn-primary split-more" aria-haspopup="true" aria-expanded={open} aria-label="저장 방식" title="다른 이름으로 저장 · 현재 탭만 저장" onClick={() => setOpen(!open)}>
        <SaveAsIcon />
      </button>
      {open && (
        <div class="popover save-menu" role="menu" aria-label="저장 방식">
          <button type="button" role="menuitem" class="popover-item" aria-label="다른 이름으로 저장" onClick={() => { setOpen(false); save(host, true); }}>
            <SaveAsIcon /> 다른 이름으로 저장… <span class="grow" /><span class="muted small">Ctrl+Shift+S</span>
          </button>
          <button type="button" role="menuitem" class="popover-item" aria-label="현재 탭만 저장" disabled={!scr} onClick={() => { setOpen(false); saveScreenOnly(host); }}>
            <FileOutput {...ICON} size={16} /> 현재 탭만 저장…{scr && <span class="muted small ellipsis"> {scr.id} {scr.title}</span>}
          </button>
          <div class="popover-sep" />
          <button
            type="button"
            role="menuitem"
            class="popover-item"
            aria-label="원본 파일 내려받기"
            disabled={!scr || (isSite && !host.site && !version.value?.external.length)}
            title={isSite ? '지금 이 페이지의 DOM(그 순간의 모습)을 CSS · 글꼴 · 그림까지 넣어 파일 하나로 열리는 HTML 로. 스크립트는 빠진다' : '지금 화면 · 버전의 HTML · CSS · JS · 데이터 · 그림을 원래 폴더 모양 그대로 zip 으로'}
            onClick={() => { setOpen(false); downloadSource(); }}
          >
            <FolderDown {...ICON} size={16} /> {isSite ? 'DOM 사본 내려받기 (HTML)' : '원본 파일 내려받기 (zip)'}
          </button>
        </div>
      )}
    </div>
  );
}

/** 다른 이름으로 저장 — 오피스처럼 디스켓에 연필 */
function SaveAsIcon() {
  return (
    <span class="saveas-icon" aria-hidden="true">
      <Save {...ICON} size={16} />
      <PencilLine class="saveas-pen" size={11} strokeWidth={2.2} />
    </span>
  );
}

/** 자동 저장 상태 — 어디까지 저장됐는지 */
function SaveStatus({ host }: { host: Host }) {
  const st = saveState.value;
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);
  const when = st.at ? ago(new Date(st.at).toISOString()) : '';
  let text = '';
  const busy = st.kind === 'pending' || st.kind === 'saving' || dirty.value;
  if (busy) text = '저장하는 중…';
  else if (st.kind === 'saved') text = `자동 저장됨${when ? ` · ${when}` : ''}`;
  else if (st.kind === 'local') text = '이 브라우저에 저장됨';
  else if (st.kind === 'error') text = '저장하지 못함';
  /* 한 줄에 맞게 — 평소에는 표시 하나(마우스를 대면 글), 저장하지 못했을 때만 글로 */
  const Icon = st.kind === 'error' ? CloudAlert : busy ? CloudUpload : st.kind === 'idle' ? Cloud : CloudCheck;
  return (
    <span class={`save-status st-${busy ? 'pending' : st.kind}`} title={[text, st.message ?? st.where].filter(Boolean).join(' — ')}>
      <Icon {...ICON} size={16} aria-hidden="true" />
      <span class="save-text">{text}</span>
      {host.kind === 'manna' && st.kind === 'local' && canConnectFile() && (
        <button type="button" class="link-btn" onClick={() => connectFile()} title="이 문서 파일을 한 번 지정하면 그 뒤로는 파일에도 자동으로 저장됩니다">파일에도 자동 저장</button>
      )}
    </span>
  );
}

export function RecordButton() {
  const rec = recording.value;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [rec]);
  const sec = rec ? Math.floor((Date.now() - rec.startedAt) / 1000) : 0;
  return (
    <button
      type="button"
      class={`btn-icon ${rec ? 'is-rec' : ''}`}
      aria-pressed={!!rec}
      aria-label={rec ? '녹화 멈추기' : '화면 녹화'}
      title={rec ? '녹화 멈추기' : '화면 녹화 — 조작(커서 · 클릭 · 키 입력)까지 함께, 길이에 매이지 않고. 멈추면 편집기에서 구간(최대 1분)을 잘라 새 Comment · 쓰고 있는 Comment · 이미 있는 Comment 에 넣습니다'}
      onClick={toggleRecording}
    >
      {rec ? <><Square {...ICON} size={14} fill="currentColor" /><span class="rec-time">{`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`}</span></> : <Circle {...ICON} />}
    </button>
  );
}

export function MarkerColorPicker() {
  rev.value;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const cur = doc.value.meta.marker ?? 'auto';
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div class="popover-wrap" ref={ref}>
      <button type="button" class="btn-icon" aria-haspopup="true" aria-expanded={open} aria-label="마커 색" title={`마커 색 — ${MARKER_LABEL[cur]}`} onClick={() => setOpen(!open)}>
        <span class={`swatch swatch-${cur}`} />
      </button>
      {open && (
        <div class="popover" role="menu" aria-label="마커 색">
          {MARKER_COLORS.map((c) => (
            <button key={c} type="button" role="menuitemradio" aria-checked={cur === c} class="popover-item" onClick={() => { setMarkerColor(c); setOpen(false); }}>
              <span class={`swatch swatch-${c}`} /> {MARKER_LABEL[c]}
            </button>
          ))}
          <div class="popover-sep" />
          <button type="button" role="menuitemcheckbox" aria-checked={markerLabels.value} class="popover-item" onClick={() => setMarkerLabels(!markerLabels.value)}>
            <span class={`checkmark ${markerLabels.value ? 'is-on' : ''}`}>{markerLabels.value ? '✓' : ''}</span> 번호 옆에 제목 · 이름 보이기
          </button>
        </div>
      )}
    </div>
  );
}
