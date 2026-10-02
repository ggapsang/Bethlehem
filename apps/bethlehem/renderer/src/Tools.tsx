/* 툴바에 끼우는 작성 도구 — 작업 폴더·문서 열기, 화면 추가·새 버전·삭제, 돌아온 문서 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { ChevronDown, FileText, FolderGit2, FolderOpen, FolderPlus, Globe, History, Inbox, Layers, Trash2 } from 'lucide-preact';
import { rev, screen } from '@manna/store';
import {
  addScreenFromFolder, askUrl, mergeReturned, mode, newWorkspace, openDocument, openWorkspace, placeName, recent, refreshRecent,
  refreshReturned, removeScreen, returned, createWorkspace,
} from './session';

const ICON = { size: 18, strokeWidth: 1.5 };
const api = window.bethlehem;

function Menu({ label, title, icon, children, onOpen, cls }: { label?: ComponentChildren; title: string; icon: ComponentChildren; children: (close: () => void) => ComponentChildren; onOpen?: () => void; cls?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div class="popover-wrap" ref={ref}>
      <button
        type="button"
        class={label ? `btn btn-ghost btn-menu ${cls ?? ''}` : `btn-icon ${cls ?? ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={title}
        title={title}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
      >
        {icon}
        {label && <span class="ellipsis">{label}</span>}
        <ChevronDown {...ICON} size={14} />
      </button>
      {open && <div class="popover popover-left" role="menu">{children(() => setOpen(false))}</div>}
    </div>
  );
}

function RecentList({ items, onPick, empty }: { items: { path: string; name: string }[]; onPick: (p: string) => void; empty: string }) {
  if (!items.length) return <p class="popover-empty muted small">{empty}</p>;
  return (
    <>
      {items.map((r) => (
        <button key={r.path} type="button" role="menuitem" class="popover-item popover-recent" title={r.path} onClick={() => onPick(r.path)}>
          <span class="ellipsis">{r.name}</span>
          <span class="muted small ellipsis">{r.path.slice(0, Math.max(0, r.path.length - r.name.length - 1))}</span>
        </button>
      ))}
    </>
  );
}

/** 로고 옆 — 지금 연결된 곳(작업 폴더·문서)과 열기 */
export function DocTools() {
  const m = mode.value;
  return (
    <>
      <Menu
        title="작업 폴더 · 문서"
        icon={m.kind === 'file' ? <FileText {...ICON} /> : <FolderGit2 {...ICON} />}
        label={placeName()}
        cls="tb-place"
        onOpen={refreshRecent}
      >
        {(close) => (
          <>
            <button type="button" role="menuitem" class="popover-item" onClick={() => { close(); newWorkspace(); }}>
              <FolderPlus {...ICON} size={16} /> 새 작업 폴더…
            </button>
            <button type="button" role="menuitem" class="popover-item" onClick={() => { close(); openWorkspace(); }}>
              <FolderGit2 {...ICON} size={16} /> 작업 폴더 열기…
            </button>
            <button type="button" role="menuitem" class="popover-item" onClick={() => { close(); openDocument(); }}>
              <FolderOpen {...ICON} size={16} /> 테라리움 문서 열기…
            </button>
            {m.kind === 'workspace' && (
              <>
                <div class="popover-sep" />
                <button type="button" role="menuitem" class="popover-item" onClick={() => { close(); api.wsReveal('dist'); }}>보낼 파일 폴더(dist) 열기</button>
                <button type="button" role="menuitem" class="popover-item" onClick={() => { close(); api.wsReveal('returned'); }}>돌아온 문서 폴더(returned) 열기</button>
              </>
            )}
            {m.kind === 'file' && (
              <>
                <div class="popover-sep" />
                <button type="button" role="menuitem" class="popover-item" onClick={() => { close(); createWorkspace(); }}>이 문서를 작업 폴더로 풀기…</button>
              </>
            )}
            <div class="popover-sep" />
            <span class="popover-label"><History {...ICON} size={14} /> 최근 작업 폴더</span>
            <RecentList items={recent.value.workspaces} empty="최근 작업 폴더가 없습니다." onPick={(p) => { close(); openWorkspace(p); }} />
            <span class="popover-label"><History {...ICON} size={14} /> 최근 문서</span>
            <RecentList items={recent.value.files} empty="최근에 연 문서가 없습니다." onPick={(p) => { close(); openDocument(p); }} />
          </>
        )}
      </Menu>
      <ReturnedBadge />
      <span class="tb-divider" />
    </>
  );
}

/** 돌아온 문서 — returned/ 에 들어온 회신본. 눌러서 합친다 */
function ReturnedBadge() {
  const list = returned.value.filter((r) => r.sameDoc);
  if (mode.value.kind !== 'workspace' || !list.length) return null;
  return (
    <Menu title={`돌아온 문서 ${list.length}건`} icon={<Inbox {...ICON} />} label={`회신 ${list.length}`} cls="tb-returned" onOpen={refreshReturned}>
      {(close) => (
        <>
          <span class="popover-label"><Inbox {...ICON} size={14} /> returned/ 에 들어온 회신본</span>
          {list.map((r) => (
            <div key={r.name} class="popover-item popover-returned">
              <span class="grow">
                <strong>{r.by ?? '이름 없음'}</strong> <span class="muted small">{r.at ? new Date(r.at).toLocaleString('ko-KR') : ''}</span>
                <span class="muted small ellipsis" title={r.name}>{r.name}</span>
              </span>
              <button type="button" class="btn btn-secondary" onClick={() => { close(); mergeReturned(r.name); }}>병합</button>
            </div>
          ))}
        </>
      )}
    </Menu>
  );
}

function SourceMenu({ title, icon, label, screenId }: { title: string; icon: ComponentChildren; label?: string; screenId?: string }) {
  return (
    <Menu title={title} icon={icon} label={label} onOpen={refreshRecent}>
      {(close) => (
        <>
          <button type="button" role="menuitem" class="popover-item" onClick={() => { close(); addScreenFromFolder(screenId); }}>
            <FolderPlus {...ICON} size={16} /> 화면 폴더 선택…
          </button>
          <button type="button" role="menuitem" class="popover-item" onClick={() => { close(); askUrl(screenId); }}>
            <Globe {...ICON} size={16} /> URL…
          </button>
          <div class="popover-sep" />
          <span class="popover-label"><History {...ICON} size={14} /> 최근 폴더</span>
          <RecentList items={recent.value.folders} empty="최근에 쓴 폴더가 없습니다." onPick={(p) => { close(); addScreenFromFolder(screenId, p); }} />
        </>
      )}
    </Menu>
  );
}

/** 화면 선택 옆 — 화면 추가 · 새 버전 · 화면 삭제 */
export function ScreenTools() {
  rev.value;
  const scr = screen.value;
  return (
    <>
      <SourceMenu title="화면 추가 — 폴더나 URL" icon={<FolderPlus {...ICON} />} label={scr ? undefined : '화면 추가'} />
      {scr && <SourceMenu title={`${scr.id} 새 버전 — 폴더나 URL`} icon={<Layers {...ICON} />} screenId={scr.id} />}
      {scr && <button type="button" class="btn-icon" aria-label={`${scr.id} 지우기`} title={`${scr.id} 화면 지우기`} onClick={() => removeScreen(scr.id)}><Trash2 {...ICON} /></button>}
    </>
  );
}
