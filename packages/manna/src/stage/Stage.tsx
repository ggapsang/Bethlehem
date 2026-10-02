/* 스테이지 — 품은 화면(폴더 화면은 srcdoc iframe, URL 화면은 Electron webview), 마커, 피커, 팝업
 * 화면 안의 일은 에이전트(agent/agent.ts)가 하고, 스테이지는 메시지로 묻고 그린다 (docs/ARCHITECTURE.md §6).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Annotation, Screen } from '@core';
import { displayNo, pkgPath } from '@core';
import type { Picked, RectTuple } from '../agent/protocol';
import type { Host } from '../host';
import { onKeyDown, onKeyUp } from '../keys';
import {
  annotations, blobs, doc, draft, holdPick, hovered, misses, paused, picking, recording, reveal, revealing, rev,
  screen, selected, shotView, stageRef, still, version, versionKey, visible,
} from '../store';
import { applySiteSnapshot } from '../actions';
import { StagePopover } from '../ui/Popover';
import { iframeBridge, webviewBridge, type Bridge, type WebviewLike } from './bridge';
import { prepareScreen } from './loader';
import { useBlobUrl } from './media';

interface Fit {
  s: number;
  ox: number;
  oy: number;
}

const MARK = 24; // 마커 지름 (unit-6)
const PAD = 24;

type Box = { x: number; y: number; w: number; h: number };

function place(box: HTMLElement | null, r: Box | null, s: number): void {
  if (!box) return;
  if (!r) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'block';
  box.style.transform = `translate(${r.x * s}px, ${r.y * s}px)`;
  box.style.width = `${Math.max(2, r.w * s)}px`;
  box.style.height = `${Math.max(2, r.h * s)}px`;
}

const tupleBox = (t: [number, number, number, number] | RectTuple): Box => ({ x: t[0], y: t[1], w: t[2], h: t[3] });

/** 다음 페인트까지 기다린다 (마커를 숨긴 뒤 캡처할 때) */
const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

export function Stage({ host, empty }: { host: Host; empty?: preact.ComponentChildren }) {
  const area = useRef<HTMLDivElement>(null);
  const frameBox = useRef<HTMLDivElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const webview = useRef<WebviewLike>(null);
  const markers = useRef<HTMLDivElement>(null);
  const selBox = useRef<HTMLDivElement>(null);
  const pickBox = useRef<HTMLDivElement>(null);
  const dragBox = useRef<HTMLDivElement>(null);
  const bridge = useRef<Bridge | null>(null);
  const rects = useRef<Record<string, RectTuple>>({});
  const readyWaiters = useRef<(() => void)[]>([]);
  const [fit, setFit] = useState<Fit>({ s: 1, ox: 0, oy: 0 });
  const [loading, setLoading] = useState(false);
  const [reloadNo, setReloadNo] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [popRect, setPopRect] = useState<Box | null>(null);
  const fitRef = useRef(fit);
  fitRef.current = fit;

  rev.value;
  const v = version.value;
  const vkey = versionKey.value;
  const scr = screen.value;
  const list = annotations.value;
  const isPicking = picking.value || dragging;
  const markerColor = doc.value.meta.marker ?? 'auto';
  const live = !!host.site && v?.source?.mode === 'site';
  const frameKey = `${vkey}#${reloadNo}`;
  const sel = list.find((a) => a.id === selected.value) ?? null;
  const showShot = !!sel?.shot && shotView.value && !draft.value;
  const shotSrc = useBlobUrl(sel?.shot?.sha, 'image/jpeg');

  /* ── 크기 맞춤 ─────────────────────────────────────────────────────── */
  const vw = v?.viewport.w ?? 0;
  const vh = v?.viewport.h ?? 0;
  const vfit = v?.viewport.fit ?? 'contain';
  useLayoutEffect(() => {
    const el = area.current;
    if (!el || !vw) return;
    const update = () => {
      const aw = el.clientWidth - PAD * 2;
      const ah = el.clientHeight - PAD * 2;
      const s = Math.max(0.1, Math.min(1, vfit === 'width' ? aw / vw : Math.min(aw / vw, ah / vh)));
      setFit({ s, ox: Math.max(PAD, (el.clientWidth - vw * s) / 2), oy: vfit === 'width' ? PAD : Math.max(PAD, (el.clientHeight - vh * s) / 2) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [vw, vh, vfit, !!scr]);

  useEffect(() => {
    stageRef.frame = frameBox.current;
  });

  /* ── 에이전트에게 지금 상태 알리기 ─────────────────────────────────── */
  const anchorsMsg = () => ({
    type: 'anchors' as const,
    list: annotations.peek().filter((a) => a.anchor).map((a) => ({ id: a.id, fp: a.anchor!.fp, ...(a.anchor!.region ? { region: a.anchor!.region } : {}) })),
  });
  const syncAgent = () => {
    const b = bridge.current;
    if (!b) return;
    b.send(anchorsMsg());
    b.send({ type: 'picking', on: picking.peek() });
    b.send({ type: paused.peek() || picking.peek() || !!draft.peek() ? 'pause' : 'resume' });
  };

  /* ── 화면 불러오기 (폴더 화면) ──────────────────────────────────────── */
  useEffect(() => {
    const f = iframe.current;
    const ver = version.peek();
    if (live || !ver || !f) return;
    let alive = true;
    let dispose: (() => void) | undefined;
    setLoading(true);
    setError(null);
    setWarnings([]);
    prepareScreen(ver, blobs)
      .then((p) => {
        if (!alive) return p.dispose();
        dispose = p.dispose;
        setWarnings(p.warnings);
        f.srcdoc = p.srcdoc;
      })
      .catch((e: Error) => {
        setLoading(false);
        setError(e.message);
      });
    return () => {
      alive = false;
      dispose?.();
    };
  }, [frameKey, live]);

  /* ── 에이전트와 잇기 ─────────────────────────────────────────────── */
  useLayoutEffect(() => {
    const b = live ? (webview.current ? webviewBridge(webview.current) : null) : iframe.current ? iframeBridge(iframe.current) : null;
    if (!b) return;
    bridge.current = b;
    rects.current = {};
    const off = b.on((m) => {
      if (m.type === 'ready') {
        setLoading(false);
        syncAgent();
        takeSnapshot(4000);
        readyWaiters.current.splice(0).forEach((w) => w());
      } else if (m.type === 'frame') {
        rects.current = m.rects;
        paint();
      } else if (m.type === 'key') {
        const ev = {
          key: m.key, ctrlKey: m.ctrl, metaKey: m.meta, shiftKey: m.shift, altKey: m.alt, repeat: m.repeat,
          target: m.typing ? { tagName: 'INPUT', isContentEditable: false } : null,
          preventDefault() {},
        } as unknown as KeyboardEvent;
        if (m.phase === 'down') onKeyDown(ev, true);
        else onKeyUp(ev);
      }
    });
    return () => {
      off();
      b.dispose();
      if (bridge.current === b) bridge.current = null;
    };
  }, [frameKey, live]);

  const waitReady = () => new Promise<void>((r) => readyWaiters.current.push(r));

  /* URL 화면 — 지금 모습을 보낸 파일용 사본으로 (열린 뒤 조금 있다가, Comment 를 단 뒤) */
  const snapTimer = useRef<ReturnType<typeof setTimeout>>();
  const takeSnapshot = (delay: number) => {
    if (!live || !host.snapshotSite) return;
    clearTimeout(snapTimer.current);
    const sid = scr?.id;
    const vno = v?.v;
    snapTimer.current = setTimeout(async () => {
      const wv = webview.current as (WebviewLike & { getWebContentsId?: () => number }) | null;
      if (!wv?.getWebContentsId || !sid || vno == null) return;
      const r = await host.snapshotSite!(wv.getWebContentsId()).catch(() => null);
      if (r) applySiteSnapshot(sid, vno, r);
    }, delay);
  };
  useEffect(() => () => clearTimeout(snapTimer.current), [frameKey]);

  /* 앵커 목록이 바뀌면 다시 알린다 */
  const anchorKey = list.map((a) => (a.anchor ? `${a.id}:${a.anchor.fp.selector}:${JSON.stringify(a.anchor.region ?? '')}` : '')).join('|');
  useEffect(() => {
    bridge.current?.send(anchorsMsg());
  }, [anchorKey]);

  /* ── 찾지 못한 파일 보고 (shim → postMessage) ──────────────────────── */
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== iframe.current?.contentWindow || e.data?.manna !== 'miss') return;
      misses.value = [...misses.value, { url: pkgPath(String(e.data.url)) }];
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  /* ── 일시정지 · 피커 멈춤 그림 ───────────────────────────────────── */
  const freezeNo = useRef(0);
  useEffect(() => {
    const b = bridge.current;
    const active = isPicking || !!draft.value;
    if (active) {
      b?.send({ type: 'picking', on: isPicking });
      // 멈춤 그림을 먼저 찍고 멈춘다 — 그리는 중이던 캔버스(WebGL)도 보이는 그대로 남는다
      if (!host.capture || still.peek()) b?.send({ type: 'pause' });
      if (!still.peek() && host.capture && frameBox.current) {
        const no = ++freezeNo.current;
        (async () => {
          setCapturing(true);
          await nextPaint();
          const r = frameBox.current!.getBoundingClientRect();
          const shot = await host.capture!({ x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }).catch(() => null);
          setCapturing(false);
          if (no === freezeNo.current && (picking.peek() || draft.peek())) bridge.current?.send({ type: 'pause' });
          if (!shot || no !== freezeNo.current || !(picking.peek() || draft.peek())) return;
          still.value = { url: URL.createObjectURL(new Blob([shot.bytes as BlobPart], { type: 'image/jpeg' })), ...shot };
        })();
      }
    } else {
      freezeNo.current++;
      b?.send({ type: 'picking', on: false });
      takeSnapshot(1500);
      if (!paused.peek()) b?.send({ type: 'resume' });
      const s = still.peek();
      if (s) {
        URL.revokeObjectURL(s.url);
        still.value = null;
      }
    }
  }, [isPicking, !!draft.value]);

  useEffect(() => {
    if (isPicking || draft.peek()) return;
    bridge.current?.send({ type: paused.value ? 'pause' : 'resume' });
  }, [paused.value]);

  /* ── 다른 화면 상태의 Comment 로 이동 ─────────────────────────────── */
  useEffect(() => {
    const req = reveal.value;
    if (!req) return;
    const a = annotations.peek().find((x) => x.id === req.id);
    const b = bridge.current;
    if (!a?.anchor || !b || loading) return;
    const anchor = a.anchor;
    let alive = true;
    const msg = { type: 'reveal' as const, fp: anchor.fp, ...(anchor.region ? { region: anchor.region } : {}), steps: anchor.path ?? [] };
    revealing.value = true;
    paused.value = false;
    (async () => {
      const quick = await b.ask<{ ok: boolean }>({ ...msg, quick: true });
      if (!alive || quick?.ok) return;
      // 빠른 길로 안 되면 처음부터 다시 불러와 경로를 다시 누른다
      const ready = waitReady();
      setReloadNo((n) => n + 1);
      await ready;
      if (!alive || !bridge.current) return;
      await bridge.current.ask({ ...msg, quick: false }, 60000);
    })().finally(() => {
      if (alive) revealing.value = false;
    });
    return () => {
      alive = false;
      revealing.value = false;
    };
  }, [reveal.value]);

  /* ── 마커 그리기 (에이전트가 보낸 위치) ──────────────────────────────── */
  const paint = () => {
    const layer = markers.current;
    if (!layer) return;
    const { s } = fitRef.current;
    const seen = new Set<string>();
    let selRect: Box | null = null;
    for (const node of Array.from(layer.children) as HTMLElement[]) {
      const id = node.dataset.id!;
      const t = rects.current[id];
      if (!t || !t[4]) {
        node.style.display = 'none';
        continue;
      }
      seen.add(id);
      const x = Math.min(Math.max(t[0] * s - MARK / 2, -MARK / 2), vw * s - MARK / 2);
      const y = Math.min(Math.max(t[1] * s - MARK / 2, -MARK / 2), vh * s - MARK / 2);
      node.style.display = 'flex';
      node.style.transform = `translate(${x}px, ${y}px)`;
      node.dataset.tone = t[5] ? 'ondark' : 'onlight';
      if (id === selected.peek() || id === hovered.peek()) selRect = tupleBox(t);
    }
    place(selBox.current, selRect, s);
    const dr = draft.peek();
    if (dr) place(pickBox.current, tupleBox(dr.picked.rect), s);
    const prev = visible.peek();
    if (prev.size !== seen.size || [...seen].some((id) => !prev.has(id))) visible.value = seen;
    // 팝업 자리 — 선택한 Comment 의 대상
    const sid = selected.peek();
    const st = sid ? rects.current[sid] : undefined;
    const want = st && st[4] ? tupleBox(st) : null;
    setPopRect((old) => (old && want && Math.abs(old.x - want.x) + Math.abs(old.y - want.y) + Math.abs(old.w - want.w) < 6 ? old : want));
  };
  useEffect(paint, [fit, list.length, selected.value, hovered.value, draft.value]);

  /* ── 피커 ─────────────────────────────────────────────────────────── */
  const pick = useRef<{ down: { x: number; y: number } | null; dragging: boolean; hoverBusy: boolean; hoverNext: { x: number; y: number } | null }>({
    down: null, dragging: false, hoverBusy: false, hoverNext: null,
  });

  const local = (e: PointerEvent | MouseEvent) => {
    const r = frameBox.current!.getBoundingClientRect();
    const { s } = fitRef.current;
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
  };

  const hoverAt = async (p: { x: number; y: number }) => {
    const st = pick.current;
    if (st.hoverBusy) {
      st.hoverNext = p;
      return;
    }
    st.hoverBusy = true;
    const r = await bridge.current?.ask<{ rect: [number, number, number, number] }>({ type: 'hover', x: p.x, y: p.y }, 2000);
    st.hoverBusy = false;
    if (r && !draft.peek() && !st.down) place(pickBox.current, tupleBox(r.rect), fitRef.current.s);
    if (st.hoverNext) {
      const n = st.hoverNext;
      st.hoverNext = null;
      hoverAt(n);
    }
  };

  const setDraft = (p: Picked | null) => {
    if (!p) return;
    draft.value = { picked: p };
    place(pickBox.current, tupleBox(p.rect), fitRef.current.s);
  };

  const onMove = (e: PointerEvent) => {
    const p = local(e);
    const st = pick.current;
    if (st.down) {
      const dx = p.x - st.down.x;
      const dy = p.y - st.down.y;
      if (!st.dragging && Math.hypot(dx, dy) * fitRef.current.s > 4) st.dragging = true;
      if (st.dragging) place(dragBox.current, { x: Math.min(p.x, st.down.x), y: Math.min(p.y, st.down.y), w: Math.abs(dx), h: Math.abs(dy) }, fitRef.current.s);
      return;
    }
    hoverAt(p);
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pick.current.down = local(e);
    pick.current.dragging = false;
    setDragging(true);
  };

  const onUp = async (e: PointerEvent) => {
    const st = pick.current;
    setDragging(false);
    if (!st.down || !bridge.current) return;
    const p = local(e);
    const down = st.down;
    st.down = null;
    place(dragBox.current, null, 1);
    if (st.dragging) {
      st.dragging = false;
      setDraft(await bridge.current.ask<Picked>({ type: 'pickRect', x: Math.min(p.x, down.x), y: Math.min(p.y, down.y), w: Math.abs(p.x - down.x), h: Math.abs(p.y - down.y) }));
    } else {
      setDraft(await bridge.current.ask<Picked>({ type: 'pick', x: p.x, y: p.y }));
    }
  };

  const onWheel = (e: WheelEvent) => iframe.current?.contentWindow?.scrollBy(e.deltaX, e.deltaY);

  /* ↑ 부모 · ↓ 자식 — 피커 중이거나 작성 중일 때 (글을 쓰는 중이면 Alt+↑/↓) */
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (!/^Arrow(Up|Down)$/.test(e.key)) return;
      const dr = draft.peek();
      if (!picking.peek() && !dr) return;
      if (dr?.picked.region) return;
      const t = e.target as HTMLElement | null;
      const typingNow = !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
      if (typingNow && !e.altKey) return;
      e.preventDefault();
      const r = await bridge.current?.ask<Picked>({ type: e.key === 'ArrowUp' ? 'pickUp' : 'pickDown' });
      if (r && dr) setDraft(r);
      else if (r) place(pickBox.current, tupleBox(r.rect), fitRef.current.s);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!isPicking && !draft.value) place(pickBox.current, null, 1);
  }, [isPicking, draft.value]);

  /* 선택이 바뀌면 '달 때 화면'부터 보인다 */
  useEffect(() => {
    shotView.value = true;
  }, [selected.value]);


  if (!v || !scr) return <div class="stage stage-empty">{empty}</div>;

  const frameStyle = { left: `${fit.ox}px`, top: `${fit.oy}px`, width: `${vw * fit.s}px`, height: `${vh * fit.s}px` };
  const innerStyle = { width: `${vw}px`, height: `${vh}px`, transform: `scale(${fit.s})` };
  const shotBox = sel?.shot?.box;

  return (
    <div class={`stage ${vfit === 'width' ? 'stage-scroll' : ''}`} ref={area}>
      <div class={`stage-frame ${recording.value || capturing ? 'is-recording' : ''}`} style={frameStyle} ref={frameBox}>
        {live ? (
          <webview
            key={frameKey}
            ref={webview as never}
            class="stage-webview"
            src={v.source!.url}
            partition={host.site!.partition}
            webpreferences="contextIsolation=yes,sandbox=yes"
            style={innerStyle}
          />
        ) : (
          <iframe
            key={frameKey}
            ref={iframe}
            class="stage-iframe"
            title={`${scr.id} ${scr.title} v${v.v}`}
            style={innerStyle}
          />
        )}
        {still.value && <img class="stage-still" src={still.value.url} alt="" draggable={false} />}
        {showShot && shotSrc && (
          <div class="shot-view">
            <img src={shotSrc} alt="이 Comment 를 달 때의 화면" draggable={false} />
            {shotBox && (
              <div class="shot-box" style={{ left: `${shotBox.x * 100}%`, top: `${shotBox.y * 100}%`, width: `${shotBox.w * 100}%`, height: `${shotBox.h * 100}%` }} />
            )}
          </div>
        )}
        {isPicking && (
          <div class="pick-layer" onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp} onWheel={onWheel}
            onPointerLeave={() => !pick.current.down && !draft.peek() && place(pickBox.current, null, 1)} />
        )}
        <div class="hl-box hl-sel" ref={selBox} />
        <div class="hl-box hl-pick" ref={pickBox} />
        <div class="hl-box hl-drag" ref={dragBox} />
        <div class="marker-layer" ref={markers} data-color={markerColor}>
          {list.filter((a) => a.anchor).map((a) => <Marker key={a.id} a={a} scr={scr} />)}
        </div>
        {loading && !error && <div class="stage-note">{live ? '사이트를 여는 중…' : '화면을 펼치는 중…'}</div>}
        {revealing.value && <div class="stage-note">Comment 가 있는 화면 상태로 이동하는 중…</div>}
        {showShot && (
          <div class="stage-badge stage-badge-shot">
            Comment 를 달 때의 화면
            <button type="button" class="badge-btn" onClick={() => (shotView.value = false)}>실시간 화면 보기</button>
          </div>
        )}
        {!showShot && paused.value && !recording.value && <div class="stage-badge">일시정지됨</div>}
        {holdPick.value && <div class="stage-badge stage-badge-pick">피커 — 클릭하거나 드래그하세요</div>}
      </div>
      <StagePopover
        host={host}
        fit={fit}
        target={draft.value ? tupleBox(draft.value.picked.rect) : showShot && shotBox ? { x: shotBox.x * vw, y: shotBox.y * vh, w: shotBox.w * vw, h: shotBox.h * vh } : popRect}
        areaRef={area}
      />
      {error && (
        <div class="stage-error" role="alert">
          <strong>화면을 열지 못했습니다.</strong>
          <span>{error}</span>
          <span>테라리움에서 이 화면 버전을 다시 등록해 주세요.</span>
        </div>
      )}
      {(misses.value.length > 0 || warnings.length > 0) && <Diagnostics warnings={warnings} />}
    </div>
  );
}

function Marker({ a, scr }: { a: Annotation; scr: Screen }) {
  rev.value; // 순서가 바뀌면 번호도 바뀐다
  const sel = selected.value === a.id;
  return (
    <button
      type="button"
      data-id={a.id}
      class={`marker ${sel ? 'is-sel' : ''}`}
      title={`${displayNo(scr, a)} · ${a.author}`}
      onClick={(e) => {
        e.stopPropagation();
        selected.value = sel ? null : a.id;
      }}
      onPointerEnter={() => (hovered.value = a.id)}
      onPointerLeave={() => (hovered.value = null)}
    >
      {displayNo(scr, a)}
    </button>
  );
}

function Diagnostics({ warnings }: { warnings: string[] }) {
  const [open, setOpen] = useState(false);
  const m = misses.value;
  return (
    <div class="stage-diag" role="status">
      <button type="button" class="diag-head" onClick={() => setOpen(!open)}>
        {m.length > 0 ? `화면이 파일 ${m.length}개를 찾지 못했습니다` : warnings[0]}
        <span class="diag-more">{open ? '접기' : '자세히'}</span>
      </button>
      {open && (
        <div class="diag-body">
          {warnings.map((w) => <p key={w}>{w}</p>)}
          {m.length > 0 && (
            <>
              <p>원인: 화면이 실행 중에 요청한 파일이 문서에 담겨 있지 않습니다.</p>
              <ul>{m.map((x) => <li key={x.url}><code>{x.url}</code></li>)}</ul>
              <p>조치: 테라리움에서 이 화면을 다시 등록할 때 위 파일을 포함해 주세요.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
