/* 툴바에 끼우는 작성 도구 — 왼쪽 패널에 있던 기능을 모두 위로 올렸다 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { ChevronDown, FilePlus2, FolderOpen, FolderPlus, Globe, History, Layers, Trash2 } from 'lucide-preact';
import { rev, screen } from '@manna/store';
import {
  addScreenFromFolder, newDocument, openDocument, recent, refreshRecent, removeScreen, urlAsk,
} from './session';

const ICON = { size: 18, strokeWidth: 1.5 };

function Menu({ label, title, icon, children, onOpen }: { label?: string; title: string; icon: ComponentChildren; children: (close: () => void) => ComponentChildren; onOpen?: () => void }) {
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
        class={label ? 'btn btn-ghost btn-menu' : 'btn-icon'}
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
        {label && <span>{label}</span>}
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
          <span class="muted small ellipsis">{r.path.slice(0, -r.name.length - 1)}</span>
        </button>
      ))}
    </>
  );
}

/** 로고 옆 — 새 문서 · 열기(최근 문서) */
export function DocTools() {
  return (
    <>
      <button type="button" class="btn-icon" aria-label="새 문서" title="새 문서" onClick={newDocument}><FilePlus2 {...ICON} /></button>
      <Menu title="열기 · 최근 문서" icon={<FolderOpen {...ICON} />} onOpen={refreshRecent}>
        {(close) => (
          <>
            <button type="button" role="menuitem" class="popover-item" onClick={() => { close(); openDocument(); }}>
              <FolderOpen {...ICON} size={16} /> 테라리움 문서 열기…
            </button>
            <div class="popover-sep" />
            <span class="popover-label"><History {...ICON} size={14} /> 최근 문서</span>
            <RecentList items={recent.value.files} empty="최근에 연 문서가 없습니다." onPick={(p) => { close(); openDocument(p); }} />
          </>
        )}
      </Menu>
      <span class="tb-divider" />
    </>
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
          <button type="button" role="menuitem" class="popover-item" onClick={() => { close(); urlAsk.value = { screenId }; }}>
            <Globe {...ICON} size={16} /> URL 로 담기…
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
