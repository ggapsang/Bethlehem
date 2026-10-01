/* 화면이 없을 때 — 첫 화면 */
import { FolderOpen, FolderPlus } from 'lucide-preact';
import keyArt from '../../../../docs/key_art.png';
import { addScreenFromPicker, openDocument } from './session';

const ICON = { size: 16, strokeWidth: 1.5 };

export function Welcome() {
  return (
    <div class="welcome">
      <img class="welcome-art" src={keyArt} alt="Terrarium — 유리 구 안에서 자라는 새싹" />
      <div class="welcome-body">
        <h2>동작하는 화면을 그대로 담은 화면정의서</h2>
        <p class="muted">
          바이브 코딩으로 만든 화면 폴더를 넣고, 화면 위에 바로 어노테이션을 다세요. 저장하면 받는 사람이 더블클릭만으로 여는 HTML 한 장(Manna)이 됩니다.
        </p>
        <div class="row">
          <button type="button" class="btn btn-primary" onClick={() => addScreenFromPicker()}><FolderPlus {...ICON} /> 화면 폴더 추가</button>
          <button type="button" class="btn btn-secondary" onClick={openDocument}><FolderOpen {...ICON} /> Manna 문서 열기</button>
        </div>
        <p class="muted small">화면 폴더나 Manna 문서를 창에 끌어다 놓아도 됩니다.</p>
      </div>
    </div>
  );
}
