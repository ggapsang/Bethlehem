/* 작성 도구 — 툴바(작업 폴더·문서 열기, 돌아온 문서), 탭 줄(화면 추가), 화면 막대(새 버전·화면 지우기) */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { ChevronDown, FileText, FolderGit2, FolderOpen, FolderPlus, Globe, History, Image, Inbox, Layers, Plus, RefreshCw, Trash2 } from 'lucide-preact';
import { rev, screen } from '@manna/store';
import {
  addImageScreen, addScreenFromFolder, addScreensFromFiles, openUrl, urlAsk, askUrl, createWorkspace, mergeReturned, mode, openDocument, openFolder, placeName, placeUrl, recent, refreshRecent,
  refreshReturned, registerFromSource, removeScreen, returned, staleSources,
} from './session';

const ICON = { size: 18, strokeWidth: 1.5 };
const api = window.bethlehem;

interface MenuProps {
  label?: ComponentChildren;
  title: string;
  icon: ComponentChildren;
  children: (close: () => void) => ComponentChildren;
  onOpen?: () => void;
  cls?: string;
  /** 단추 모양 — 툴바(ghost) · 탭 줄(tab-tool) · 화면 막대(bar) */
  kind?: 'ghost' | 'tab' | 'bar';
  align?: 'left' | 'right';
}

function Menu({ label, title, icon, children, onOpen, cls, kind = 'ghost', align = 'left' }: MenuProps) {
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
        class={kind === 'tab' ? `tab-tool ${cls ?? ''}` : kind === 'bar' ? `btn btn-ghost btn-bar ${cls ?? ''}` : label ? `btn btn-ghost btn-menu ${cls ?? ''}` : `btn-icon ${cls ?? ''}`}
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
        {kind !== 'tab' && <ChevronDown {...ICON} size={14} />}
      </button>
      {open && <div class={`popover ${align === 'left' ? 'popover-left' : ''}`} role="menu">{children(() => setOpen(false))}</div>}
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
        icon={m.kind === 'file' ? <FileText {...ICON} /> : placeUrl() ? <Globe {...ICON} /> : <FolderGit2 {...ICON} />}
        label={placeName()}
        cls="tb-place"
        onOpen={refreshRecent}
      >
        {(close) => (
          <>
            <button type="button" role="menuitem" class="popover-item" onClick={() => { close(); openFolder(); }}>
              <FolderGit2 {...ICON} size={16} /> 폴더 열기…
            </button>
            <button type="button" role="menuitem" class="popover-item" onClick={() => { close(); openDocument(); }}>
              <FolderOpen {...ICON} size={16} /> 테라리움 문서 열기…
            </button>
            <button type="button" role="menuitem" class="popover-item" onClick={() => { close(); urlAsk.value = { open: true }; }}>
              <Globe {...ICON} size={16} /> URL 열기…
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
            <RecentList items={recent.value.workspaces} empty="최근 작업 폴더가 없습니다." onPick={(p) => { close(); openFolder(p); }} />
            {recent.value.urls.length > 0 && (
              <>
                <span class="popover-label"><History {...ICON} size={14} /> 최근 URL</span>
                {recent.value.urls.map((r) => (
                  <button key={r.url} type="button" role="menuitem" class="popover-item popover-recent" title={r.url} onClick={() => { close(); openUrl(r.url); }}>
                    <span class="ellipsis">{r.url.replace(/^https?:\/\//, '')}</span>
                  </button>
                ))}
              </>
            )}
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

function SourceMenu({ title, icon, label, screenId, kind, align }: { title: string; icon: ComponentChildren; label?: string; screenId?: string; kind?: MenuProps['kind']; align?: MenuProps['align'] }) {
  return (
    <Menu title={title} icon={icon} label={label} onOpen={refreshRecent} kind={kind} align={align}>
      {(close) => (
        <>
          <button type="button" role="menuitem" class="popover-item" onClick={() => { close(); addScreenFromFolder(screenId); }}>
            <FolderPlus {...ICON} size={16} /> 화면 폴더 선택…
          </button>
          <button type="button" role="menuitem" class="popover-item" onClick={() => { close(); askUrl(screenId); }}>
            <Globe {...ICON} size={16} /> URL…
          </button>
          {screenId ? (
            <button type="button" role="menuitem" class="popover-item" onClick={() => { close(); addImageScreen(screenId); }}>
              <Image {...ICON} size={16} /> 그림 (png · jpg)…
            </button>
          ) : (
            <button type="button" role="menuitem" class="popover-item" onClick={() => { close(); addScreensFromFiles(); }}>
              <FileText {...ICON} size={16} /> 파일 — 테라리움 문서 · 그림…
            </button>
          )}
          <div class="popover-sep" />
          <span class="popover-label"><History {...ICON} size={14} /> 최근 폴더</span>
          <RecentList items={recent.value.folders} empty="최근에 쓴 폴더가 없습니다." onPick={(p) => { close(); addScreenFromFolder(screenId, p); }} />
        </>
      )}
    </Menu>
  );
}

/** 탭 줄 끝 ＋ — 새 화면 (폴더 · URL · 그림) */
export function AddScreenMenu() {
  return <SourceMenu title="화면 추가" icon={<Plus {...ICON} />} kind="tab" />;
}

/** 버전 칩 옆 — 지금 화면의 새 버전 */
export function NewVersionMenu() {
  rev.value;
  const scr = screen.value;
  if (!scr) return null;
  const stale = staleSources.value[scr.id];
  return (
    <>
      {stale && (
        <button
          type="button"
          class="btn btn-sm src-stale"
          aria-label="원본 바뀜 — 새 버전 등록"
          title={`원본 폴더가 이 버전을 담은 뒤로 바뀌었습니다 — 눌러서 새 버전으로 등록\n${stale.slice(0, 12).map((c) => `${c.how === 'changed' ? '바뀜' : c.how === 'removed' ? '없어짐' : '새 파일'}  ${c.path}`).join('\n')}${stale.length > 12 ? `\n… 외 ${stale.length - 12}개` : ''}`}
          onClick={() => registerFromSource(scr.id)}
        >
          <RefreshCw {...ICON} size={14} /> 원본 바뀜 · 새 버전 등록
        </button>
      )}
      <SourceMenu title={`${scr.id} 새 버전`} icon={<Layers {...ICON} size={16} />} label="새 버전" screenId={scr.id} kind="bar" />
    </>
  );
}

/** 화면 막대 끝 — 화면 지우기 */
export function DeleteScreenButton() {
  rev.value;
  const scr = screen.value;
  if (!scr) return null;
  return (
    <button type="button" class="btn-icon" aria-label={`${scr.id} 지우기`} title={`${scr.id} 화면 지우기`} onClick={() => removeScreen(scr.id)}>
      <Trash2 {...ICON} />
    </button>
  );
}
