/* URL 화면 추가 — 편집기 안에서 실제 사이트가 돈다. 로그인도 그 안에서 한다 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { doc } from '@manna/store';
import { addSiteScreen, urlAsk } from './session';

export function UrlDialog({ screenId }: { screenId?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const target = screenId ? doc.value.screens.find((s) => s.id === screenId) : undefined;
  useEffect(() => input.current?.focus(), []);
  const submit = (e: Event) => {
    e.preventDefault();
    let u = input.current?.value.trim() ?? '';
    if (!u) return;
    if (!/^[a-z]+:\/\//i.test(u)) u = /^(localhost|\d+\.\d+\.\d+\.\d+)(:\d+)?/.test(u) ? `http://${u}` : `https://${u}`;
    let url: URL;
    try {
      url = new URL(u);
    } catch {
      return setError('주소 형식이 아닙니다.');
    }
    addSiteScreen(url.href, title.trim() || target?.title || url.host + url.pathname.replace(/\/$/, ''), screenId);
    urlAsk.value = null;
  };
  return (
    <div class="modal-backdrop" onClick={(e) => e.target === e.currentTarget && (urlAsk.value = null)}>
      <form class="modal" onSubmit={submit} aria-labelledby="url-title">
        <h2 id="url-title">{target ? `${target.id} 새 버전 — URL` : 'URL 로 화면 추가'}</h2>
        <p class="muted">
          편집 화면 안에서 실제 사이트가 그대로 돕니다. 로그인이 필요하면 그 안에서 하세요. Comment 를 달 때만 화면이 멈추고, 받는 사람에게는 마지막 모습이 사본으로 갑니다.
        </p>
        <label class="field">
          <span>주소</span>
          <input ref={input} class="input" type="text" inputMode="url" placeholder="https://" aria-label="주소" onInput={() => setError(null)} />
        </label>
        {!target && (
          <label class="field">
            <span>화면 이름 (비우면 주소로)</span>
            <input class="input" value={title} onInput={(e) => setTitle(e.currentTarget.value)} />
          </label>
        )}
        {error && <p class="callout callout-error">{error}</p>}
        <div class="row">
          <span class="grow" />
          <button type="button" class="btn btn-ghost" onClick={() => (urlAsk.value = null)}>취소</button>
          <button type="submit" class="btn btn-primary">추가</button>
        </div>
      </form>
    </div>
  );
}
