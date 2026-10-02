/* 화면 막대 — 탭 아래. 지금 화면의 버전(시간적 상태)·페이지·실행 상태와 화면에 대한 조작 (Terrarium UI/UX 가이드 §10·§16)
 * 툴바에는 문서 수준의 것만 남기고, 화면에 붙은 조작(일시정지·녹화·마커 색·배율·전체화면)은 여기에 둔다.
 * versionTools 는 버전 칩 옆(Bethlehem: 새 버전), screenActions 는 끝(Bethlehem: 화면 지우기).
 */
import type { ComponentChildren } from 'preact';
import { RotateCw, Pipette, Maximize2, Minimize2, Minus, PanelRight, Pause, Play, Plus } from 'lucide-preact';
import type { Screen, ScreenVersion } from '@core';
import { fullPanelPinned, setFullPanelPinned, draft, fitMode, fullscreen, mode, setFitMode, paused, picking, recording, rev, selectScreen, zoom, zoomStep } from '../store';
import { MarkerColorPicker, RecordButton, enterFullscreen } from '../ui/Toolbar';

const ICON = { size: 18, strokeWidth: 1.5 };

export interface StageHeaderProps {
  scr: Screen;
  v: ScreenVersion;
  page: string | null;
  onHome: () => void;
  onReload: () => void;
  /** 지금 실제 배율 (맞춤일 때도) */
  scale: number;
  versionTools?: ComponentChildren;
  screenActions?: ComponentChildren;
}

export function StageHeader({ scr, v, page, onHome, onReload, scale, versionTools, screenActions }: StageHeaderProps) {
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
  const pct = `${Math.round(scale * 100)}%`;
  return (
    <div class="sc-bar">
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
      {versionTools}
      {page && page !== v.entry && (
        <button type="button" class="sc-page" title="시작 페이지로" onClick={onHome}>
          <span class="mono">{v.entry}</span> › <span class="mono">{page}</span>
        </button>
      )}
      <span class="grow" />
      <span class={`sc-state sc-${state.tone}`}><span class="sc-dot" aria-hidden="true" />{state.text}</span>
      <span class="sc-sep" />
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
      {!image && (
        <button type="button" class="btn-icon" aria-label="새로 고침" title={site ? '새로 고침 — 사이트를 지금 모습으로 다시 불러온다' : '새로 고침 — 화면을 처음 상태로'} onClick={onReload}>
          <RotateCw {...ICON} />
        </button>
      )}
      {!image && <RecordButton />}
      <MarkerColorPicker />
      <span class="sc-sep" />
      <div class="seg seg-sm" role="radiogroup" aria-label="화면 맞춤">
        <button type="button" role="radio" aria-checked={fitMode.value === 'fit'} class="seg-btn" title="여백을 두고 화면 비율 그대로" onClick={() => setFitMode('fit')}>여백</button>
        <button type="button" role="radio" aria-checked={fitMode.value === 'fill'} class="seg-btn" title="탭을 꽉 채운다 — 화면 높이를 탭에 맞춰 다시 배치한다" onClick={() => setFitMode('fill')}>꽉 채움</button>
      </div>
      <div class="zoom" role="group" aria-label="배율">
        <button type="button" class="btn-icon" aria-label="축소" title="축소 (Ctrl+휠)" onClick={() => zoomStep(-1, scale)}><Minus {...ICON} /></button>
        <button
          type="button"
          class={`zoom-val ${zoom.value == null ? 'is-fit' : ''}`}
          aria-label="배율"
          title={zoom.value == null ? '맞춤 — 누르면 100%' : '누르면 맞춤'}
          onClick={() => (zoom.value = zoom.value == null ? 1 : null)}
        >
          {zoom.value == null ? `맞춤 ${pct}` : pct}
        </button>
        <button type="button" class="btn-icon" aria-label="확대" title="확대 (Ctrl+휠)" onClick={() => zoomStep(1, scale)}><Plus {...ICON} /></button>
      </div>
      {fullscreen.value && (
        <button
          type="button"
          class={`btn-icon ${mode.value === 'annotate' ? 'is-on-soft' : ''}`}
          aria-pressed={mode.value === 'annotate'}
          aria-label="피커"
          title="피커 (Ctrl 을 누르고 있어도 됩니다)"
          onClick={() => (mode.value = mode.value === 'annotate' ? 'view' : 'annotate')}
        >
          <Pipette {...ICON} />
        </button>
      )}
      {fullscreen.value && (
        <button type="button" class={`btn-icon ${fullPanelPinned.value ? 'is-on-soft' : ''}`} aria-pressed={fullPanelPinned.value} aria-label="노트·Comment 패널 고정" title="패널 고정 — 풀면 오른쪽 끝에 마우스를 댈 때만 뜬다" onClick={() => setFullPanelPinned(!fullPanelPinned.value)}>
          <PanelRight {...ICON} />
        </button>
      )}
      {fullscreen.value ? (
        <button type="button" class="btn-icon" aria-label="전체화면 나가기" title="전체화면 나가기 (Esc)" onClick={() => document.exitFullscreen?.()}><Minimize2 {...ICON} /></button>
      ) : (
        <button type="button" class="btn-icon" aria-label="전체화면" title="전체화면 (Esc 로 나가기)" onClick={enterFullscreen}><Maximize2 {...ICON} /></button>
      )}
      {screenActions}
    </div>
  );
}
