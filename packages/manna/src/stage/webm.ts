/* 아주 작은 WebM 쓰기 — 긴 녹화(longrec.ts)의 인코딩된 프레임을 볼 수 있는 파일로, 구간만 잘라서도
 *
 * MediaRecorder 가 만든 webm 은 길이 · 찾기 표(Cues)가 없어 긴 영상에서 시간 이동이 안 되고, 원하는 자리에서 자를 수도 없다.
 * 그래서 프레임을 직접 인코딩해 두고(키프레임 1초마다) 여기서 webm 으로 묶는다. 자르기는 다시 인코딩하지 않고
 * 시작 직전 키프레임부터 프레임을 그대로 옮긴다 — 그래서 시작이 최대 1초 앞당겨진다.
 *
 * 구조: EBML 머리 · Segment[ Info(길이) · Tracks · Cues · Cluster… ]. Cues 를 Cluster 앞에 둬야 브라우저가 처음 읽을 때 찾기 표를 안다.
 */

export interface Frame {
  /** 녹화 시작부터 ms */
  t: number;
  key: boolean;
  data: Uint8Array;
}

export interface Track {
  /** V_VP8 · V_VP9 */
  codec: string;
  w: number;
  h: number;
}

const enc = new TextEncoder();

function uintBytes(n: number, len?: number): Uint8Array {
  let l = len ?? 1;
  if (!len) while (l < 8 && n >= 2 ** (8 * l)) l++;
  const out = new Uint8Array(l);
  for (let i = l - 1; i >= 0; i--) {
    out[i] = n % 256;
    n = Math.floor(n / 256);
  }
  return out;
}

function idBytes(id: number): Uint8Array {
  return uintBytes(id);
}

/** 크기 vint — 맨 앞 비트로 길이를 적는다 */
function sizeBytes(n: number, len?: number): Uint8Array {
  let l = len ?? 1;
  if (!len) while (l < 8 && n >= 2 ** (7 * l) - 1) l++;
  const out = uintBytes(n, l);
  out[0] |= 0x80 >> (l - 1);
  return out;
}

const cat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

const el = (id: number, ...body: Uint8Array[]): Uint8Array => {
  const b = cat(body);
  return cat([idBytes(id), sizeBytes(b.length), b]);
};
const u = (id: number, n: number, len?: number) => el(id, uintBytes(n, len));
const str = (id: number, s: string) => el(id, enc.encode(s));
const f64 = (id: number, x: number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, x);
  return el(id, b);
};

const EBML_HEAD = el(0x1a45dfa3, u(0x4286, 1), u(0x42f7, 1), u(0x42f2, 4), u(0x42f3, 8), str(0x4282, 'webm'), u(0x4287, 4), u(0x4285, 2));

/** 한 Cluster 의 바이트 조각들 — 프레임 데이터는 복사하지 않고 그대로 가리킨다 */
interface ClusterParts {
  tc: number;
  parts: Uint8Array[];
  size: number;
}

function clusters(frames: Frame[]): ClusterParts[] {
  const out: ClusterParts[] = [];
  let cur: ClusterParts | null = null;
  for (const f of frames) {
    const t = Math.max(0, Math.round(f.t));
    // 키프레임마다 새 Cluster (찾기 표가 가리키는 자리). 상대 시각이 16비트를 넘어도 새로
    if (!cur || f.key || t - cur.tc > 30000) {
      const tcEl = u(0xe7, t);
      cur = { tc: t, parts: [tcEl], size: tcEl.length };
      out.push(cur);
    }
    const rel = t - cur.tc;
    const head = new Uint8Array(4);
    head[0] = 0x81; // 트랙 1
    new DataView(head.buffer).setInt16(1, rel);
    head[3] = f.key ? 0x80 : 0;
    const blockHead = cat([idBytes(0xa3), sizeBytes(4 + f.data.length), head]);
    cur.parts.push(blockHead, f.data);
    cur.size += blockHead.length + f.data.length;
  }
  return out;
}

/** 프레임들을 webm 으로. ms 는 영상 길이 (마지막 프레임이 그때까지 보인다) */
export function muxWebm(track: Track, frames: Frame[], ms: number): Blob {
  const info = el(0x1549a966, u(0x2ad7b1, 1_000_000), f64(0x4489, Math.max(1, ms)), str(0x4d80, 'Terrarium'), str(0x5741, 'Terrarium'));
  const tracks = el(
    0x1654ae6b,
    el(0xae, u(0xd7, 1), u(0x73c5, 1), u(0x9c, 0), u(0x83, 1), str(0x86, track.codec), el(0xe0, u(0xb0, track.w), u(0xba, track.h))),
  );
  const cl = clusters(frames);
  const clHeads = cl.map((c) => cat([idBytes(0x1f43b675), sizeBytes(c.size)]));
  // 찾기 표 — 위치는 8바이트 고정이라 표 크기가 위치 값에 따라 바뀌지 않는다
  const keyed = cl.map((c, i) => ({ c, i })).filter(({ c }) => isKeyCluster(c));
  const cuesOf = (pos: number[]) =>
    keyed.length ? el(0x1c53bb6b, ...keyed.map(({ c, i }) => el(0xbb, u(0xb3, c.tc), el(0xb7, u(0xf7, 1), u(0xf1, pos[i] ?? 0, 8))))) : new Uint8Array(0);
  const pos: number[] = [];
  let off = info.length + tracks.length + cuesOf([]).length;
  cl.forEach((c, i) => {
    pos[i] = off;
    off += clHeads[i].length + c.size;
  });
  const cues = cuesOf(pos);
  const segHead = cat([idBytes(0x18538067), sizeBytes(off, 8)]);
  const parts: Uint8Array[] = [EBML_HEAD, segHead, info, tracks, cues];
  cl.forEach((c, i) => parts.push(clHeads[i], ...c.parts));
  return new Blob(parts as BlobPart[], { type: 'video/webm' });
}

/** Cluster 의 첫 블록이 키프레임인지 (블록 머리 4번째 바이트) */
function isKeyCluster(c: ClusterParts): boolean {
  const head = c.parts[1];
  return !!head && (head[head.length - 1] & 0x80) !== 0;
}

/** [from, to) 구간 — 시작 직전 키프레임부터 다시 인코딩하지 않고 옮긴다. 실제 시작 · 길이를 함께 */
export function cutFrames(frames: Frame[], from: number, to: number): { frames: Frame[]; start: number; ms: number } {
  let k = 0;
  for (let i = 0; i < frames.length && frames[i].t <= from; i++) if (frames[i].key) k = i;
  const start = frames[k]?.t ?? 0;
  const out: Frame[] = [];
  for (let i = k; i < frames.length && frames[i].t < to; i++) out.push({ ...frames[i], t: frames[i].t - start });
  return { frames: out, start, ms: Math.max(1, Math.round(to - start)) };
}
