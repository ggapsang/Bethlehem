/* 창 메뉴(파일 · 편집 · 화면 · 보기)에서 온 명령 — 툴바·단축키와 같은 일을 한다 */
import { save } from '@manna/host';
import { mode, paused, redo, screen, setTheme, stageScale, theme, togglePanel, undo, zoom, zoomStep } from '@manna/store';
import type { MenuCommand } from '../../shared/api';
import { addImageScreen, addScreenFromFolder, addScreensFromFiles, askUrl, host, openDocument, openFolder, reloadWorkspace, urlAsk } from './session';

import { guideOpen } from './Guide';
import { termOpen } from './Terminal';

const api = window.bethlehem;

export function runMenu(cmd: MenuCommand): void {
  const scr = screen.peek();
  switch (cmd) {
    case 'open-folder': return void openFolder();
    case 'open-doc': return void openDocument();
    case 'open-url': return void (urlAsk.value = { open: true });
    case 'terminal': return void (termOpen.value = !termOpen.peek());
    case 'reload': return void reloadWorkspace(true);
    case 'save': return void save(host, false);
    case 'save-as': return void save(host, true);
    case 'reveal-dist': return void api.wsReveal('dist');
    case 'reveal-returned': return void api.wsReveal('returned');
    case 'undo': return undo();
    case 'redo': return redo();
    case 'add-folder': return void addScreenFromFolder();
    case 'add-url': return void askUrl();
    case 'add-image': return void addImageScreen();
    case 'add-files': return void addScreensFromFiles();
    case 'new-version': return void (scr && addScreenFromFolder(scr.id));
    case 'picker': return void (mode.value = mode.peek() === 'annotate' ? 'view' : 'annotate');
    case 'pause': return void (paused.value = !paused.peek());
    case 'panel': return togglePanel();
    case 'theme': return setTheme(theme.peek() === 'light' ? 'dark' : 'light');
    case 'zoom-in': return zoomStep(1, stageScale.peek());
    case 'zoom-out': return zoomStep(-1, stageScale.peek());
    case 'zoom-fit': return void (zoom.value = null);
    case 'guide': return void (guideOpen.value = !guideOpen.peek());
  }
}
