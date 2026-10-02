/* 화면이 없을 때 — 폴더나 문서를 열고, 작업 폴더가 있으면 화면을 추가한다 */
import { FileText, FolderOpen, FolderPlus, Globe, Image } from 'lucide-preact';
import keyArt from '../../../../docs/key_art.png';
import { addImageScreen, addScreenFromFolder, askUrl, docAsk, mode, openDocument, openFolder, unpackInto } from './session';

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
            <button type="button" class="btn btn-secondary" onClick={() => addImageScreen()}><Image {...ICON} /> 그림 추가</button>
          </div>
        ) : (
          <div class="row welcome-actions">
            <button type="button" class="btn btn-primary" onClick={() => openFolder()}><FolderOpen {...ICON} /> 폴더 열기</button>
            <button type="button" class="btn btn-secondary" onClick={() => openDocument()}><FileText {...ICON} /> 문서 열기</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** 테라리움 문서가 여럿 든 폴더 — 어느 문서로 작업 폴더를 만들지 */
export function DocChoice() {
  const a = docAsk.value!;
  const close = () => (docAsk.value = null);
  return (
    <div class="modal-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
      <div class="modal" role="dialog" aria-labelledby="doc-choice-title">
        <h2 id="doc-choice-title">문서 고르기</h2>
        <div class="doc-choice">
          {a.docs.map((d) => (
            <button key={d.path} type="button" class="popover-item popover-recent" onClick={() => unpackInto(a.dir, d.path)}>
              <span class="ellipsis">{d.title ?? d.name}</span>
              <span class="muted small ellipsis">{d.name} · {new Date(d.at).toLocaleString('ko-KR')}</span>
            </button>
          ))}
        </div>
        <div class="row">
          <span class="grow" />
          <button type="button" class="btn btn-ghost" onClick={close}>취소</button>
        </div>
      </div>
    </div>
  );
}
