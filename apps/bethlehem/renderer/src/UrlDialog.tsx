/* URL 화면 추가 — 편집기 안에서 실제 사이트가 돈다. 로그인도 그 안에서 한다 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { doc } from '@manna/store';
import { addSiteScreen, openUrl, urlAsk } from './session';

export function UrlDialog({ screenId, open }: { screenId?: string; open?: boolean }) {
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
    urlAsk.value = null;
    if (open) return void openUrl(url.href);
    addSiteScreen(url.href, title.trim() || target?.title || url.host + url.pathname.replace(/\/$/, ''), screenId);
  };
  return (
    <div class="modal-backdrop" onClick={(e) => e.target === e.currentTarget && (urlAsk.value = null)}>
      <form class="modal" onSubmit={submit} aria-labelledby="url-title">
        <h2 id="url-title">{open ? 'URL 열기' : target ? `${target.id} 새 버전 — URL` : 'URL 로 화면 추가'}</h2>
        <label class="field">
          <span>주소</span>
          <input ref={input} class="input" type="text" inputMode="url" placeholder="https://" aria-label="주소" onInput={() => setError(null)} />
        </label>
        {!target && !open && (
          <label class="field">
            <span>화면 이름 (비우면 주소로)</span>
            <input class="input" value={title} onInput={(e) => setTitle(e.currentTarget.value)} />
          </label>
        )}
        {error && <p class="callout callout-error">{error}</p>}
        <div class="row">
          <span class="grow" />
          <button type="button" class="btn btn-ghost" onClick={() => (urlAsk.value = null)}>취소</button>
          <button type="submit" class="btn btn-primary">{open ? '열기' : '추가'}</button>
        </div>
      </form>
    </div>
  );
}
