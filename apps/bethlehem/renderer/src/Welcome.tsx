/* 화면이 없을 때 — 작업 폴더가 없으면 만들거나 열고, 있으면 화면을 추가한다 */
import { FolderGit2, FolderOpen, FolderPlus, Globe } from 'lucide-preact';
import keyArt from '../../../../docs/key_art.png';
import { addScreenFromFolder, askUrl, mode, newWorkspace, openDocument, openWorkspace } from './session';

const ICON = { size: 16, strokeWidth: 1.5 };

export function Welcome() {
  const inWorkspace = mode.value.kind !== 'none';
  return (
    <div class="welcome">
      <img class="welcome-art" src={keyArt} alt="Terrarium" />
      <div class="welcome-body">
        {inWorkspace ? (
          <div class="row welcome-actions">
            <button type="button" class="btn btn-primary" onClick={() => addScreenFromFolder()}><FolderPlus {...ICON} /> 화면 폴더 추가</button>
            <button type="button" class="btn btn-secondary" onClick={() => askUrl()}><Globe {...ICON} /> URL 추가</button>
          </div>
        ) : (
          <div class="row welcome-actions">
            <button type="button" class="btn btn-primary" onClick={() => newWorkspace()}><FolderPlus {...ICON} /> 새 작업 폴더</button>
            <button type="button" class="btn btn-secondary" onClick={() => openWorkspace()}><FolderGit2 {...ICON} /> 작업 폴더 열기</button>
            <button type="button" class="btn btn-secondary" onClick={() => openDocument()}><FolderOpen {...ICON} /> 문서 열기</button>
          </div>
        )}
        <p class="muted small">작업 폴더, 화면 폴더, 테라리움 문서를 창에 끌어다 놓아도 됩니다.</p>
      </div>
    </div>
  );
}
