/* 긴 화면 녹화 — 길이에 매이지 않고 계속 담는다. 멈춘 뒤 편집기(ui/RecEditor.tsx)에서 구간(최대 1분)을 잘라 Comment 로
 *
 * MediaRecorder 대신 WebCodecs 로 프레임을 직접 인코딩한다 — 1초마다 키프레임을 넣어 두어야
 * 다시 인코딩하지 않고 아무 자리에서나 자를 수 있다(webm.ts). 인코딩한 프레임은 2초마다 IndexedDB 에도 적어 둔다:
 * 편집을 끝내기 전에 프로그램이 꺼져도 다음에 열 때 이어서 편집할 수 있다. 편집을 끝내거나 버리면 지운다.
 */
import { openStageStream } from './record';
import type { Frame, Track } from './webm';

export interface Take extends Track {
  id: string;
  /** 녹화한 문서 — 다시 열 때 그 문서의 창에서만 되살린다 */
  doc: string;
  /** 녹화한 화면 */
  screen: string;
  at: string;
  ms: number;
  frames: Frame[];
}

export interface LongRecorder {
  stop(): Promise<Take>;
  /** 공유가 밖에서 끊겼거나 인코더가 멈췄을 때 */
  onEnded(cb: () => void): void;
  stats(): { ms: number; bytes: number };
}

const MAX_W = 1600;
const BITRATE = 1_500_000;
const KEY_EVERY_US = 1_000_000;
const SAVE_EVERY = 2000;

const CODECS: [string, string][] = [
  ['vp8', 'V_VP8'],
  ['vp09.00.10.08', 'V_VP9'],
];

async function pickCodec(w: number, h: number): Promise<[string, string]> {
  if (typeof VideoEncoder === 'undefined') throw new Error('이 브라우저는 긴 녹화(WebCodecs)를 지원하지 않습니다. Chrome 이나 Edge 에서 열어 주세요.');
  for (const c of CODECS) {
    const r = await VideoEncoder.isConfigSupported({ codec: c[0], width: w, height: h, bitrate: BITRATE, latencyMode: 'realtime' }).catch(() => null);
    if (r?.supported) return c;
  }
  throw new Error('이 브라우저에서 쓸 수 있는 영상 인코더가 없습니다.');
}

type TrackProcessorCtor = new (o: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> };

/** 영상 트랙에서 프레임을 받는다 — MediaStreamTrackProcessor, 없으면 <video> 의 requestVideoFrameCallback */
function frames(stream: MediaStream, onFrame: (f: VideoFrame) => void): () => void {
  let on = true;
  const P = (window as unknown as { MediaStreamTrackProcessor?: TrackProcessorCtor }).MediaStreamTrackProcessor;
  if (P) {
    const reader = new P({ track: stream.getVideoTracks()[0] }).readable.getReader();
    void (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done || !value) break;
        if (!on) {
          value.close();
          break;
        }
        onFrame(value);
      }
    })().catch(() => {});
    return () => {
      on = false;
      reader.cancel().catch(() => {});
    };
  }
  const v = document.createElement('video');
  v.muted = true;
  v.srcObject = stream;
  void v.play().catch(() => {});
  const step = () => {
    if (!on) return;
    if (v.videoWidth) onFrame(new VideoFrame(v, { timestamp: Math.round(performance.now() * 1000) }));
    v.requestVideoFrameCallback(step);
  };
  v.requestVideoFrameCallback(step);
  return () => {
    on = false;
    v.srcObject = null;
  };
}

export async function startLongRecording(target: HTMLElement, o: { doc: string; screen: string; id: string }): Promise<LongRecorder> {
  const st = await openStageStream(target);
  try {
    // 크기는 고정 — 프레임을 캔버스에 맞춰 그려 넣는다 (녹화 중 창 크기가 바뀌어도 인코더 설정은 그대로)
    const scale = Math.min(1, MAX_W / st.w);
    const w = Math.max(2, Math.round((st.w * scale) / 2) * 2);
    const h = Math.max(2, Math.round((st.h * scale) / 2) * 2);
    const [codec, codecId] = await pickCodec(w, h);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d')!;

    const take: Take = { id: o.id, doc: o.doc, screen: o.screen, at: new Date().toISOString(), codec: codecId, w, h, ms: 0, frames: [] };
    let bytes = 0;
    let unsaved: Frame[] = [];
    let seq = 0;
    let ended: (() => void) | null = null;
    let failed: Error | null = null;
    const enc = new VideoEncoder({
      output: (chunk) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        const f: Frame = { t: chunk.timestamp / 1000, key: chunk.type === 'key', data };
        take.frames.push(f);
        unsaved.push(f);
        bytes += data.length;
      },
      error: (e) => {
        failed = e instanceof Error ? e : new Error(String(e));
        ended?.();
      },
    });
    enc.configure({ codec, width: w, height: h, bitrate: BITRATE, bitrateMode: 'variable', latencyMode: 'realtime', framerate: 30 });

    let t0 = -1;
    let lastT = -1;
    let lastKey = -Infinity;
    const stopFrames = frames(st.stream, (frame) => {
      if (t0 < 0) t0 = frame.timestamp;
      const t = frame.timestamp - t0;
      // 인코더가 밀리면 이 프레임은 건너뛴다 (화면 공유는 다음 프레임을 곧 준다)
      if (enc.state !== 'configured' || enc.encodeQueueSize > 6 || t <= lastT) return frame.close();
      ctx.drawImage(frame, 0, 0, w, h);
      frame.close();
      const vf = new VideoFrame(canvas, { timestamp: t });
      const key = t - lastKey >= KEY_EVERY_US;
      enc.encode(vf, { keyFrame: key });
      vf.close();
      if (key) lastKey = t;
      lastT = t;
    });
    const started = performance.now();
    st.track.addEventListener('ended', () => ended?.());

    const save = async () => {
      const part = unsaved;
      unsaved = [];
      take.ms = Math.round(performance.now() - started);
      await putMeta(take);
      if (part.length) await putPart(take.id, seq++, part);
    };
    await holdTake(take.id);
    await putMeta(take);
    const saver = setInterval(() => void save(), SAVE_EVERY);

    return {
      onEnded(cb) {
        ended = cb;
      },
      stats: () => ({ ms: performance.now() - started, bytes }),
      async stop() {
        // 켜자마자 멈추면 아직 프레임이 없다 — 한 장이라도 담길 때까지 (길어야 3초)
        for (const until = performance.now() + 3000; !take.frames.length && !failed && performance.now() < until; ) {
          await new Promise((r) => setTimeout(r, 100));
        }
        stopFrames();
        clearInterval(saver);
        try {
          if (enc.state === 'configured') await enc.flush();
        } catch {
          /* 이미 멈춘 인코더 */
        }
        if (enc.state !== 'closed') enc.close();
        st.close();
        await save();
        take.ms = Math.max(take.ms, Math.ceil(take.frames[take.frames.length - 1]?.t ?? 0) + 34);
        await putMeta(take);
        if (!take.frames.length) {
          await dropTake(take.id);
          throw failed ?? new Error('녹화된 내용이 없습니다.');
        }
        return take;
      },
    };
  } catch (e) {
    st.close();
    throw e;
  }
}

/* ── 편집 전 녹화 보관 (IndexedDB) ─────────────────────────────────────── */

const DB = 'terrarium-rec';
type Meta = Omit<Take, 'frames'>;

function open(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('takes');
      req.result.createObjectStore('parts');
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      ok(req.result);
    };
    req.onerror = () => fail(req.error);
  });
}

async function run<T>(store: 'takes' | 'parts', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const db = await open();
    try {
      return await new Promise<T>((ok, fail) => {
        const req = fn(db.transaction(store, mode).objectStore(store));
        req.onsuccess = () => ok(req.result);
        req.onerror = () => fail(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return undefined; // 사생활 보호 모드 · 저장 공간 부족 — 되살리지 못할 뿐 녹화는 메모리에 있다
  }
}

const range = (id: string) => IDBKeyRange.bound(`${id}/`, `${id}/￿`);
const meta = (t: Take): Meta => ({ id: t.id, doc: t.doc, screen: t.screen, at: t.at, codec: t.codec, w: t.w, h: t.h, ms: t.ms });
const putMeta = (t: Take) => run('takes', 'readwrite', (s) => s.put(meta(t), t.id));
const putPart = (id: string, seq: number, f: Frame[]) => run('parts', 'readwrite', (s) => s.put(f, `${id}/${String(seq).padStart(7, '0')}`));

/** 이 문서에서 편집을 끝내지 못한 녹화 */
export async function pendingTakes(doc: string): Promise<Meta[]> {
  const all = (await run<Meta[]>('takes', 'readonly', (s) => s.getAll() as IDBRequest<Meta[]>)) ?? [];
  return all.filter((m) => m.doc === doc).sort((a, b) => a.at.localeCompare(b.at));
}

export async function loadTake(id: string): Promise<Take | null> {
  const m = await run<Meta>('takes', 'readonly', (s) => s.get(id) as IDBRequest<Meta>);
  if (!m) return null;
  const parts = (await run<Frame[][]>('parts', 'readonly', (s) => s.getAll(range(id)) as IDBRequest<Frame[][]>)) ?? [];
  const frames = parts.flat();
  if (!frames.length) return null;
  return { ...m, frames, ms: Math.max(m.ms, Math.ceil(frames[frames.length - 1].t) + 34) };
}

export async function dropTake(id: string): Promise<void> {
  await run('parts', 'readwrite', (s) => s.delete(range(id)));
  await run('takes', 'readwrite', (s) => s.delete(id));
  releaseTake(id);
}

/* 녹화 · 편집 중인 창이 그 녹화를 쥐고 있다 (Web Locks) — 같은 프로젝트의 다른 창이 열려도 그것을 "끝내지 못한 녹화"로 되살리지 않는다.
 * 창이 닫히면(꺼지면) 쥔 것이 풀려 다음에 연 창이 되살린다 */
const held = new Map<string, () => void>();

/** 쥐었으면 true — 다른 창이 쥐고 있으면 false */
export function holdTake(id: string): Promise<boolean> {
  if (held.has(id)) return Promise.resolve(true);
  if (!navigator.locks) return Promise.resolve(true);
  return new Promise((ok) => {
    navigator.locks
      .request(`terrarium-rec:${id}`, { ifAvailable: true }, (lock) => {
        if (!lock) return ok(false);
        ok(true);
        return new Promise<void>((release) => held.set(id, release));
      })
      .catch(() => ok(true));
  });
}

export function releaseTake(id: string): void {
  held.get(id)?.();
  held.delete(id);
}
