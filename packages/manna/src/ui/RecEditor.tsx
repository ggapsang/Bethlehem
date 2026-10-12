/* 녹화 편집기 — 멈춘 긴 녹화에서 구간(최대 1분)을 잘라 Comment 로 나눈다
 *
 * 녹화는 길이에 매이지 않는다(stage/longrec.ts). 1분 제한은 여기서 잘라 낸 구간에만 걸린다.
 * 구간마다 새 Comment(구간 첫 장면이 캡처가 된다) · 쓰고 있는 Comment · 이미 있는 Comment 중 어디에 넣을지 고른다.
 * 원본은 편집을 끝내면 버린다 — 따로 두려면 "원본 저장"으로 webm 을 내려받는다.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Film, Pause, Play, Plus, Scissors, Trash2 } from 'lucide-preact';
import { displayNo } from '@core';
import { CLIP_MAX_MS, applyTakeCuts, closeTake, type TakeCut } from '../actions';
import { downloadFile } from '../host';
import { cutFrames, muxWebm } from '../stage/webm';
import { dropTake, holdTake, loadTake, pendingTakes, releaseTake, type Take } from '../stage/longrec';
import { doc, draft, notify, recTake, rev, screen, selected, version } from '../store';

const ICON = { size: 16, strokeWidth: 1.5 };
/** 새 구간의 처음 길이 */
const NEW_MS = 10_000;
const MIN_MS = 500;

interface Seg {
  id: number;
  from: number;
  to: number;
  /** 'new' · 'draft' · 이미 있는 Comment id */
  target: string;
  title: string;
  body: string;
}

/** 0:12.3 · 1:02:03 */
export function clock(ms: number, tenths = true): string {
  const s = Math.max(0, ms) / 1000;
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  const sec = Math.floor(s % 60);
  const t = tenths ? `.${Math.floor((s * 10) % 10)}` : '';
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}${t}` : `${m}:${String(sec).padStart(2, '0')}${t}`;
}

const mb = (n: number) => `${(n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)}MB`;

/** 편집을 끝내지 못한 녹화가 있으면 (프로그램이 꺼졌을 때) 이 문서를 열 때 다시 연다 */
function useResume(): void {
  const id = doc.value.id;
  useEffect(() => {
    let off = false;
    void (async () => {
      if (recTake.peek()) return;
      const list = await pendingTakes(id);
      for (const m of list) {
        // 다른 창이 녹화 · 편집 중인 것은 건너뛴다
        if (off || !(await holdTake(m.id))) continue;
        const t = await loadTake(m.id);
        // 프레임이 하나도 적히지 않은 것 — 되살릴 것이 없다
        if (!t) {
          await dropTake(m.id);
          continue;
        }
        if (off || recTake.peek()) return releaseTake(m.id);
        recTake.value = t;
        notify(`끝내지 못한 녹화(${clock(t.ms, false)})를 다시 열었습니다. 구간을 잘라 넣거나 버리세요.`);
        return;
      }
    })();
    return () => {
      off = true;
    };
  }, [id]);
}

export function RecEditor() {
  useResume();
  const take = recTake.value;
  return take ? createPortal(<Editor key={take.id} take={take} />, document.body) : null;
}

function Editor({ take }: { take: Take }) {
  rev.value;
  const video = useRef<HTMLVideoElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const url = useMemo(() => URL.createObjectURL(muxWebm(take, take.frames, take.ms)), [take]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const size = useMemo(() => take.frames.reduce((n, f) => n + f.data.length, 0), [take]);
  const dur = take.ms;

  const s = doc.value.screens.find((x) => x.id === take.screen) ?? screen.value;
  const v = s && s.id === screen.value?.id ? version.value?.v : s?.versions[s.versions.length - 1].v;
  const existing = s ? s.annotations.filter((a) => a.version === v) : [];
  const hasDraft = !!draft.value && s?.id === screen.value?.id;

  // 짧으면 통째로 한 구간 — 쓰고 있는 Comment · 고른 Comment 가 있으면 거기로
  const [segs, setSegs] = useState<Seg[]>(() => {
    if (dur > CLIP_MAX_MS) return [];
    const sel = selected.peek();
    const target = hasDraft ? 'draft' : sel && existing.some((a) => a.id === sel) ? sel : 'new';
    return [{ id: 1, from: 0, to: dur, target, title: '', body: '' }];
  });
  const [cur, setCur] = useState<number | null>(segs[0]?.id ?? null);
  const nextId = useRef(2);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const stopAt = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [dropAsk, setDropAsk] = useState(false);

  useEffect(() => root.current?.focus(), []);
  // 재생 중 — 재생 위치를 부드럽게, 구간 재생이면 구간 끝에서 멈춘다
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const step = () => {
      const el = video.current;
      if (!el) return;
      const ms = el.currentTime * 1000;
      if (stopAt.current !== null && ms >= stopAt.current) {
        el.pause();
        stopAt.current = null;
      }
      setT(ms);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const seek = (ms: number) => {
    const x = Math.min(Math.max(0, ms), dur);
    setT(x);
    if (video.current) video.current.currentTime = x / 1000;
  };
  const toggle = () => {
    const el = video.current;
    if (!el) return;
    if (el.paused) {
      stopAt.current = null;
      if (t >= dur - 50) seek(0);
      void el.play();
    } else el.pause();
  };
  const playSeg = (g: Seg) => {
    seek(g.from);
    stopAt.current = g.to;
    void video.current?.play();
  };

  const sel = segs.find((g) => g.id === cur) ?? null;
  const patch = (id: number, p: Partial<Seg>) => setSegs((list) => list.map((g) => (g.id === id ? { ...g, ...p } : g)));
  const add = (from: number, to: number) => {
    const g: Seg = { id: nextId.current++, from, to, target: 'new', title: '', body: '' };
    setSegs((list) => [...list, g].sort((a, b) => a.from - b.from));
    setCur(g.id);
  };
  // 구간 시작 · 끝을 재생 위치로 — 1분을 넘으면 반대쪽을 끌고 온다
  const markIn = () => {
    if (!sel) return add(t, Math.min(dur, t + NEW_MS));
    const to = sel.to <= t + MIN_MS ? Math.min(dur, t + NEW_MS) : Math.min(sel.to, t + CLIP_MAX_MS);
    patch(sel.id, { from: t, to });
  };
  const markOut = () => {
    if (!sel) return add(Math.max(0, t - NEW_MS), t);
    const from = sel.from >= t - MIN_MS ? Math.max(0, t - NEW_MS) : Math.max(sel.from, t - CLIP_MAX_MS);
    patch(sel.id, { from, to: t });
  };
  const remove = (id: number) => {
    setSegs((list) => list.filter((g) => g.id !== id));
    if (cur === id) setCur(null);
  };

  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation(); // 테라리움 단축키로 받지 않는다
    const typing = (e.target as HTMLElement).closest('input, textarea, select');
    if (typing) return;
    const k = e.key.toLowerCase();
    if (k === ' ') toggle();
    else if (k === 'i') markIn();
    else if (k === 'o') markOut();
    else if (k === 'arrowleft') seek(t - (e.shiftKey ? 10_000 : 1000));
    else if (k === 'arrowright') seek(t + (e.shiftKey ? 10_000 : 1000));
    else if (k === 'delete' && sel) remove(sel.id);
    else return;
    e.preventDefault();
  };

  /** 구간 첫 장면 — 새 Comment 의 캡처 */
  const grab = async (ms: number): Promise<TakeCut['shot']> => {
    const el = video.current;
    if (!el) return undefined;
    el.pause();
    await new Promise<void>((r) => {
      const done = () => r();
      el.addEventListener('seeked', done, { once: true });
      el.currentTime = ms / 1000;
      setTimeout(done, 2000);
    });
    const c = document.createElement('canvas');
    c.width = take.w;
    c.height = take.h;
    c.getContext('2d')!.drawImage(el, 0, 0, take.w, take.h);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return blob ? { bytes: new Uint8Array(await blob.arrayBuffer()), w: take.w, h: take.h } : undefined;
  };

  const apply = async () => {
    if (!segs.length || busy) return;
    setBusy(true);
    try {
      const cuts: TakeCut[] = [];
      for (const g of segs) {
        const c = cutFrames(take.frames, g.from, g.to);
        const bytes = new Uint8Array(await muxWebm(take, c.frames, c.ms).arrayBuffer());
        cuts.push({ bytes, ms: c.ms, target: g.target, title: g.title, body: g.body, ...(g.target === 'new' ? { shot: await grab(c.start) } : {}) });
      }
      const n = await applyTakeCuts(take, cuts);
      if (!n) return;
      await closeTake(take);
      const made = segs.filter((g) => g.target === 'new').length;
      const att = n - made;
      notify([made && `새 Comment ${made}개`, att && `${att}개 구간을 Comment 에 붙임`].filter(Boolean).join(' · ') + ' — 원본 녹화는 버렸습니다.');
    } catch (e) {
      notify(`구간을 넣지 못했습니다: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveRaw = () => {
    const name = `${doc.value.meta.title}_${take.screen}_녹화_${take.at.slice(0, 16).replace(/[:T]/g, '-')}.webm`.replace(/[\\/:*?"<>|]+/g, '_');
    downloadFile(muxWebm(take, take.frames, take.ms), name, 'video/webm');
  };
  const drop = async () => {
    if (!dropAsk) return setDropAsk(true);
    await closeTake(take);
    notify('녹화를 버렸습니다.');
  };

  const targetLabel = (id: string) => {
    const a = existing.find((x) => x.id === id);
    return a && s ? `#${displayNo(s, a)} ${a.title || a.body.replace(/\s+/g, ' ').slice(0, 30) || '(본문 없음)'}` : id;
  };
  const used = (target: string, self: number) => segs.some((g) => g.id !== self && g.target === target);

  return (
    <div class="modal-backdrop rec-edit-back">
      <div class="modal rec-edit" role="dialog" aria-labelledby="rec-edit-title" tabIndex={-1} ref={root} onKeyDown={onKey}>
        <header class="row rec-edit-head">
          <h2 id="rec-edit-title"><Scissors {...ICON} /> 녹화 편집</h2>
          <span class="muted small">{s?.id} · {clock(dur, false)} · {mb(size)}</span>
          <span class="grow" />
          <button type="button" class="btn btn-ghost btn-sm" onClick={saveRaw} title="잘라 내기 전 원본 전체를 webm 파일로 내려받습니다">원본 저장 (.webm)</button>
          <button type="button" class={`btn btn-sm ${dropAsk ? 'btn-danger' : 'btn-ghost'}`} onClick={drop} onBlur={() => setDropAsk(false)}>
            <Trash2 {...ICON} size={14} /> {dropAsk ? '정말 버리기' : '버리기'}
          </button>
        </header>
        <div class="rec-edit-body">
          <section class="rec-edit-main">
            <div class="rec-video">
              <video
                ref={video}
                src={url}
                muted
                playsInline
                preload="auto"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onSeeked={(e) => !playing && setT(e.currentTarget.currentTime * 1000)}
                onClick={toggle}
              />
            </div>
            <div class="row rec-ctl">
              <button type="button" class="btn-icon" aria-label={playing ? '멈춤' : '재생'} title="재생 · 멈춤 (Space)" onClick={toggle}>
                {playing ? <Pause {...ICON} /> : <Play {...ICON} />}
              </button>
              <span class="mono rec-time-now">{clock(t)} / {clock(dur, false)}</span>
              <span class="grow" />
              <button type="button" class="btn btn-secondary btn-sm" onClick={markIn} title="고른 구간의 시작을 여기로 — 고른 구간이 없으면 여기서 새 구간 (I)">구간 시작 <kbd>I</kbd></button>
              <button type="button" class="btn btn-secondary btn-sm" onClick={markOut} title="고른 구간의 끝을 여기로 — 고른 구간이 없으면 여기까지 새 구간 (O)">구간 끝 <kbd>O</kbd></button>
              <button type="button" class="btn btn-secondary btn-sm" onClick={() => add(t, Math.min(dur, t + NEW_MS))} title="재생 위치에서 10초짜리 새 구간">
                <Plus {...ICON} size={14} /> 새 구간
              </button>
            </div>
            <Timeline start={0} end={dur} t={t} segs={segs} cur={cur} onSeek={seek} onPick={setCur} onChange={patch} dur={dur} />
            {sel && (
              <div class="rec-zoom">
                <span class="muted small">고른 구간 앞뒤 확대</span>
                <Timeline
                  start={Math.max(0, sel.from - 10_000)}
                  end={Math.min(dur, Math.max(sel.to + 10_000, sel.from - 10_000 + 30_000))}
                  t={t}
                  segs={[sel]}
                  cur={sel.id}
                  onSeek={seek}
                  onPick={setCur}
                  onChange={patch}
                  dur={dur}
                  zoom
                />
              </div>
            )}
            <p class="muted small">
              재생하며 <kbd>I</kbd> · <kbd>O</kbd> 로 구간을 잡습니다. 구간마다 최대 {CLIP_MAX_MS / 1000}초 · ← → 1초, Shift 와 함께 10초 이동. 시작은 바로 앞 키프레임(1초 간격)에 맞춰 잘립니다.
            </p>
          </section>
          <aside class="rec-segs">
            <h3 class="small">구간 {segs.length}개</h3>
            {!segs.length && <p class="muted small">아직 구간이 없습니다. 재생하다 넣을 부분에서 <kbd>I</kbd>, 끝에서 <kbd>O</kbd> 를 누르세요.</p>}
            <ol>
              {segs.map((g, i) => (
                <li key={g.id} class={`rec-seg-item ${g.id === cur ? 'is-on' : ''}`} onClick={() => setCur(g.id)}>
                  <div class="row">
                    <strong class="mono">{i + 1}</strong>
                    <button type="button" class="link-btn mono" onClick={() => seek(g.from)} title="구간 시작으로">{clock(g.from)} – {clock(g.to)}</button>
                    <span class="muted small">{((g.to - g.from) / 1000).toFixed(1)}초</span>
                    <span class="grow" />
                    <button type="button" class="btn-icon btn-xs" aria-label="구간 재생" title="이 구간만 재생" onClick={() => playSeg(g)}><Play {...ICON} size={14} /></button>
                    <button type="button" class="btn-icon btn-xs" aria-label="구간 지우기" title="구간 지우기 (Delete)" onClick={(e) => (e.stopPropagation(), remove(g.id))}><Trash2 {...ICON} size={14} /></button>
                  </div>
                  <select class="rec-target" value={g.target} onChange={(e) => patch(g.id, { target: e.currentTarget.value })} aria-label="넣을 곳">
                    <option value="new">새 Comment</option>
                    {hasDraft && <option value="draft" disabled={used('draft', g.id)}>쓰고 있는 Comment</option>}
                    {existing.length > 0 && (
                      <optgroup label="이미 있는 Comment 에 붙이기">
                        {existing.map((a) => <option key={a.id} value={a.id}>{targetLabel(a.id)}</option>)}
                      </optgroup>
                    )}
                  </select>
                  {g.target === 'new' && (
                    <>
                      <input class="input rec-title" placeholder="제목" value={g.title} onInput={(e) => patch(g.id, { title: e.currentTarget.value })} />
                      <textarea class="input rec-body" rows={2} placeholder="설명" value={g.body} onInput={(e) => patch(g.id, { body: e.currentTarget.value })} />
                    </>
                  )}
                </li>
              ))}
            </ol>
          </aside>
        </div>
        <footer class="row">
          <span class="muted small"><Film {...ICON} size={14} /> 넣고 나면 원본 녹화는 버립니다</span>
          <span class="grow" />
          <button type="button" class="btn btn-primary rec-apply" disabled={!segs.length || busy} onClick={apply}>
            {busy ? '자르는 중…' : `구간 ${segs.length}개 넣기`}
          </button>
        </footer>
      </div>
    </div>
  );
}

interface TimelineProps {
  start: number;
  end: number;
  dur: number;
  t: number;
  segs: Seg[];
  cur: number | null;
  zoom?: boolean;
  onSeek(ms: number): void;
  onPick(id: number): void;
  onChange(id: number, p: Partial<Seg>): void;
}

/** 시간 막대 — 누르거나 끌어 재생 위치, 구간을 눌러 고르고 고른 구간은 양 끝을 끌어 늘이고 줄인다 */
function Timeline({ start, end, dur, t, segs, cur, zoom, onSeek, onPick, onChange }: TimelineProps) {
  const bar = useRef<HTMLDivElement>(null);
  const span = Math.max(1, end - start);
  const pct = (ms: number) => `${((Math.min(Math.max(ms, start), end) - start) / span) * 100}%`;
  const at = (x: number) => {
    const r = bar.current!.getBoundingClientRect();
    return start + Math.min(1, Math.max(0, (x - r.left) / r.width)) * span;
  };
  const drag = (e: PointerEvent, move: (ms: number) => void) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    move(at(e.clientX));
    const mv = (ev: PointerEvent) => move(at(ev.clientX));
    const up = () => {
      el.removeEventListener('pointermove', mv);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
  };
  const ticks = useMemo(() => {
    const steps = [1000, 5000, 10_000, 30_000, 60_000, 300_000, 600_000, 1_800_000];
    const step = steps.find((x) => span / x <= 8) ?? 3_600_000;
    const out: number[] = [];
    for (let x = Math.ceil(start / step) * step; x <= end; x += step) out.push(x);
    return out;
  }, [start, end]);
  return (
    <div class={`rec-tl ${zoom ? 'is-zoom' : ''}`} ref={bar} onPointerDown={(e) => drag(e, onSeek)}>
      {ticks.map((x) => (
        <span key={x} class="rec-tick" style={{ left: pct(x) }}>{clock(x, false)}</span>
      ))}
      {segs.map((g, i) => (
        <div
          key={g.id}
          class={`rec-seg ${g.id === cur ? 'is-on' : ''}`}
          style={{ left: pct(g.from), width: `calc(${pct(g.to)} - ${pct(g.from)})` }}
          onPointerDown={(e) => {
            e.stopPropagation();
            onPick(g.id);
            drag(e, onSeek);
          }}
        >
          {!zoom && <span class="rec-seg-no">{i + 1}</span>}
          {g.id === cur && (
            <>
              <span
                class="rec-h is-from"
                aria-label="구간 시작 끌기"
                onPointerDown={(e) => drag(e, (ms) => {
                  const from = Math.min(Math.max(ms, 0, g.to - CLIP_MAX_MS), g.to - MIN_MS);
                  onChange(g.id, { from });
                  onSeek(from);
                })}
              />
              <span
                class="rec-h is-to"
                aria-label="구간 끝 끌기"
                onPointerDown={(e) => drag(e, (ms) => {
                  const to = Math.max(Math.min(ms, dur, g.from + CLIP_MAX_MS), g.from + MIN_MS);
                  onChange(g.id, { to });
                  onSeek(to);
                })}
              />
            </>
          )}
        </div>
      ))}
      <span class="rec-head" style={{ left: pct(t) }} />
    </div>
  );
}
