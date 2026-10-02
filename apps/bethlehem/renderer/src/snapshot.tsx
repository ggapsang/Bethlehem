/* URL 담기 창 — 위쪽 막대. 아래는 실제 페이지(별도 WebContentsView)다 */
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ArrowLeft, ArrowRight, Camera, Loader2, Play, RotateCw, X } from 'lucide-preact';
import 'pretendard/dist/web/variable/pretendardvariable.css';
import '@manna/styles.css';
import './bethlehem.css';
import { formatBytes } from '@core';
import type { SnapApi, SnapState } from '../../preload/snapshot';

const snap = (window as unknown as { snap: SnapApi }).snap;
const ICON = { size: 18, strokeWidth: 1.5 };
const PRESETS = [
  { label: '1920 × 1080', w: 1920, h: 1080 },
  { label: '1440 × 900', w: 1440, h: 900 },
  { label: '1280 × 800', w: 1280, h: 800 },
  { label: '390 × 844 (모바일)', w: 390, h: 844 },
];

function Bar() {
  const [s, setS] = useState<SnapState | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editing = useRef(false);

  useEffect(() => {
    snap.onState((st) => {
      setS(st);
      if (!editing.current && st.url && st.url !== 'about:blank') setUrl(st.url);
    });
    snap.onPrefill((u) => setUrl(u));
  }, []);

  const capture = async (mode: 'live' | 'static') => {
    setBusy(mode === 'live' ? '동작 포함으로 담는 중…' : '보이는 그대로 담는 중…');
    setError(null);
    const r = await snap.capture(mode);
    if (!r.ok) {
      setBusy(null);
      setError(r.error ?? '담지 못했습니다.');
    }
  };

  const vpKey = s ? `${s.vp.w}x${s.vp.h}` : '1920x1080';
  return (
    <div class="snap-bar">
      <button type="button" class="btn-icon" aria-label="뒤로" disabled={!s?.canBack} onClick={() => snap.nav('back')}><ArrowLeft {...ICON} /></button>
      <button type="button" class="btn-icon" aria-label="앞으로" disabled={!s?.canForward} onClick={() => snap.nav('forward')}><ArrowRight {...ICON} /></button>
      <button type="button" class="btn-icon" aria-label="새로고침" onClick={() => snap.nav('reload')}>
        {s?.loading ? <Loader2 {...ICON} class="spin" /> : <RotateCw {...ICON} />}
      </button>
      <form class="snap-url" onSubmit={(e) => { e.preventDefault(); editing.current = false; snap.go(url); }}>
        <input
          class="input"
          aria-label="주소"
          placeholder="https:// 주소를 입력하고 Enter — 로그인이 필요하면 이 창에서 로그인하세요"
          value={url}
          onFocus={() => (editing.current = true)}
          onBlur={() => (editing.current = false)}
          onInput={(e) => setUrl(e.currentTarget.value)}
        />
      </form>
      <select
        class="input input-sm"
        aria-label="화면 크기"
        value={vpKey}
        onChange={(e) => {
          const [w, h] = e.currentTarget.value.split('x').map(Number);
          snap.viewport(w, h);
        }}
      >
        {PRESETS.map((p) => <option key={p.label} value={`${p.w}x${p.h}`}>{p.label}</option>)}
      </select>
      <span class="muted small snap-count" title="이 페이지가 받은 응답 — 담을 때 문서에 들어갑니다">
        {s ? `응답 ${s.count}개 · ${formatBytes(s.bytes)}` : ''}
      </span>
      {error && <span class="snap-error" role="alert">{error}</span>}
      {busy ? (
        <span class="row muted"><Loader2 {...ICON} class="spin" /> {busy}</span>
      ) : (
        <>
          <button type="button" class="btn btn-secondary" title="지금 보이는 모습 그대로 담습니다. 스크립트는 빼므로 화면이 움직이지 않습니다." onClick={() => capture('static')}>
            <Camera {...ICON} size={16} /> 보이는 그대로
          </button>
          <button type="button" class="btn btn-primary" title="원래 HTML 과 받은 응답을 모두 담습니다. 화면이 다시 실행되고, 지금 받은 API 응답이 그대로 재생됩니다." onClick={() => capture('live')}>
            <Play {...ICON} size={16} /> 동작 포함 담기
          </button>
        </>
      )}
      <button type="button" class="btn-icon" aria-label="닫기" onClick={() => snap.cancel()}><X {...ICON} /></button>
    </div>
  );
}

render(<Bar />, document.getElementById('snap-root')!);
