/* 화면이 없을 때 — 첫 화면 */
import { FolderOpen, FolderPlus, Globe } from 'lucide-preact';
import keyArt from '../../../../docs/key_art.png';
import { addScreenFromFolder, openDocument, urlAsk } from './session';

const ICON = { size: 16, strokeWidth: 1.5 };

export function Welcome() {
  return (
    <div class="welcome">
      <img class="welcome-art" src={keyArt} alt="Terrarium" />
      <div class="welcome-body">
        <div class="row welcome-actions">
          <button type="button" class="btn btn-primary" onClick={() => addScreenFromFolder()}><FolderPlus {...ICON} /> 화면 폴더 추가</button>
          <button type="button" class="btn btn-secondary" onClick={() => (urlAsk.value = {})}><Globe {...ICON} /> URL 로 담기</button>
          <button type="button" class="btn btn-secondary" onClick={() => openDocument()}><FolderOpen {...ICON} /> 문서 열기</button>
        </div>
        <p class="muted small">화면 폴더나 테라리움 문서를 창에 끌어다 놓아도 됩니다.</p>
      </div>
    </div>
  );
}
