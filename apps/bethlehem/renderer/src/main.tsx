/* Bethlehem 렌더러 — Manna 화면 틀에 작성 기능(작업 폴더·화면 등록·URL 화면)을 끼운다 */
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import 'pretendard/dist/web/variable/pretendardvariable.css';
import '@manna/styles.css';
import './bethlehem.css';
import { App } from '@manna/App';
import icon from '@manna/assets/favicon.png';
import { askName, dirty, doc, rev, screenId, user, versionNo } from '@manna/store';
import type { WindowTools } from '@manna/stage/ScreenTabs';
import { ImportDialog } from './ImportDialog';
import { docAsk, handleDrop, host, importing, mode, rememberScreen, save, start, urlAsk } from './session';
import { mirrorHost, startMainSync, startMirror } from './sync';
import { runMenu } from './menu';
import { AddScreenMenu, DeleteScreenButton, DocTools, NewVersionMenu } from './Tools';
import { UrlDialog } from './UrlDialog';
import { DocChoice, Welcome } from './Welcome';
import { GuideWindow, guideOpen } from './Guide';
import { TerminalPanel, termOpen } from './Terminal';

const api = window.bethlehem;

/** 탭을 새 창으로 빼기 · 복제 보기 — 띄운 창은 본 창과 문서를 나눠 쓴다(sync.ts) */
const windowTools: WindowTools = {
  tearOff: (id, x, y) => void api.openScreenWindow({ screen: id, detach: true, x, y }),
  duplicate: (id) => void api.openScreenWindow({ screen: id, detach: false }),
};

function Bethlehem() {
  const [dropping, setDropping] = useState(false);

  useEffect(() => {
    window.bethlehem.setState({ title: 'Terrarium', dirty: dirty.value });
  }, [mode.value, dirty.value]);

  useEffect(rememberScreen, [screenId.value, versionNo.value]);

  useEffect(() => {
    if (!user.value) askName.value = true;
    start();
    // Ctrl+` — 터미널 펴기/접기 (VS Code 와 같다)
    const onTermKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === '`' || e.code === 'Backquote')) {
        e.preventDefault();
        termOpen.value = !termOpen.peek();
      }
    };
    window.addEventListener('keydown', onTermKey, true);
    window.bethlehem.onMenu(runMenu);
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      setDropping(true);
    };
    const leave = (e: DragEvent) => !e.relatedTarget && setDropping(false);
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDropping(false);
      if (e.dataTransfer?.files.length) handleDrop(e.dataTransfer.files);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  return (
    <>
      <App host={host} windowTools={windowTools} start={<DocTools />} tabTools={<AddScreenMenu />} versionTools={<NewVersionMenu />} screenActions={<DeleteScreenButton />} empty={<Welcome />} bottom={<TerminalPanel />} />
      {importing.value && <ImportDialog key={importing.value.dir + importing.value.screenId} target={importing.value} />}
      {urlAsk.value && <UrlDialog screenId={urlAsk.value.screenId} open={urlAsk.value.open} />}
      {docAsk.value && <DocChoice />}
      {guideOpen.value && <GuideWindow />}
      {dropping && <div class="drop-veil">폴더 · 테라리움 문서 · 그림을 놓으세요</div>}
    </>
  );
}

const link = document.createElement('link');
link.rel = 'icon';
link.href = icon;
document.head.appendChild(link);

/** 띄운 창 — 화면 하나만. 작업 폴더 · 터미널 · 작성 도구는 본 창에만 */
const mirrorAt = mirrorHost(host);
function Mirror() {
  rev.value;
  const s = doc.value.screens.find((x) => x.id === screenId.value);
  useEffect(() => {
    document.title = s ? `${s.id} ${s.title} — Terrarium` : 'Terrarium';
  }, [s?.id, s?.title]);
  return <App host={mirrorAt} />;
}

const q = new URLSearchParams(location.search);
const root = document.getElementById('app-root')!;
if (q.get('window') === 'mirror') {
  startMirror(q.get('screen') ?? '', q.get('detach') === '1').then(() => render(<Mirror />, root));
} else {
  startMainSync((saveAs) => void save(host, saveAs));
  render(<Bethlehem />, root);
}
