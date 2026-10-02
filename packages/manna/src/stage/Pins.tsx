/* 핀 — 사용자가 화면의 한 점에 일부러 박아 넣은 표시 (지도 핀 · 길 안내 화살표). 이름을 붙일 수 있다.
 * 요소에 묶이지 않고 화면 좌표에 박힌다 — 화면 내용이 바뀌어도 늘 그 자리, 확대 · 축소하면 화면과 같이 움직인다.
 * 끌어서 옮기고, 두 번 눌러 이름을 바꾸고, 골라서 Delete 로 지운다.
 */
import { useRef, useState } from 'preact/hooks';
import { MapPin, Navigation, X } from 'lucide-preact';
import type { Pin } from '@core';
import { movePin, removePin, renamePin } from '../actions';
import { pinNaming, pinSel, rev, screen, version } from '../store';

const samePage = (a: string | undefined, b: string) => !a || a.split('#')[0] === b.split('#')[0];

export function PinLayer({ scale, page, frame }: { scale: number; page: string; frame: () => HTMLElement | null }) {
  rev.value;
  const s = screen.value;
  const v = version.value;
  const pins = (s?.pins ?? []).filter((p) => p.version === v?.v && samePage(p.page, page));
  if (!pins.length) return null;
  return (
    <div class="pin-layer">
      {pins.map((p) => <PinMark key={p.id} p={p} scale={scale} frame={frame} />)}
    </div>
  );
}

function PinMark({ p, scale, frame }: { p: Pin; scale: number; frame: () => HTMLElement | null }) {
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const naming = pinNaming.value === p.id;
  const sel = pinSel.value === p.id;
  const at = drag ?? p;

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('input, .pin-x')) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const f = frame()?.getBoundingClientRect();
    if (!f) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    moved.current = false;
    const move = (ev: PointerEvent) => {
      if (!moved.current && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      moved.current = true;
      setDrag({ x: Math.min(Math.max(0, (ev.clientX - f.left) / scale), f.width / scale), y: Math.min(Math.max(0, (ev.clientY - f.top) / scale), f.height / scale) });
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      if (moved.current) movePin(p.id, Math.min(Math.max(0, (ev.clientX - f.left) / scale), f.width / scale), Math.min(Math.max(0, (ev.clientY - f.top) / scale), f.height / scale));
      else pinSel.value = sel ? null : p.id;
      setDrag(null);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const finish = (val: string) => {
    renamePin(p.id, val);
    pinNaming.value = null;
  };

  return (
    <div
      class={`pin pin-${p.shape} ${sel ? 'is-sel' : ''} ${drag ? 'is-drag' : ''}`}
      data-id={p.id}
      style={{ left: `${at.x * scale}px`, top: `${at.y * scale}px` }}
      title={`${p.name || (p.shape === 'nav' ? '화살표' : '핀')} · ${p.author} — 끌어서 옮기기 · 두 번 눌러 이름 · 골라서 Delete 로 지우기`}
      onPointerDown={onDown}
      onDblClick={(e) => {
        e.stopPropagation();
        pinNaming.value = p.id;
      }}
    >
      <span class="pin-icon" aria-hidden="true">
        {p.shape === 'nav' ? <Navigation size={26} strokeWidth={2} /> : <MapPin size={30} strokeWidth={2} />}
      </span>
      {naming ? (
        <input
          class="pin-input"
          aria-label="핀 이름"
          defaultValue={p.name ?? ''}
          placeholder="이름 (없어도 됩니다)"
          ref={(el) => {
            if (el && el !== document.activeElement) requestAnimationFrame(() => (el.focus(), el.select()));
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={(e) => finish(e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') finish(e.currentTarget.value);
            if (e.key === 'Escape') pinNaming.value = null;
          }}
        />
      ) : (
        p.name && <span class="pin-name">{p.name}</span>
      )}
      {sel && !naming && (
        <button
          type="button"
          class="pin-x"
          aria-label="핀 지우기"
          title="핀 지우기 (Delete)"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            removePin(p.id);
          }}
        >
          <X size={12} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
