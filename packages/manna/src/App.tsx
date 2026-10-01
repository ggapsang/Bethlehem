/* Manna 와 Bethlehem 이 같이 쓰는 화면 틀 */
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Host } from './host';
import { save } from './host';
import { Stage } from './stage/Stage';
import { askName, dirty, rev, setUser, theme, toast, user } from './store';
import { Panel } from './ui/Panel';
import { Toolbar } from './ui/Toolbar';

export interface AppProps {
  host: Host;
  /** Bethlehem 이 왼쪽에 끼우는 화면 목록 */
  sidebar?: ComponentChildren;
  /** 툴바 제목 옆 (Bethlehem 의 열기·새 문서) */
  start?: ComponentChildren;
  /** 화면이 하나도 없을 때 */
  empty?: ComponentChildren;
}

export function App({ host, sidebar, start, empty }: AppProps) {
  rev.value; // 문서가 바뀌면 틀 전체를 다시 그린다 (제목·버전 등)
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme.value;
  }, [theme.value]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save(host, e.shiftKey);
      }
    };
    const onLeave = (e: BeforeUnloadEvent) => {
      if (host.kind === 'manna' && dirty.peek()) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onLeave);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onLeave);
    };
  }, [host]);

  return (
    <div class={`app ${sidebar ? 'has-sidebar' : ''}`}>
      <Toolbar host={host} start={start} />
      <div class="workspace">
        {sidebar}
        <main class="main">
          <Stage empty={empty ?? <p class="muted">이 문서에는 아직 화면이 없습니다.</p>} />
        </main>
        <Panel host={host} />
      </div>
      {askName.value && <NameDialog host={host} />}
      {toast.value && (
        <div class={`toast toast-${toast.value.tone}`} role={toast.value.tone === 'error' ? 'alert' : 'status'}>
          {toast.value.text}
        </div>
      )}
    </div>
  );
}

function NameDialog({ host }: { host: Host }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const submit = (e: Event) => {
    e.preventDefault();
    const name = input.current?.value.trim();
    if (!name) return;
    setUser(name);
    askName.value = false;
  };
  return (
    <div class="modal-backdrop" onClick={(e) => e.target === e.currentTarget && user.value && (askName.value = false)}>
      <form class="modal" onSubmit={submit} aria-labelledby="name-title">
        <h2 id="name-title">이름을 알려 주세요</h2>
        <p class="muted">
          {host.kind === 'manna'
            ? '이 문서에 다는 어노테이션·답글·상태 변경에 이름이 함께 남습니다. 서버는 없으며, 이름은 이 브라우저에만 기억됩니다.'
            : '작성하는 어노테이션과 답글에 이 이름이 남습니다.'}
        </p>
        <input ref={input} class="input" placeholder="예: 홍길동" defaultValue={user.value ?? ''} maxLength={40} />
        <div class="row">
          <span class="grow" />
          <button type="button" class="btn btn-ghost" onClick={() => (askName.value = false)}>
            {user.value ? '취소' : '보기만 할게요'}
          </button>
          <button type="submit" class="btn btn-primary">확인</button>
        </div>
      </form>
    </div>
  );
}
