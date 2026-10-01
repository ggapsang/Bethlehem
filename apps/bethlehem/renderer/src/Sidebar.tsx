/* 왼쪽 — 화면 목록과 버전 (Bethlehem 전용) */
import { FilePlus2, FolderOpen, FolderPlus, Layers, Plus, Trash2 } from 'lucide-preact';
import { doc, rev, screenId, selectScreen, versionNo } from '@manna/store';
import { addScreenFromPicker, filePath, newDocument, openDocument, removeScreen } from './session';

const ICON = { size: 16, strokeWidth: 1.5 };

export function Sidebar() {
  rev.value;
  const d = doc.value;
  return (
    <nav class="sidebar" aria-label="화면 목록">
      <div class="sb-actions">
        <button type="button" class="btn btn-ghost" onClick={newDocument} title="새 문서"><FilePlus2 {...ICON} /> 새 문서</button>
        <button type="button" class="btn btn-ghost" onClick={openDocument} title="Manna 문서 열기"><FolderOpen {...ICON} /> 열기</button>
      </div>
      <div class="sb-file small ellipsis" title={filePath.value ?? ''}>{filePath.value ?? '저장 안 된 새 문서'}</div>
      <h3 class="group-title sb-title"><Layers {...ICON} size={14} /> 화면 {d.screens.length}</h3>
      <ul class="sb-screens">
        {d.screens.map((s) => {
          const active = s.id === screenId.value;
          return (
            <li key={s.id} class={`sb-screen ${active ? 'is-active' : ''}`}>
              <button type="button" class="sb-screen-head" onClick={() => selectScreen(s.id)}>
                <span class="mono">{s.id}</span>
                <span class="ellipsis">{s.title}</span>
              </button>
              <div class="sb-versions">
                {s.versions.map((v) => (
                  <button
                    key={v.v}
                    type="button"
                    class={`sb-ver ${active && versionNo.value === v.v ? 'is-active' : ''}`}
                    title={v.label ?? `v${v.v}`}
                    onClick={() => selectScreen(s.id, v.v)}
                  >
                    v{v.v}
                  </button>
                ))}
                <button type="button" class="sb-ver sb-add" title="새 버전 등록" onClick={() => addScreenFromPicker(s.id)}><Plus {...ICON} size={12} /></button>
                <span class="grow" />
                <span class="muted small">{s.annotations.length}</span>
                <button type="button" class="btn-icon btn-xs" aria-label={`${s.id} 지우기`} onClick={() => removeScreen(s.id)}><Trash2 {...ICON} size={14} /></button>
              </div>
            </li>
          );
        })}
      </ul>
      <button type="button" class="btn btn-secondary sb-add-screen" onClick={() => addScreenFromPicker()}>
        <FolderPlus {...ICON} /> 화면 추가
      </button>
      <p class="muted small sb-hint">화면 폴더를 창에 끌어다 놓아도 됩니다.</p>
    </nav>
  );
}
