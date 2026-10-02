/* 창 메뉴 — 파일 · 편집 · 화면 · 보기 · 도움말
 * 렌더러가 하는 일은 'menu' 메시지로 보낸다. 단축키는 렌더러가 이미 처리하므로 메뉴에는 표시만 한다(registerAccelerator: false).
 * 잘라내기·복사·붙여넣기·모두 선택은 Electron 기본 동작(role)을 쓴다.
 */
import { app, dialog, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';

export type MenuCommand =
  | 'open-folder' | 'open-doc' | 'open-url' | 'terminal' | 'reload' | 'save' | 'save-as' | 'reveal-dist' | 'reveal-returned'
  | 'undo' | 'redo'
  | 'add-folder' | 'add-url' | 'add-image' | 'add-files' | 'new-version' | 'picker' | 'pause'
  | 'panel' | 'theme' | 'guide' | 'zoom-in' | 'zoom-out' | 'zoom-fit';

export function buildMenu(getWin: () => BrowserWindow | null): Menu {
  const send = (cmd: MenuCommand) => getWin()?.webContents.send('menu', cmd);
  const item = (label: string, cmd: MenuCommand, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    ...(accelerator ? { accelerator, registerAccelerator: false } : {}),
    click: () => send(cmd),
  });

  const template: MenuItemConstructorOptions[] = [
    {
      label: '파일(&F)',
      submenu: [
        item('폴더 열기…', 'open-folder'),
        item('문서 열기…', 'open-doc'),
        item('URL 열기…', 'open-url'),
        { type: 'separator' },
        item('저장', 'save', 'Ctrl+S'),
        item('다른 이름으로 저장…', 'save-as', 'Ctrl+Shift+S'),
        { type: 'separator' },
        item('보낼 파일 폴더(dist) 열기', 'reveal-dist'),
        item('돌아온 문서 폴더(returned) 열기', 'reveal-returned'),
        { type: 'separator' },
        { label: '끝내기', role: 'quit' },
      ],
    },
    {
      label: '편집(&E)',
      submenu: [
        item('되돌리기', 'undo', 'Ctrl+Z'),
        item('다시 실행', 'redo', 'Ctrl+Shift+Z'),
        { type: 'separator' },
        { label: '잘라내기', role: 'cut' },
        { label: '복사', role: 'copy' },
        { label: '붙여넣기', role: 'paste' },
        { label: '모두 선택', role: 'selectAll' },
      ],
    },
    {
      label: '화면(&S)',
      submenu: [
        item('화면 폴더 추가…', 'add-folder'),
        item('URL 추가…', 'add-url'),
        item('파일에서 가져오기 — 테라리움 문서 · 그림…', 'add-files'),
        item('지금 화면의 새 버전…', 'new-version'),
        { type: 'separator' },
        item('피커 켜기/끄기', 'picker'),
        item('일시정지/재생', 'pause'),
      ],
    },
    {
      label: '보기(&V)',
      submenu: [
        item('노트·Comment 패널', 'panel'),
        item('터미널', 'terminal', 'Ctrl+`'),
        item('테마 전환 (다크/라이트)', 'theme'),
        { type: 'separator' },
        item('화면 확대 (Ctrl+휠)', 'zoom-in', 'Ctrl+='),
        item('화면 축소 (Ctrl+휠)', 'zoom-out', 'Ctrl+-'),
        item('화면 맞춤', 'zoom-fit', 'Ctrl+0'),
        { type: 'separator' },
        {
          label: '전체화면',
          accelerator: 'F11',
          // 렌더러의 Fullscreen API 를 사용자 동작으로 부른다 — 툴바를 숨기는 전체화면과 같은 것
          click: () => getWin()?.webContents.executeJavaScript('document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()', true).catch(() => {}),
        },
        { type: 'separator' },
        {
          id: 'devtools',
          label: '개발자 도구',
          accelerator: 'F12',
          registerAccelerator: false,
          click: () => getWin()?.webContents.toggleDevTools(),
        },
        item('작업 폴더 다시 불러오기', 'reload'),
        { label: '프로그램 화면 새로 고침', accelerator: 'Ctrl+Shift+R', click: () => getWin()?.webContents.reload() },
      ],
    },
    {
      label: '도움말(&H)',
      submenu: [
        { label: '사용자 가이드', accelerator: 'F1', click: () => send('guide') },
        { type: 'separator' },
        {
          label: 'Terrarium 정보',
          click: () => {
            const w = getWin();
            const opts = { type: 'info' as const, title: 'Terrarium', message: 'Terrarium', detail: `버전 ${app.getVersion()}\n동작하는 화면을 그대로 품은 화면정의서` };
            if (w) dialog.showMessageBox(w, opts);
            else dialog.showMessageBox(opts);
          },
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}
