/* 툴바 — 문서·화면·버전, 피커, 일시정지, 녹화, 마커 색, 되돌리기, 패널·전체화면, 테마, 저장 */
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  Circle, Crosshair, Maximize2, Moon, MousePointer2, PanelRight, Pause, Play, Redo2, Save, Square, Sun, Undo2, UserRound,
} from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import type { MarkerColor } from '@core';
import { MARKER_COLORS } from '@core';
import { setMarkerColor, toggleRecording } from '../actions';
import type { Host } from '../host';
import { save } from '../host';
import {
  askName, canRedo, canUndo, dirty, doc, rev, draft, mode, mutate, panelOpen, paused, recording, redo, screen, selectScreen,
  setTheme, theme, togglePanel, undo, user, version,
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
  /** 화면 선택 옆 (Bethlehem: 화면 추가·URL·새 버전·삭제) */
  screenTools?: ComponentChildren;
}

export function Toolbar({ host, start, screenTools }: ToolbarProps) {
  rev.value; // 문서는 제자리에서 고치므로 props 가 같아도 다시 그려야 한다 (signals 의 얕은 비교를 피한다)
  const d = doc.value;
  const scr = screen.value;
  const v = version.value;
  const pickLocked = mode.value === 'annotate';

  return (
    <header class="toolbar">
      <div class="tb-group tb-brand">
        <Logo />
        {start}
        {host.author ? (
          <input
            class="tb-title input-bare"
            aria-label="문서 제목"
            value={d.meta.title}
            onChange={(e) => mutate((x) => (x.meta.title = e.currentTarget.value || '제목 없음'), { label: '제목 변경' })}
          />
        ) : (
          <h1 class="tb-title" title={d.meta.title}>{d.meta.title}</h1>
        )}
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

      <div class="tb-group tb-screen">
        {scr && (
          <select class="input input-sm" aria-label="화면" value={scr.id} onChange={(e) => selectScreen(e.currentTarget.value)}>
            {d.screens.map((s) => <option key={s.id} value={s.id}>{s.id} {s.title}</option>)}
          </select>
        )}
        {scr && scr.versions.length > 1 && (
          <select class="input input-sm tb-version" aria-label="화면 버전" value={v?.v} onChange={(e) => selectScreen(scr.id, Number(e.currentTarget.value))}>
            {scr.versions.map((x) => <option key={x.v} value={x.v}>v{x.v}{x.label ? ` · ${x.label}` : ''}</option>)}
          </select>
        )}
        {screenTools}
      </div>

      <span class="grow" />

      {scr && (
        <div class="tb-group">
          <div class="seg" role="radiogroup" aria-label="모드">
            <button type="button" role="radio" aria-checked={!pickLocked} class="seg-btn" onClick={() => { mode.value = 'view'; draft.value = null; }} title="화면을 직접 조작합니다">
              <MousePointer2 {...ICON} size={16} /> 보기
            </button>
            <button type="button" role="radio" aria-checked={pickLocked} class="seg-btn" onClick={() => (mode.value = 'annotate')} title="피커 고정 — Ctrl 을 누르고 있는 동안에도 잠깐 피커가 됩니다">
              <Crosshair {...ICON} size={16} /> 피커
            </button>
          </div>
          <button
            type="button"
            class={`btn-icon ${paused.value ? 'is-on' : ''}`}
            aria-pressed={paused.value}
            aria-label={paused.value ? '화면 재생' : '화면 일시정지'}
            title={paused.value ? '화면 재생' : '화면 일시정지 — 움직이는 대상에 Comment 를 달 때'}
            onClick={() => (paused.value = !paused.value)}
          >
            {paused.value ? <Play {...ICON} /> : <Pause {...ICON} />}
          </button>
          <RecordButton />
          <MarkerColorPicker />
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
        <button type="button" class="btn-icon" aria-label="전체화면" title="전체화면 (Esc 로 나가기)" onClick={enterFullscreen}><Maximize2 {...ICON} /></button>
        <button type="button" class="btn-icon" aria-label="테마 전환" title={theme.value === 'light' ? '다크 테마' : '라이트 테마'} onClick={() => setTheme(theme.value === 'light' ? 'dark' : 'light')}>
          {theme.value === 'light' ? <Moon {...ICON} /> : <Sun {...ICON} />}
        </button>
        <button type="button" class="btn btn-ghost tb-user" onClick={() => (askName.value = true)} title="내 이름 바꾸기">
          <UserRound {...ICON} size={16} /> {user.value ?? '이름 입력'}
        </button>
        <button type="button" class="btn btn-primary" onClick={() => save(host)} title="저장 (Ctrl+S)">
          <Save {...ICON} size={16} /> 저장{dirty.value && <span class="dirty-dot" aria-label="저장 안 된 변경 있음" />}
        </button>
      </div>
    </header>
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
