/* 스테이지 — 품은 화면(폴더 화면은 srcdoc iframe, URL 화면은 Electron webview), 마커, 피커, 팝업
 * 화면 안의 일은 에이전트(agent/agent.ts)가 하고, 스테이지는 메시지로 묻고 그린다 (docs/ARCHITECTURE.md §6).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Annotation, Screen, ScreenVersion } from '@core';
import { displayNo, pkgPath } from '@core';
import type { Picked, RectTuple } from '../agent/protocol';
import type { Host } from '../host';
import { liveSite } from '../host';
import { onKeyDown, onKeyUp } from '../keys';
import {
  annotations, blobs, doc, draft, hovered, misses, paused, picking, recording, requestReveal, reveal, revealing, rev,
  setSiteGallery, siteGalleryOn, draftClip, fitMode, markerLabels, pinNaming, pinSel, pinTool, popHidden, showBoxes, showDone, screen, selected, shotView, snipMode, snipRec, stagePage, stageRef, stageScale, stageViewport, still, version, versionKey,
  visible, zoom, zoomStep,
} from '../store';
import type { ComponentChildren } from 'preact';
import { ago } from '../ui/labels';
import { addPin, applySiteSnapshot, stopSnipRecording } from '../actions';
import { RecordingBar, StagePopover } from '../ui/Popover';
import { iframeBridge, webviewBridge, type Bridge, type WebviewLike } from './bridge';
import { prepareScreen } from './loader';
import { StageHeader } from './StageHeader';
import { ScreenTabs, type WindowTools } from './ScreenTabs';
import { TraceLayer, type TraceInput } from './Trace';
import { AreaDraw, LinkAreaLayer, LinkingBar } from './Links';
import { revealAfterLoad } from '../links';
import { whoText } from '../ui/Who';
import { MarkerStrip } from './MarkerStrip';
import { SiteGallery } from './SiteGallery';
import { PinLayer } from './Pins';
import { useBlobUrl } from './media';

interface Fit {
  s: number;
  ox: number;
  oy: number;
  /** 화면 뷰포트 높이 — 꽉 채우기면 탭 높이에 맞춘 값 */
  h: number;
}

const MARK = 24; // 마커 지름 (unit-6)
const PAD = 16; // 화면 프레임 바깥 여백 — 장식이 아니라 숨 쉴 자리 (가이드 §9). 꽉 채우기면 0
/** 그림 화면에서 클릭하면 만드는 박스 크기 (화면 좌표) */
const POINT_BOX = 64;

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

/** 같은 페이지인가 — 해시는 무시한다. 페이지가 적혀 있지 않은 옛 Comment 는 어디서나 */
function samePage(a: string | undefined, b: string): boolean {
  if (!a) return true;
  const norm = (u: string) => u.split('#')[0];
  return norm(a) === norm(b);
}

const tupleBox = (t: [number, number, number, number] | RectTuple): Box => ({ x: t[0], y: t[1], w: t[2], h: t[3] });

/** 다음 페인트까지 기다린다 (마커를 숨긴 뒤 캡처할 때) */
const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

export interface StageProps {
  host: Host;
  empty?: ComponentChildren;
  /** 탭 줄 끝 (Bethlehem: 화면 추가) */
  tabTools?: ComponentChildren;
  /** 버전 칩 옆 (Bethlehem: 새 버전) */
  versionTools?: ComponentChildren;
  /** 화면 막대 끝 (Bethlehem: 화면 지우기) */
  screenActions?: ComponentChildren;
  /** 탭을 새 창으로 빼기 · 복제 보기 (Bethlehem) */
  windowTools?: WindowTools;
}

export function Stage({ host, empty, tabTools, versionTools, screenActions, windowTools }: StageProps) {
  const area = useRef<HTMLDivElement>(null);
  const frameBox = useRef<HTMLDivElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const webview = useRef<WebviewLike>(null);
  const markers = useRef<HTMLDivElement>(null);
  const boxes = useRef<HTMLDivElement>(null);
  const selBox = useRef<HTMLDivElement>(null);
  const pickBox = useRef<HTMLDivElement>(null);
  const dragBox = useRef<HTMLDivElement>(null);
  const bridge = useRef<Bridge | null>(null);
  const rects = useRef<Record<string, RectTuple>>({});
  const readyWaiters = useRef<(() => void)[]>([]);
  const [fit, setFit] = useState<Fit>({ s: 1, ox: 0, oy: 0, h: 0 });
  const snipBox = useRef<HTMLDivElement>(null);
  /* 탭마다 띄운 화면 틀 — 한 번 띄우면 탭을 바꿔도 그대로 둔다 (숨기고 멈춰 두었다가 돌아오면 이어서) */
  const aliveRecs = useRef(new Map<string, Alive>());
  const [aliveKeys, setAliveKeys] = useState<string[]>([]);
  const [, bump] = useState(0);
  const refresh = () => bump((n) => n + 1);
  const [dragging, setDragging] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [popRect, setPopRect] = useState<Box | null>(null);
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    stageScale.value = fit.s;
  }, [fit.s]);

  rev.value;
  const v = version.value;
  const vkey = versionKey.value;
  const scr = screen.value;
  const list = annotations.value;
  // 화면 녹화 중에는 화면을 그대로 만질 수 있어야 한다 — 피커를 잠시 내린다
  const recOn = !!recording.value;
  const isPicking = (picking.value || dragging) && !recOn;
  const traceFeed = useRef<((m: TraceInput) => void) | null>(null);
  const markerColor = doc.value.meta.marker ?? 'auto';
  const live = !!host.site && v?.source?.mode === 'site';
  const isImage = v?.source?.mode === 'image';
  /* 받는 사람 쪽 URL 화면 — 사이트를 띄울 수 없으니 캡처 · 클립 모음으로. 사본이 있으면 바꿔 볼 수 있다 */
  const [copyView, setCopyView] = useState(false);
  /* 작성 프로그램도 같은 캡처 모음을 볼 수 있다 — URL 화면의 [실시간 | 캡처 모음] */
  // 탭마다 따로 기억한다 — 한 탭을 캡처 모음으로 바꿔도 다른 탭은 그대로
  const galleryView = !!scr && siteGalleryOn.value.has(scr.id);
  const setGalleryView = (on: boolean) => scr && setSiteGallery(scr.id, on);
  const isSite = v?.source?.mode === 'site';
  const gallery = isSite && (host.site ? galleryView : !copyView);
  const hasCopy = !!v && v.source?.mode === 'site' && v.external.length > 0; // 사본은 그 페이지와 리소스를 external 로 담는다
  /* 지금 보고 있는 페이지 — 폴더 화면은 패키지 안의 다른 HTML 로 옮겨 갈 수 있고, URL 화면은 사이트 안에서 이동한다 */
  const activeKey = v && scr && !gallery ? vkey : null;
  let rec = activeKey ? aliveRecs.current.get(activeKey) : undefined;
  if (activeKey && !rec && scr && v) {
    rec = { key: activeKey, seq: ++aliveSeq, screen: scr.id, v: v.v, live, page: null, reload: 0, ready: false, liveUrl: null, error: null, warnings: [], style: null, bridge: null, el: null };
    aliveRecs.current.set(activeKey, rec);
  }
  const activeRef = useRef(rec);
  activeRef.current = rec;
  // 살아 있는 틀 — 지금 탭이 맨 뒤(가장 최근). 지운 화면 · 버전의 틀은 내린다. 너무 많으면 오래된 것부터
  const aliveNow = [...aliveKeys.filter((k) => k !== activeKey), ...(activeKey ? [activeKey] : [])]
    .filter((k) => {
      const r = aliveRecs.current.get(k);
      return !!r && doc.value.screens.some((x) => x.id === r.screen && x.versions.some((y) => y.v === r.v));
    })
    .slice(-MAX_ALIVE);
  useEffect(() => {
    if (aliveNow.join('|') === aliveKeys.join('|')) return;
    for (const k of [...aliveRecs.current.keys()]) if (!aliveNow.includes(k)) aliveRecs.current.delete(k);
    setAliveKeys(aliveNow);
  });
  const page = rec?.page ?? null;
  const liveUrl = rec?.liveUrl ?? null;
  const loading = !!rec && !rec.ready;
  const error = rec?.error ?? null;
  const warnings = rec?.warnings ?? [];
  const setPage = (p: string | null) => {
    const r = activeRef.current;
    if (!r || r.page === p) return;
    r.page = p;
    refresh();
  };
  const currentPage = live ? (liveUrl ?? v?.source?.url ?? '') : (page ?? v?.entry ?? '');
  const pageRef = useRef(currentPage);
  pageRef.current = currentPage;
  useEffect(() => {
    setCopyView(false);
  }, [vkey]);
  useEffect(() => {
    stagePage.value = currentPage;
  }, [currentPage]);
  // 캡처 모음 ↔ 사본을 오가면 화면을 새로 띄운다 (모음일 때는 iframe 이 없다)
  const frameKey = `${vkey}#${page ?? ''}#${rec?.reload ?? 0}${gallery ? '#gallery' : ''}`;
  const sel = list.find((a) => a.id === selected.value) ?? null;
  const showShot = !!sel?.shot && shotView.value && !draft.value;
  const shotSrc = useBlobUrl(sel?.shot?.sha, 'image/jpeg');
  const shotViewRef = useRef(showShot);
  shotViewRef.current = showShot;

  /* ── 크기 맞춤 ─────────────────────────────────────────────────────── */
  const vw = v?.viewport.w ?? 0;
  const baseH = v?.viewport.h ?? 0;
  const vfit = v?.viewport.fit ?? 'contain';
  const z = zoom.value;
  const fillMode = fitMode.value === 'fill';
  /* 꽉 채우기 — 여백 없이. 그림이 아닌 화면은 높이를 탭에 맞춰(폭은 기준 그대로) 화면이 그 크기로 다시 배치된다 */
  const stretch = fillMode && !isImage && vfit !== 'width';
  const pad = fillMode ? 0 : PAD;
  useLayoutEffect(() => {
    const el = area.current;
    if (!el || !vw) return;
    const update = () => {
      const aw = el.clientWidth - pad * 2;
      const ah = el.clientHeight - pad * 2;
      const fs = stretch ? aw / vw : Math.min(aw / vw, ah / baseH);
      const fitS = Math.max(0.1, vfit === 'width' ? Math.min(1, aw / vw) : stretch ? fs : fillMode ? fs : Math.min(1, fs));
      const h = stretch ? Math.max(240, Math.round(ah / fitS)) : baseH;
      const s = z ?? fitS;
      setFit({
        s,
        h,
        ox: Math.max(pad, (el.clientWidth - vw * s) / 2),
        oy: vfit === 'width' ? pad : Math.max(pad, (el.clientHeight - h * s) / 2),
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [vw, baseH, vfit, !!scr, z, stretch, pad, fillMode, gallery]);
  const vh = fit.h || baseH;
  const vhRef = useRef(vh);
  vhRef.current = vh;
  useEffect(() => {
    stageViewport.value = { w: vw, h: vh };
  }, [vw, vh]);

  /* 새로 고침 — URL 화면은 사이트를 다시 불러오고(지금 사이트 그대로), 폴더 화면은 처음 상태로 */
  const reloadScreen = () => {
    if (live) (webview.current as unknown as { reload?: () => void } | null)?.reload?.();
    else reloadFrame();
  };

  /** 지금 틀을 처음부터 다시 */
  const reloadFrame = () => {
    const r = activeRef.current;
    if (!r) return;
    r.reload++;
    refresh();
  };

  /* Ctrl+휠 — 화면 배율 (프레임 밖 여백에서. 화면 안의 휠은 화면이 쓴다) */
  const onStageWheel = (e: WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomStep(e.deltaY < 0 ? 1 : -1, fitRef.current.s);
  };

  useEffect(() => {
    stageRef.frame = frameBox.current;
    stageRef.snip = snipBox.current;
  });

  /* 새 작성은 캡처부터. 작성을 끝내면 영역 녹화와 클립도 정리한다 */
  useEffect(() => {
    snipMode.value = 'capture';
    if (!draft.value) {
      stopSnipRecording();
      draftClip.value = null;
    }
  }, [draft.value]);
  /* 영역 녹화 중에는 화면을 돌린다 */
  useEffect(() => {
    if (!draft.peek()) return;
    bridge.current?.send({ type: snipRec.value ? 'resume' : 'pause' });
  }, [!!snipRec.value]);

  /* ── 에이전트에게 지금 상태 알리기 ─────────────────────────────────── */
  const anchorsMsg = () => ({
    type: 'anchors' as const,
    list: annotations.peek().filter((a) => a.anchor && samePage(a.anchor.page, pageRef.current)).map((a) => ({ id: a.id, fp: a.anchor!.fp, ...(a.anchor!.region ? { region: a.anchor!.region } : {}) })),
  });
  const syncAgent = () => {
    const b = bridge.current;
    if (!b) return;
    b.send(anchorsMsg());
    b.send({ type: 'picking', on: picking.peek() });
    b.send({ type: paused.peek() || picking.peek() || !!draft.peek() ? 'pause' : 'resume' });
    if (recording.peek()) {
      b.send({ type: 'picking', on: false });
      b.send({ type: 'resume' });
    }
    b.send({ type: 'trace', on: !!recording.peek() });
  };

  /* ── 에이전트와 잇기 — 지금 탭의 틀(FrameItem 이 띄워 둔 것)에 붙는다 ─────────── */
  useLayoutEffect(() => {
    const r = activeRef.current;
    const b = r?.bridge;
    if (!r || !b) return;
    bridge.current = b;
    if (r.live) webview.current = r.el as WebviewLike;
    else iframe.current = r.el as HTMLIFrameElement;
    rects.current = {};
    const off = b.on((m) => {
      if (m.type === 'ready') {
        refresh();
        syncAgent();
        takeSnapshot(4000);
        readyWaiters.current.splice(0).forEach((w) => w());
        // 다른 탭에서 연결을 따라 왔다 — 화면이 다 뜬 뒤에 그 Comment 자리를 찾는다
        const want = revealAfterLoad.peek();
        if (want) {
          revealAfterLoad.value = null;
          if (annotations.peek().some((x) => x.id === want)) requestReveal(want);
        }
      } else if (m.type === 'nav') {
        refresh();
      } else if (m.type === 'frame') {
        rects.current = m.rects;
        paint();
      } else if (m.type === 'input') {
        traceFeed.current?.(m);
      } else if (m.type === 'key') {
        // 녹화 중 화면 안에서 누른 키는 그 화면의 조작이다 — 테라리움 단축키로 받지 않는다
        if (recording.peek()) return;
        const ev = {
          key: m.key, ctrlKey: m.ctrl, metaKey: m.meta, shiftKey: m.shift, altKey: m.alt, repeat: m.repeat,
          target: m.typing ? { tagName: 'INPUT', isContentEditable: false } : null,
          preventDefault() {},
        } as unknown as KeyboardEvent;
        if (m.phase === 'down') onKeyDown(ev, true);
        else onKeyUp(ev);
      }
    });
    // 이미 떠 있던 틀로 돌아왔다 — 지금 상태(Comment 자리 · 피커 · 멈춤)를 다시 알린다
    if (r.ready) {
      syncAgent();
      // 연결을 따라 이 탭으로 왔다 — 화면은 이미 떠 있으니 바로 자리를 찾는다
      const want = revealAfterLoad.peek();
      if (want) {
        revealAfterLoad.value = null;
        if (annotations.peek().some((x) => x.id === want)) requestReveal(want);
      }
    }
    return () => {
      off();
      if (bridge.current === b) bridge.current = null;
      if (iframe.current === r.el) iframe.current = null;
      if (webview.current === r.el) webview.current = null;
      // 숨는 틀은 멈춰 둔다 — 돌아오면 이어서 돈다 (화면 상태는 그대로)
      try {
        b.send({ type: 'picking', on: false });
        b.send({ type: 'trace', on: false });
        b.send({ type: 'pause' });
      } catch {
        /* 이미 내린 틀 */
      }
    };
  }, [activeKey]);

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
  /* 원본 내려받기 직전에 — 지금 이 순간의 DOM 으로 사본을 새로 뜬다 */
  useEffect(() => {
    if (!live || !host.snapshotSite) return;
    const fn = async () => {
      const wv = webview.current as (WebviewLike & { getWebContentsId?: () => number }) | null;
      if (!wv?.getWebContentsId || !scr || !v) return false;
      const r = await host.snapshotSite!(wv.getWebContentsId()).catch(() => null);
      if (r) applySiteSnapshot(scr.id, v.v, r);
      return !!r;
    };
    liveSite.snapshot = fn;
    return () => {
      if (liveSite.snapshot === fn) liveSite.snapshot = null;
    };
  }, [frameKey, live, scr?.id, v?.v]);

  /* 앵커 목록이 바뀌면 다시 알린다 */
  const anchorKey = list.map((a) => (a.anchor ? `${a.id}:${a.anchor.fp.selector}:${JSON.stringify(a.anchor.region ?? '')}:${a.anchor.page ?? ''}` : '')).join('|');
  useEffect(() => {
    bridge.current?.send(anchorsMsg());
  }, [anchorKey, currentPage]);

  /* ── 찾지 못한 파일 보고 (shim → postMessage) ──────────────────────── */
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== iframe.current?.contentWindow) return;
      if (e.data?.manna === 'navigate') return setPage(pkgPath(String(e.data.url).split('#')[0].split('?')[0]));
      if (e.data?.manna !== 'miss') return;
      misses.value = [...misses.value, { url: pkgPath(String(e.data.url)) }];
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  /* ── 일시정지 · 피커 멈춤 그림 ───────────────────────────────────── */
  const freezeNo = useRef(0);
  useEffect(() => {
    if (recording.peek()) return; // 녹화가 정한다 (아래)
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
    if (isPicking || draft.peek() || recording.peek()) return;
    bridge.current?.send({ type: paused.value ? 'pause' : 'resume' });
  }, [paused.value]);

  /* 화면 녹화 — 화면을 돌리고 조작(커서 · 클릭 · 키)을 알려 달라고. 끝나면 쓰던 Comment 가 있으면 다시 멈춘다 */
  useEffect(() => {
    const b = bridge.current;
    b?.send({ type: 'trace', on: recOn });
    if (recOn) {
      b?.send({ type: 'picking', on: false });
      b?.send({ type: 'resume' });
    } else if (picking.peek() || draft.peek()) {
      b?.send({ type: 'picking', on: picking.peek() });
      b?.send({ type: 'pause' });
    } else if (!paused.peek()) b?.send({ type: 'resume' });
  }, [recOn]);

  /* ── 다른 화면 상태의 Comment 로 이동 ─────────────────────────────── */
  const revealDone = useRef<unknown>(null);
  useEffect(() => {
    const req = reveal.value;
    if (!req) return;
    const a = annotations.peek().find((x) => x.id === req.id);
    const b = bridge.current;
    if (revealDone.current === req) return;
    if (!b || loading) return; // 다 뜬 뒤에 (아래)
    revealDone.current = req;
    if (!a?.anchor) return;
    const anchor = a.anchor;
    let alive = true;
    const msg = { type: 'reveal' as const, fp: anchor.fp, ...(anchor.region ? { region: anchor.region } : {}), steps: anchor.path ?? [] };
    revealing.value = true;
    paused.value = false;
    (async () => {
      // 다른 페이지에서 단 Comment — 그 페이지를 열고 경로를 다시 누른다
      if (anchor.page && !samePage(anchor.page, pageRef.current)) {
        const ready = waitReady();
        setPage(anchor.page);
        await ready;
        if (!alive || !bridge.current) return;
        await bridge.current.ask({ ...msg, quick: false }, 60000);
        return;
      }
      const quick = await b.ask<{ ok: boolean }>({ ...msg, quick: true });
      if (!alive || quick?.ok) return;
      // 빠른 길로 안 되면 처음부터 다시 불러와 경로를 다시 누른다
      const ready = waitReady();
      reloadFrame();
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
  // 화면이 뜨는 중이라 못 했으면 다 뜬 뒤에 다시
  useEffect(() => {
    const req = reveal.peek();
    if (loading || !req || revealDone.current === req) return;
    requestReveal(req.id);
  }, [loading]);

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
      const x = Math.min(Math.max(t[0] * s - MARK / 2, 2), vw * s - MARK - 2);
      const y = Math.min(Math.max(t[1] * s - MARK / 2, 2), vhRef.current * s - MARK - 2);
      node.style.display = 'flex';
      node.style.transform = `translate(${x}px, ${y}px)`;
      node.dataset.tone = t[5] ? 'ondark' : 'onlight';
      if (id === selected.peek() || id === hovered.peek()) selRect = tupleBox(t);
    }
    // 캡처 Comment 는 마커가 없다 — 고르거나 마커 줄에서 가리키면 지금 화면의 그 자리를 박스로만 보인다
    for (const cid of [selected.peek(), hovered.peek()]) {
      const t = cid && !selRect && !shotViewRef.current ? rects.current[cid] : undefined;
      if (t && t[4]) selRect = tupleBox(t);
    }
    place(selBox.current, selRect, s);
    // 박스 보이기 — 화면에 붙어 보이는 Comment 의 대상을 모두 박스로
    const bl = boxes.current;
    if (bl) {
      for (const node of Array.from(bl.children) as HTMLElement[]) {
        const t = rects.current[node.dataset.id!];
        place(node, showBoxes.peek() && t && t[4] && seen.has(node.dataset.id!) ? tupleBox(t) : null, s);
      }
    }
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
  useEffect(paint, [fit, list.length, selected.value, hovered.value, draft.value, showBoxes.value]);

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
    if (!isImage) hoverAt(p);
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
    } else if (isImage) {
      // 그림 화면은 요소가 없다 — 클릭한 자리에 작은 박스
      const h = POINT_BOX / 2;
      setDraft(await bridge.current.ask<Picked>({ type: 'pickRect', x: Math.max(0, p.x - h), y: Math.max(0, p.y - h), w: POINT_BOX, h: POINT_BOX }));
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
  const scrolls = vfit === 'width' || z != null;

  const frameStyle = { left: `${fit.ox}px`, top: `${fit.oy}px`, width: `${vw * fit.s}px`, height: `${vh * fit.s}px` };
  const innerStyle = { width: `${vw}px`, height: `${vh}px`, transform: `scale(${fit.s})` };
  const shotBox = sel?.shot?.box;

  const spacer = { left: `${fit.ox + vw * fit.s + pad - 1}px`, top: `${fit.oy + vh * fit.s + pad - 1}px` };
  /* 달 때 찍은 그림 — 그때의 화면 비율 그대로 프레임 안에 담는다 (꽉 채우기로 비율이 달라져도 찌그러지지 않게) */
  const shotFit = (() => {
    const sh = sel?.shot;
    if (!sh) return null;
    const FW = vw * fit.s;
    const FH = vh * fit.s;
    const ra = sh.w / sh.h;
    const w = FW / FH > ra ? FH * ra : FW;
    const h = FW / FH > ra ? FH : FW / ra;
    return { x: (FW - w) / 2, y: (FH - h) / 2, w, h };
  })();
  const shotTarget = showShot && shotBox && shotFit
    ? { x: (shotFit.x + shotBox.x * shotFit.w) / fit.s, y: (shotFit.y + shotBox.y * shotFit.h) / fit.s, w: (shotBox.w * shotFit.w) / fit.s, h: (shotBox.h * shotFit.h) / fit.s }
    : null;
  const dr = draft.value;
  const snipStyle = dr && (dr.picked.region || v?.source?.mode === 'site')
    ? { left: `${dr.picked.rect[0] * fit.s}px`, top: `${dr.picked.rect[1] * fit.s}px`, width: `${dr.picked.rect[2] * fit.s}px`, height: `${dr.picked.rect[3] * fit.s}px` }
    : null;

  return (
    <div class="stage-col">
      <ScreenTabs tools={tabTools} canRename={host.author} windowTools={windowTools} />
      <div class="full-hot" aria-hidden="true" />
      <div class="stage-top">
      <StageHeader scr={scr} v={v} page={live ? null : page} onHome={() => setPage(null)} onReload={reloadScreen}
        siteView={host.site && isSite ? { gallery: galleryView, set: setGalleryView } : undefined} scale={fit.s} versionTools={versionTools} screenActions={screenActions} />
      <MarkerStrip />
      </div>
    {gallery && (
      <div class="stage stage-gallery">
        <SiteGallery host={host} scr={scr} v={v} hasCopy={host.site ? true : hasCopy} copyLabel={host.site ? '실시간 사이트 보기' : '마지막 사본 보기'} onCopy={() => (host.site ? setGalleryView(false) : setCopyView(true))} />
      </div>
    )}
    <RecordingBar />
    <LinkingBar />
    {/* 캡처 모음을 보는 동안에도 띄워 둔 틀은 내리지 않는다 — 뒤에 숨겨 둔다 */}
    <div class={`stage ${scrolls ? 'stage-scroll' : ''} ${gallery ? 'is-behind' : ''}`} ref={area} onWheel={onStageWheel} aria-hidden={gallery || undefined}>
      {copyView && (
        <button type="button" class="stage-badge stage-badge-shot gal-back" onClick={() => setCopyView(false)}>캡처 모음으로</button>
      )}
      {scrolls && <div class="stage-spacer" style={spacer} />}
      <div class={`stage-frame ${recording.value || capturing || snipRec.value ? 'is-recording' : ''}`} style={frameStyle} ref={frameBox}>
        {/* 처음 띄운 순서 그대로 그린다 — iframe · webview 는 DOM 에서 자리를 옮기면 다시 불러온다 */}
        {[...aliveNow].sort((x, y) => aliveRecs.current.get(x)!.seq - aliveRecs.current.get(y)!.seq).map((k) => {
          const r = aliveRecs.current.get(k)!;
          const s2 = doc.value.screens.find((x) => x.id === r.screen)!;
          const ver = s2.versions.find((x) => x.v === r.v)!;
          const on = k === activeKey;
          if (on) r.style = innerStyle;
          return (
            <FrameItem
              key={k}
              rec={r}
              ver={ver}
              title={`${s2.id} ${s2.title} v${ver.v}`}
              active={on}
              style={r.style ?? innerStyle}
              partition={host.site?.partition}
              onChange={refresh}
            />
          );
        })}
        {still.value && !snipRec.value && !recOn && <img class="stage-still" src={still.value.url} alt="" draggable={false} />}
        <TraceLayer on={recOn} scale={fit.s} feed={traceFeed} />
        {snipStyle && <div class={`snip-target ${snipRec.value ? 'is-rec' : ''}`} ref={snipBox} style={snipStyle} aria-hidden="true" />}
        {showShot && shotSrc && (
          <div class="shot-view">
            <div class="shot-fit" style={shotFit ? { left: `${shotFit.x}px`, top: `${shotFit.y}px`, width: `${shotFit.w}px`, height: `${shotFit.h}px` } : undefined}>
              <img src={shotSrc} alt="이 Comment 를 달 때의 화면" draggable={false} />
              {shotBox && (
                <div class="shot-box" style={{ left: `${shotBox.x * 100}%`, top: `${shotBox.y * 100}%`, width: `${shotBox.w * 100}%`, height: `${shotBox.h * 100}%` }} />
              )}
            </div>
          </div>
        )}
        {isPicking && (
          <div class="pick-layer" onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp} onWheel={onWheel}
            onPointerLeave={() => !pick.current.down && !draft.peek() && place(pickBox.current, null, 1)} />
        )}
        <div class={`box-layer ${showBoxes.value ? 'is-on' : ''}`} ref={boxes} aria-hidden="true">
          {list.filter((a) => a.anchor && a.kind !== 'capture' && v.source?.mode !== 'site' && (!a.done || showDone.value)).map((a) => <div key={a.id} class="hl-box hl-all" data-id={a.id} />)}
        </div>
        <div class="hl-box hl-sel" ref={selBox} />
        <div class="hl-box hl-pick" ref={pickBox} />
        <div class="hl-box hl-drag" ref={dragBox} />
        <PinLayer scale={fit.s} page={currentPage} frame={() => frameBox.current} />
        <LinkAreaLayer scale={fit.s} page={currentPage} />
        <AreaDraw local={local} page={currentPage} scale={fit.s} />
        {pinTool.value && (
          <div
            class={`pin-place pin-place-${pinTool.value}`}
            title="누른 자리에 박는다 (Esc 로 그만)"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              const p = local(e);
              const id = addPin(p.x, p.y, pinTool.peek()!);
              pinTool.value = null;
              if (id) {
                pinSel.value = id;
                pinNaming.value = id;
              }
            }}
          />
        )}
        <div class="marker-layer" ref={markers} data-color={markerColor} data-labels={markerLabels.value ? 'on' : 'off'}>
          {list.filter((a) => a.anchor && a.kind !== 'capture' && v.source?.mode !== 'site' && (!a.done || showDone.value)).map((a) => <Marker key={a.id} a={a} scr={scr} />)}
        </div>
        {(loading || revealing.value) && !error && <div class="stage-note" aria-label="불러오는 중"><span class="spinner" /></div>}
        {showShot && (
          <div class="stage-badge stage-badge-shot">
            <span title="이 Comment 를 달 때 찍어 둔 화면입니다. 지금 화면과 다를 수 있습니다.">{sel?.kind === 'capture' || v.source?.mode === 'site' ? '캡처' : 'Comment 를 달 때 찍은 화면'}{sel?.createdAt ? ` · ${ago(sel.createdAt)}` : ''}</span>
            <button
              type="button"
              class="badge-btn"
              onClick={() => {
                shotView.value = false;
                // 캡처는 마커가 없다 — 지금 화면에서 그 자리를 찾아가 박스로 보인다
                if ((sel?.kind === 'capture' || v.source?.mode === 'site') && !rects.current[sel!.id]?.[4]) requestReveal(sel!.id);
              }}
            >
              지금 화면 보기
            </button>
          </div>
        )}

      </div>
      {!gallery && (
        <StagePopover
          host={host}
          fit={fit}
          target={draft.value ? tupleBox(draft.value.picked.rect) : shotTarget ?? popRect}
          areaRef={area}
        />
      )}
      {error && !gallery && (
        <div class="stage-error" role="alert">
          <strong>화면을 열지 못했습니다.</strong>
          <span>{error}</span>
          <span>테라리움에서 이 화면 버전을 다시 등록해 주세요.</span>
        </div>
      )}
      {!gallery && (misses.value.length > 0 || warnings.length > 0) && <Diagnostics warnings={warnings} />}
    </div>
    </div>
  );
}

/** 띄워 둔 화면 틀 하나 — 한 탭(화면 · 버전). 다리(에이전트와 잇기)는 틀이 살아 있는 동안 그대로다 */
interface Alive {
  key: string;
  /** 처음 띄운 차례 — 그리는 순서 */
  seq: number;
  screen: string;
  v: number;
  live: boolean;
  /** 패키지 안의 다른 페이지로 옮겨 갔으면 그 페이지 (URL 화면은 주소) */
  page: string | null;
  /** 처음부터 다시 불러온 횟수 */
  reload: number;
  ready: boolean;
  liveUrl: string | null;
  error: string | null;
  warnings: string[];
  /** 마지막으로 보일 때의 크기 — 숨은 동안 그대로 둔다 (크기가 바뀌어 화면이 다시 배치되지 않게) */
  style: Record<string, string> | null;
  bridge: Bridge | null;
  el: HTMLElement | null;
}
const MAX_ALIVE = 8;
let aliveSeq = 0;

function FrameItem({ rec, ver, title, active, style, partition, onChange }: {
  rec: Alive; ver: ScreenVersion; title: string; active: boolean; style: Record<string, string>; partition?: string; onChange: () => void;
}) {
  const el = useRef<HTMLElement>(null);
  // 다리 — 틀이 살아 있는 동안 하나. 다 떴는지 · 주소가 바뀌었는지는 숨어 있어도 기억한다
  useLayoutEffect(() => {
    const e = el.current;
    if (!e) return;
    rec.el = e;
    const b = rec.live ? webviewBridge(e as WebviewLike) : iframeBridge(e as HTMLIFrameElement);
    rec.bridge = b;
    const off = b.on((m) => {
      if (m.type === 'ready') {
        rec.ready = true;
        if (rec.live) rec.liveUrl = m.url;
      } else if (m.type === 'nav' && rec.live) rec.liveUrl = m.url;
    });
    return () => {
      off();
      b.dispose();
      if (rec.bridge === b) rec.bridge = null;
      if (rec.el === e) rec.el = null;
    };
  }, []);
  // 폴더 화면 — 처음 한 번, 그리고 다른 페이지로 가거나 처음부터 다시 할 때만 불러온다
  useEffect(() => {
    const f = el.current as HTMLIFrameElement | null;
    if (rec.live || !f) return;
    let alive = true;
    let dispose: (() => void) | undefined;
    rec.ready = false;
    rec.error = null;
    rec.warnings = [];
    onChange();
    prepareScreen(ver, blobs, rec.page ?? undefined)
      .then((p) => {
        if (!alive) return p.dispose();
        dispose = p.dispose;
        rec.warnings = p.warnings;
        if (p.warnings.length) onChange();
        f.srcdoc = p.srcdoc;
      })
      .catch((e: Error) => {
        rec.error = e.message;
        rec.ready = true;
        onChange();
      });
    return () => {
      alive = false;
      dispose?.();
    };
  }, [rec.page, rec.reload]);
  const cls = active ? '' : 'is-hidden';
  if (rec.live) {
    return (
      <webview
        ref={el as never}
        class={`stage-webview ${cls}`}
        src={rec.page ?? ver.source!.url}
        partition={partition}
        webpreferences="contextIsolation=yes,sandbox=yes"
        style={style}
      />
    );
  }
  return (
    <iframe
      ref={el as never}
      onLoad={() => {
        // 스크립트가 location 으로 다른 페이지로 갔다 — srcdoc 밖이면 같은 이름의 패키지 페이지를 연다
        try {
          const href = (el.current as HTMLIFrameElement | null)?.contentWindow?.location.href ?? '';
          if (!href || href.startsWith('about:')) return;
          const rel = decodeURIComponent(new URL(href).pathname.split('/').pop() ?? '');
          if (rel && ver.files[rel] && rec.page !== rel) {
            rec.page = rel;
            onChange();
          }
        } catch {
          /* 다른 출처 — 어쩔 수 없다 */
        }
      }}
      class={`stage-iframe ${cls}`}
      title={title}
      tabIndex={active ? undefined : -1}
      style={style}
    />
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
      title={`${displayNo(scr, a)}${a.title ? ` ${a.title}` : ''} · ${whoText(a)}`}
      data-label={a.title ? `${a.title} · ${whoText(a)}` : whoText(a)}
      onClick={(e) => {
        e.stopPropagation();
        if (sel && popHidden.peek()) popHidden.value = false;
        else selected.value = sel ? null : a.id;
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
