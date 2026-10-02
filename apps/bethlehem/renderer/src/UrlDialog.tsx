/* URL 로 담기 — 주소를 받고 담기 창을 연다. 실제로 담는 것은 그 창의 위쪽 막대에서 */
import { useEffect, useRef } from 'preact/hooks';
import { doc } from '@manna/store';
import { startSnapshot, urlAsk } from './session';

export function UrlDialog({ screenId }: { screenId?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const target = screenId ? doc.value.screens.find((s) => s.id === screenId) : undefined;
  useEffect(() => input.current?.focus(), []);
  const submit = (e: Event) => {
    e.preventDefault();
    startSnapshot(input.current?.value.trim() ?? '', screenId);
    urlAsk.value = null;
  };
  return (
    <div class="modal-backdrop" onClick={(e) => e.target === e.currentTarget && (urlAsk.value = null)}>
      <form class="modal" onSubmit={submit} aria-labelledby="url-title">
        <h2 id="url-title">{target ? `${target.id} 새 버전 — URL 로 담기` : 'URL 로 화면 담기'}</h2>
        <p class="muted">
          새 창에서 페이지가 열립니다. 로그인하거나 원하는 상태까지 이동한 뒤, 위쪽 막대에서 <strong>보이는 그대로</strong>(정지 화면) 또는
          <strong> 동작 포함</strong>(스크립트와 그때 받은 응답을 같이)으로 담습니다.
        </p>
        <input ref={input} class="input" type="text" inputMode="url" placeholder="https://" aria-label="주소" />
        <div class="row">
          <span class="grow" />
          <button type="button" class="btn btn-ghost" onClick={() => (urlAsk.value = null)}>취소</button>
          <button type="submit" class="btn btn-primary">창 열기</button>
        </div>
      </form>
    </div>
  );
}
