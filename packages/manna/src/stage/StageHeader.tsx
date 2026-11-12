/* 화면 막대 — 툴바 한 줄의 탭 오른쪽. 지금 화면의 버전(시간적 상태)·페이지·실행 상태와 화면에 대한 조작 (Terrarium UI/UX 가이드 §10·§16)
 * 문서 수준의 것은 툴바 양 끝에, 화면에 붙은 조작(피커·일시정지·녹화·마커·배율·전체화면)은 여기에 둔다. 전체화면에서는 화면 위쪽 끝에 마우스를 대면 뜬다.
 * versionTools 는 버전 칩 옆(Bethlehem: 새 버전), screenActions 는 끝.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { MapPin, Navigation, SquareDashedMousePointer, RotateCw, Pipette, Maximize2, Minimize2, Minus, PanelRight, Pause, Play, Plus, Proportions, Ellipsis } from 'lucide-preact';
import type { Screen, ScreenVersion } from '@core';
import { pinTool, setShowBoxes, showBoxes, fullPanelPinned, setFullPanelPinned, draft, fitMode, fullscreen, mode, setFitMode, paused, picking, recording, rev, selectScreen, zoom, zoomStep } from '../store';
import { BackChip, ScreenLinksMenu } from './Links';
import { MarkerColorPicker, RecordButton, enterFullscreen } from '../ui/Toolbar';

const ICON = { size: 17, strokeWidth: 1.5 };

export interface StageHeaderProps {
  scr: Screen;
  v: ScreenVersion;
  page: string | null;
  onHome: () => void;
  onReload: () => void;
  /** URL 화면 (작성 프로그램) — 실시간 사이트와 캡처 모음 사이 */
  siteView?: { gallery: boolean; set: (g: boolean) => void };
  /** 지금 실제 배율 (맞춤일 때도) */
  scale: number;
  versionTools?: ComponentChildren;
  screenActions?: ComponentChildren;
}

export function StageHeader({ scr, v, page, onHome, onReload, siteView, scale, versionTools, screenActions }: StageHeaderProps) {
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
            {(() => {
              const k = scr.annotations.filter((a) => a.version === x.v && !a.done).length;
              return k > 0 ? <span class="ver-count" title={`v${x.v} 의 Comment ${k}개`}>{k}</span> : null;
            })()}
          </button>
        ))}
        {v.v !== scr.versions[scr.versions.length - 1]!.v && (
          <button type="button" class="btn btn-sm ver-old" title={`예전 v${v.v} 를 보고 있습니다 — 여기서 단 Comment 는 이 버전에 붙습니다. 누르면 최신으로`} onClick={() => selectScreen(scr.id, scr.versions[scr.versions.length - 1]!.v)}>
            최신 v{scr.versions[scr.versions.length - 1]!.v} 로
          </button>
        )}
      </div>
      {versionTools}
      {page && page !== v.entry && (
        <button type="button" class="sc-page" title="시작 페이지로" onClick={onHome}>
          <span class="mono">{v.entry}</span> › <span class="mono">{page}</span>
        </button>
      )}
      {siteView && (
        <div class="seg seg-sm" role="radiogroup" aria-label="URL 화면 보기">
          <button type="button" role="radio" aria-checked={!siteView.gallery} class="seg-btn" onClick={() => siteView.set(false)}>실시간</button>
          <button type="button" role="radio" aria-checked={siteView.gallery} class="seg-btn" title="받는 사람이 보는 것과 같은 캡처 · 클립 모음" onClick={() => siteView.set(true)}>캡처 모음</button>
        </div>
      )}
      <BackChip />
      <span class="grow" />
      <span class={`sc-state sc-${state.tone}`} title={state.text}><span class="sc-dot" aria-hidden="true" /><span class="sc-state-text">{state.text}</span></span>
      <button
        type="button"
        class={`btn-icon ${mode.value === 'annotate' ? 'is-on' : ''}`}
        aria-pressed={mode.value === 'annotate'}
        aria-label="피커"
        title={mode.value === 'annotate' ? '피커 끄기 — 화면을 직접 조작한다' : '피커 — 화면의 요소를 골라 Comment 를 단다 (Ctrl 을 누르고 있는 동안에도)'}
        onClick={() => {
          if (mode.value === 'annotate') {
            mode.value = 'view';
            draft.value = null;
          } else mode.value = 'annotate';
        }}
      >
        <Pipette {...ICON} />
      </button>
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
      <MoreTools>
      <MarkerColorPicker />
      <button
        type="button"
        class={`btn-icon ${showBoxes.value ? 'is-on-soft' : ''}`}
        aria-pressed={showBoxes.value}
        aria-label="박스 보이기"
        title={showBoxes.value ? '박스 숨기기 — 고르거나 마우스를 올릴 때만' : '박스 보이기 — 모든 Comment 의 대상을 늘 박스로'}
        onClick={() => setShowBoxes(!showBoxes.value)}
      >
        <SquareDashedMousePointer {...ICON} />
      </button>
      <ScreenLinksMenu />
      <div class="seg seg-sm pin-tools" role="group" aria-label="핀 꽂기">
        <button type="button" class="seg-btn" aria-pressed={pinTool.value === 'pin'} aria-label="핀 꽂기" title="핀 꽂기 — 화면을 한 번 누르면 그 자리에 박힌다" onClick={() => (pinTool.value = pinTool.value === 'pin' ? null : 'pin')}>
          <MapPin size={15} strokeWidth={1.75} />
        </button>
        <button type="button" class="seg-btn" aria-pressed={pinTool.value === 'nav'} aria-label="화살표 꽂기" title="화살표 꽂기 — 길 안내 화살표 모양" onClick={() => (pinTool.value = pinTool.value === 'nav' ? null : 'nav')}>
          <Navigation size={15} strokeWidth={1.75} />
        </button>
      </div>
      <span class="sc-sep" />
      <button
        type="button"
        class={`btn-icon ${fitMode.value === 'fill' ? 'is-on-soft' : ''}`}
        aria-pressed={fitMode.value === 'fill'}
        aria-label="꽉 채움"
        title={fitMode.value === 'fill' ? '꽉 채움 — 누르면 여백을 두고 화면 비율 그대로' : '여백 — 누르면 탭을 꽉 채운다 (화면 높이를 탭에 맞춰 다시 배치한다)'}
        onClick={() => setFitMode(fitMode.value === 'fill' ? 'fit' : 'fill')}
      >
        <Proportions {...ICON} />
      </button>
      </MoreTools>
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

/** 덜 자주 쓰는 화면 도구(마커 · 박스 · 링크 · 핀 · 맞춤) — 툴바 줄이 넉넉하면 그 자리에 그대로, 좁으면 ⋯ 단추 아래 한 줄로 접힌다(styles.css @container bar) */
function MoreTools({ children }: { children: ComponentChildren }) {
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
  return (
    <div class={`sc-more-wrap ${open ? 'is-open' : ''}`} ref={ref}>
      <button type="button" class="btn-icon sc-more" aria-haspopup="true" aria-expanded={open} aria-label="화면 도구 더 보기" title="마커 색 · 박스 · 링크 · 핀 · 맞춤" onClick={() => setOpen(!open)}>
        <Ellipsis {...ICON} />
      </button>
      <div class="sc-opt">{children}</div>
    </div>
  );
}
