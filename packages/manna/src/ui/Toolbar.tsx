/* 툴바 — 문서 수준만 (가이드 §17: 현재 문서 → 현재 화면 → 작업 모드 → 저장). 화면에 붙은 조작은 화면 컨테이너 머리에 */
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  Circle, Moon, Pipette, MousePointer2, PanelRight, PencilLine, Redo2, Save, Square, Sun, Undo2, UserRound,
} from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import type { MarkerColor } from '@core';
import { MARKER_COLORS } from '@core';
import { setMarkerColor, toggleRecording } from '../actions';
import type { Host } from '../host';
import { canConnectFile, connectFile, save } from '../host';
import { ago } from './labels';
import {
  askName, canRedo, canUndo, dirty, doc, rev, saveState, draft, mode, mutate, panelOpen, recording, redo, screen,
  setTheme, setTitleWidth, theme, titleWidth, togglePanel, undo, user,
} from '../store';
import { Logo } from './Logo';

const ICON = { size: 20, strokeWidth: 1.5 };

export const MARKER_LABEL: Record<MarkerColor, string> = {
  auto: '자동 (배경에 맞춤)', brand: '주황', black: '검정', white: '흰색', blue: '파랑', amber: '노랑', red: '빨강',
};

export function enterFullscreen(): void {
  document.documentElement.requestFullscreen?.().catch(() => {});
}

export interface ToolbarProps {
  host: Host;
  /** 로고 옆 (Bethlehem: 새 문서·열기) */
  start?: ComponentChildren;
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
        onDblClick={() => setTitleWidth(320)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setTitleWidth(titleWidth.peek() + 24);
          if (e.key === 'ArrowLeft') setTitleWidth(titleWidth.peek() - 24);
        }}
      />
    </div>
  );
}

export function Toolbar({ host, start }: ToolbarProps) {
  rev.value; // 문서는 제자리에서 고치므로 props 가 같아도 다시 그려야 한다 (signals 의 얕은 비교를 피한다)
  const d = doc.value;
  const scr = screen.value;
  const pickLocked = mode.value === 'annotate';

  return (
    <header class="toolbar">
      <div class="tb-group tb-brand">
        <Logo />
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
          <label class="tb-ver">
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
      </div>

      <span class="grow" />

      {scr && (
        <div class="tb-group">
          <div class="seg" role="radiogroup" aria-label="모드">
            <button type="button" role="radio" aria-checked={!pickLocked} class="seg-btn" onClick={() => { mode.value = 'view'; draft.value = null; }} title="화면을 직접 조작합니다">
              <MousePointer2 {...ICON} size={16} /> 보기
            </button>
            <button type="button" role="radio" aria-checked={pickLocked} class="seg-btn" onClick={() => (mode.value = 'annotate')} title="피커 고정 — Ctrl 을 누르고 있는 동안에도 잠깐 피커가 됩니다">
              <Pipette {...ICON} size={16} /> 피커
            </button>
          </div>
        </div>
      )}

      <div class="tb-group">
        <button type="button" class="btn-icon" aria-label="되돌리기" title="되돌리기 (Ctrl+Z)" disabled={!canUndo.value} onClick={undo}><Undo2 {...ICON} /></button>
        <button type="button" class="btn-icon" aria-label="다시 실행" title="다시 실행 (Ctrl+Shift+Z)" disabled={!canRedo.value} onClick={redo}><Redo2 {...ICON} /></button>
      </div>

      <div class="tb-group">
        <button type="button" class={`btn-icon ${panelOpen.value ? 'is-on-soft' : ''}`} aria-pressed={panelOpen.value} aria-label="개요·Comment 패널" title="개요·Comment 패널 보이기/숨기기" onClick={() => togglePanel()}>
          <PanelRight {...ICON} />
        </button>
        <button type="button" class="btn-icon" aria-label="테마 전환" title={theme.value === 'light' ? '다크 테마' : '라이트 테마'} onClick={() => setTheme(theme.value === 'light' ? 'dark' : 'light')}>
          {theme.value === 'light' ? <Moon {...ICON} /> : <Sun {...ICON} />}
        </button>
        <button type="button" class="btn btn-ghost tb-user" onClick={() => (askName.value = true)} title="내 이름 바꾸기">
          <UserRound {...ICON} size={16} /> {user.value ?? '이름 입력'}
        </button>
        <SaveStatus host={host} />
        <div class="split">
          <button type="button" class="btn btn-primary split-main" onClick={() => save(host, false)} title="저장 (Ctrl+S) — 고치면 자동으로도 저장됩니다">
            <Save {...ICON} size={16} /> 저장
          </button>
          <button type="button" class="btn btn-primary split-more" onClick={() => save(host, true)} title="다른 이름으로 저장 (Ctrl+Shift+S)" aria-label="다른 이름으로 저장">
            <SaveAsIcon />
          </button>
        </div>
      </div>
    </header>
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
  if (st.kind === 'pending' || st.kind === 'saving' || dirty.value) text = '저장하는 중…';
  else if (st.kind === 'saved') text = `자동 저장됨${when ? ` · ${when}` : ''}`;
  else if (st.kind === 'local') text = '이 브라우저에 저장됨';
  else if (st.kind === 'error') text = '저장하지 못함';
  return (
    <span class={`save-status st-${st.kind}`} title={st.message ?? st.where ?? ''}>
      {text}
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
      title={rec ? '녹화 멈추기' : '화면 녹화 — 선택한 Comment 에 붙이거나, 없으면 새 Comment 를 만듭니다 (최대 60초)'}
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
        </div>
      )}
    </div>
  );
}
