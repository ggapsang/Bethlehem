/* Bethlehem 렌더러 — Manna 화면 틀에 작성 기능(문서 열기·화면 등록·URL 담기)을 끼운다 */
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import 'pretendard/dist/web/variable/pretendardvariable.css';
import '@manna/styles.css';
import './bethlehem.css';
import { App } from '@manna/App';
import icon from '@manna/assets/favicon.png';
import { askName, dirty, fileName, user } from '@manna/store';
import { ImportDialog } from './ImportDialog';
import { handleDrop, host, importing, urlAsk } from './session';
import { DocTools, ScreenTools } from './Tools';
import { UrlDialog } from './UrlDialog';
import { Welcome } from './Welcome';

function Bethlehem() {
  const [dropping, setDropping] = useState(false);

  useEffect(() => {
    window.bethlehem.setState({ title: `${fileName.value ?? '새 문서'}${dirty.value ? ' •' : ''} — 테라리움`, dirty: dirty.value });
  }, [fileName.value, dirty.value]);

  useEffect(() => {
    if (!user.value) askName.value = true;
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
      <App host={host} start={<DocTools />} screenTools={<ScreenTools />} empty={<Welcome />} />
      {importing.value && <ImportDialog key={importing.value.dir + importing.value.screenId} target={importing.value} />}
      {urlAsk.value && <UrlDialog screenId={urlAsk.value.screenId} />}
      {dropping && <div class="drop-veil">화면 폴더나 테라리움 문서를 놓으세요</div>}
    </>
  );
}

const link = document.createElement('link');
link.rel = 'icon';
link.href = icon;
document.head.appendChild(link);

render(<Bethlehem />, document.getElementById('app-root')!);
