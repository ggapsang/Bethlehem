/* 툴바 — 화면·버전 선택, 모드, 일시정지, 테마, 저장 (docs/ARCHITECTURE.md §4.1) */
import { MessageSquarePlus, Moon, MousePointer2, Pause, Play, Save, Sun, UserRound } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import type { Host } from '../host';
import { save } from '../host';
import {
  askName, dirty, doc, draft, mode, mutate, paused, screen, selectScreen, setTheme, theme, user, version,
} from '../store';
import { Logo } from './Logo';

const ICON = { size: 20, strokeWidth: 1.5 };

export function Toolbar({ host, start }: { host: Host; start?: ComponentChildren }) {
  const d = doc.value;
  const scr = screen.value;
  const v = version.value;
  const annotate = mode.value === 'annotate';

  return (
    <header class="toolbar">
      <div class="tb-group tb-brand">
        <Logo />
        {host.author ? (
          <input
            class="tb-title input-bare"
            aria-label="문서 제목"
            value={d.meta.title}
            onChange={(e) => mutate((x) => (x.meta.title = e.currentTarget.value || '제목 없음'))}
          />
        ) : (
          <h1 class="tb-title">{d.meta.title}</h1>
        )}
        {host.author ? (
          <label class="tb-ver">
            v
            <input
              class="input-bare"
              aria-label="문서 버전"
              size={4}
              value={d.meta.version}
              onChange={(e) => mutate((x) => (x.meta.version = e.currentTarget.value || '0.1'))}
            />
          </label>
        ) : (
          <span class="tb-ver">v{d.meta.version}</span>
        )}
        {start}
      </div>

      {scr && (
        <div class="tb-group">
          <select class="input input-sm" aria-label="화면" value={scr.id} onChange={(e) => selectScreen(e.currentTarget.value)}>
            {d.screens.map((s) => <option key={s.id} value={s.id}>{s.id} {s.title}</option>)}
          </select>
          {scr.versions.length > 1 && (
            <select class="input input-sm" aria-label="화면 버전" value={v?.v} onChange={(e) => selectScreen(scr.id, Number(e.currentTarget.value))}>
              {scr.versions.map((x) => <option key={x.v} value={x.v}>v{x.v}{x.label ? ` · ${x.label}` : ''}</option>)}
            </select>
          )}
        </div>
      )}

      <span class="grow" />

      {scr && (
        <div class="tb-group">
          <div class="seg" role="radiogroup" aria-label="모드">
            <button type="button" role="radio" aria-checked={!annotate} class="seg-btn" onClick={() => { mode.value = 'view'; draft.value = null; }} title="화면을 직접 조작합니다">
              <MousePointer2 {...ICON} size={16} /> 보기
            </button>
            <button type="button" role="radio" aria-checked={annotate} class="seg-btn" onClick={() => (mode.value = 'annotate')} title="요소를 클릭하거나 영역을 드래그해 어노테이션을 답니다">
              <MessageSquarePlus {...ICON} size={16} /> 어노테이션
            </button>
          </div>
          <button
            type="button"
            class={`btn-icon ${paused.value ? 'is-on' : ''}`}
            aria-pressed={paused.value}
            aria-label={paused.value ? '화면 재생' : '화면 일시정지'}
            title={paused.value ? '화면 재생' : '화면 일시정지 — 움직이는 대상에 어노테이션을 달 때'}
            onClick={() => (paused.value = !paused.value)}
          >
            {paused.value ? <Play {...ICON} /> : <Pause {...ICON} />}
          </button>
        </div>
      )}

      <div class="tb-group">
        <button type="button" class="btn-icon" aria-label="테마 전환" title={theme.value === 'light' ? '다크 테마' : '라이트 테마'} onClick={() => setTheme(theme.value === 'light' ? 'dark' : 'light')}>
          {theme.value === 'light' ? <Moon {...ICON} /> : <Sun {...ICON} />}
        </button>
        <button type="button" class="btn btn-ghost tb-user" onClick={() => (askName.value = true)} title="내 이름 바꾸기">
          <UserRound {...ICON} size={16} /> {user.value ?? '이름 입력'}
        </button>
        <button type="button" class="btn btn-primary" onClick={() => save(host)} title="저장 (Ctrl+S)">
          <Save {...ICON} size={16} /> 저장{dirty.value && <span class="dirty-dot" aria-label="저장 안 된 변경 있음" />}
        </button>
      </div>
    </header>
  );
}
