/* 화면 컨테이너의 머리 — 지금 화면·버전(시간적 상태)·실행 상태와 화면에 대한 조작 (Terrarium UI/UX 가이드 §10·§16)
 * 툴바에는 문서 수준의 것만 남기고, 화면에 붙은 조작(일시정지·녹화·마커 색·전체화면)은 여기에 둔다.
 */
import { Crosshair, Maximize2, Minimize2, PanelRight, Pause, Play } from 'lucide-preact';
import type { Screen, ScreenVersion } from '@core';
import { draft, fullscreen, mode, panelOpen, paused, picking, recording, rev, selectScreen, togglePanel } from '../store';
import { MarkerColorPicker, RecordButton, enterFullscreen } from '../ui/Toolbar';

const ICON = { size: 18, strokeWidth: 1.5 };

export function StageHeader({ scr, v, page, onHome }: { scr: Screen; v: ScreenVersion; page: string | null; onHome: () => void }) {
  rev.value;
  const image = v.source?.mode === 'image';
  const site = v.source?.mode === 'site';
  const state = recording.value
    ? { tone: 'rec', text: '녹화 중' }
    : picking.value || draft.value
      ? { tone: 'hold', text: '멈춤 · 고르는 중' }
      : image
        ? { tone: 'still', text: '그림' }
        : paused.value
          ? { tone: 'hold', text: '일시정지' }
          : { tone: 'live', text: site ? '실시간 사이트' : '실행 중' };
  return (
    <header class="sc-head">
      <span class="sc-id mono">{scr.id}</span>
      <span class="sc-title ellipsis" title={scr.title}>{scr.title}</span>
      <div class="ver-chips" role="radiogroup" aria-label="화면 버전">
        {scr.versions.map((x) => (
          <button
            key={x.v}
            type="button"
            role="radio"
            aria-checked={x.v === v.v}
            data-v={x.v}
            class="ver-chip"
            title={x.label ? `v${x.v} · ${x.label}` : `v${x.v}`}
            onClick={() => selectScreen(scr.id, x.v)}
          >
            v{x.v}
          </button>
        ))}
      </div>
      {page && page !== v.entry && (
        <button type="button" class="sc-page" title="시작 페이지로" onClick={onHome}>
          <span class="mono">{v.entry}</span> › <span class="mono">{page}</span>
        </button>
      )}
      <span class="grow" />
      <span class={`sc-state sc-${state.tone}`}><span class="sc-dot" aria-hidden="true" />{state.text}</span>
      {!image && (
        <button
          type="button"
          class={`btn-icon ${paused.value ? 'is-on' : ''}`}
          aria-pressed={paused.value}
          aria-label={paused.value ? '화면 재생' : '화면 일시정지'}
          title={paused.value ? '화면 재생' : '화면 일시정지'}
          onClick={() => (paused.value = !paused.value)}
        >
          {paused.value ? <Play {...ICON} /> : <Pause {...ICON} />}
        </button>
      )}
      {!image && <RecordButton />}
      <MarkerColorPicker />
      {fullscreen.value && (
        <button
          type="button"
          class={`btn-icon ${mode.value === 'annotate' ? 'is-on-soft' : ''}`}
          aria-pressed={mode.value === 'annotate'}
          aria-label="피커"
          title="피커 (Ctrl 을 누르고 있어도 됩니다)"
          onClick={() => (mode.value = mode.value === 'annotate' ? 'view' : 'annotate')}
        >
          <Crosshair {...ICON} />
        </button>
      )}
      {fullscreen.value && (
        <button type="button" class={`btn-icon ${panelOpen.value ? 'is-on-soft' : ''}`} aria-label="개요·Comment 패널" onClick={() => togglePanel()}>
          <PanelRight {...ICON} />
        </button>
      )}
      {fullscreen.value ? (
        <button type="button" class="btn-icon" aria-label="전체화면 나가기" title="전체화면 나가기 (Esc)" onClick={() => document.exitFullscreen?.()}><Minimize2 {...ICON} /></button>
      ) : (
        <button type="button" class="btn-icon" aria-label="전체화면" title="전체화면 (Esc 로 나가기)" onClick={enterFullscreen}><Maximize2 {...ICON} /></button>
      )}
    </header>
  );
}
