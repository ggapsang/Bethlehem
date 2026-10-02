/* 화면이 없을 때 — 폴더나 문서를 열고, 작업 폴더가 있으면 화면을 추가한다 */
import { FileText, FolderGit2, FolderOpen, FolderPlus, Globe, Image } from 'lucide-preact';
import keyArt from '../../../../docs/key_art.png';
import { addImageScreen, addScreenFromFolder, askUrl, docAsk, mode, openDocument, openFolder, openUrl, openWorkspace, recent, unpackInto, urlAsk } from './session';

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
            <button type="button" class="btn btn-secondary" onClick={() => (urlAsk.value = { open: true })}><Globe {...ICON} /> URL 열기</button>
          </div>
        )}
        {!inWorkspace && <RecentPlaces />}
      </div>
    </div>
  );
}

const when = (iso: string) => {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  return days < 1 ? d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : days < 7 ? `${days}일 전` : d.toLocaleDateString('ko-KR');
};

/** 최근에 연 곳 — 작업 폴더 · URL · 문서 */
function RecentPlaces() {
  const r = recent.value;
  const items = [
    ...r.workspaces.map((x) => ({ key: `w:${x.path}`, icon: <FolderGit2 {...ICON} />, name: x.name, sub: x.path, at: x.at, open: () => openWorkspace(x.path) })),
    ...r.urls.map((x) => ({ key: `u:${x.url}`, icon: <Globe {...ICON} />, name: x.url.replace(/^https?:\/\//, ''), sub: 'URL', at: x.at, open: () => openUrl(x.url) })),
    ...r.files.map((x) => ({ key: `f:${x.path}`, icon: <FileText {...ICON} />, name: x.name, sub: x.path, at: x.at, open: () => openDocument(x.path) })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  if (!items.length) return null;
  return (
    <section class="recent-places" aria-label="최근">
      <h2 class="recent-title">최근</h2>
      <ul>
        {items.slice(0, 12).map((it) => (
          <li key={it.key}>
            <button type="button" class="recent-item" title={it.sub} onClick={it.open}>
              {it.icon}
              <span class="recent-name ellipsis">{it.name}</span>
              <span class="recent-sub muted small ellipsis">{it.sub}</span>
              <span class="recent-at muted small">{when(it.at)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
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
