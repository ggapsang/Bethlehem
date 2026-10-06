/* 작성 프로그램(Electron) 스모크 — 기능마다 새 작업 폴더 · 새 설정으로 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { parseManna } from '../../packages/core/src';
import {
  CHROME, OUT, SITE, appWithScreen, splashDone, check, comments, ctrlPick, launchApp, nextOpen, openScreen, screenFrame, stagePoint, tempDir, typeIn, until, wait, type Spec,
} from './lib';

const B = 'apps/bethlehem/';

export const appSpecs: Spec[] = [
  {
    name: 'app-capture',
    kind: 'app',
    files: [/^packages\/manna\/src\/(actions|store)\.ts$/, /^packages\/manna\/src\/ui\/Popover\.tsx$/, /^packages\/manna\/src\/stage\/(Stage|record|MarkerStrip)\.tsx?$/, new RegExp(`^${B}main/index\\.ts$`)],
    async run() {
      const { app, page, ws } = await appWithScreen();
      try {
        await ctrlPick(page, await stagePoint(page, 300, 300), await stagePoint(page, 700, 600));
        check('영역 → 캡처 · 녹화 · 붙이기, 캡처가 기본', (await page.getAttribute('.snip-btn:has-text("캡처")', 'aria-pressed')) === 'true');
        await page.click('.snip-btn:has-text("녹화")');
        check('녹화 중 — 멈춤 그림이 걷히고 그 영역에 테두리', !!(await until(() => page.$('.snip-target.is-rec'), 5000)) && !(await page.$('.stage-still')));
        await wait(1300);
        await page.click('.snip-btn.is-rec');
        const v = await until(() => page.$('.popover-card .composer .clip video'), 10000);
        const w = v ? await v.evaluate(async (el) => {
          const x = el as HTMLVideoElement;
          if (x.readyState < 1) await new Promise((r) => x.addEventListener('loadedmetadata', r, { once: true }));
          return x.videoWidth;
        }) : 0;
        check('그 영역만 담은 클립이 붙는다', w > 0 && w < 700, `폭 ${w}px`);
        await typeIn(page, '.popover-card .composer .cm-content', '캡처 확인');
        await page.keyboard.press('Control+Enter');
        const c = await until(() => comments(ws, 'SCR-001').find((x: { body: string }) => x.body.includes('캡처 확인')), 8000);
        check('캡처 Comment — 그림 · 클립과 함께 저장', c?.kind === 'capture' && !!c?.shot && c?.clips?.length === 1);
        check('마커 줄에 캡처로', !!(await page.$('.mk-list .mk-capture')));
        // 핀 — 작업 폴더의 screen.json 에 남는다
        await page.keyboard.press('Escape');
        await page.click('button[aria-label="핀 꽂기"]');
        const fb = (await (await page.$('.stage-frame'))!.boundingBox())!;
        await page.mouse.click(fb.x + fb.width / 2, fb.y + fb.height / 2);
        await page.waitForSelector('.pin-input');
        await page.click('.pin-input');
        await page.keyboard.type('여기');
        await page.keyboard.press('Enter');
        check('핀이 작업 폴더에 저장된다 (screen.json)', !!(await until(() => JSON.parse(readFileSync(join(ws, 'screens', 'SCR-001', 'screen.json'), 'utf8')).pins?.[0]?.name === '여기', 8000)));
      } finally {
        await app.close();
      }
    },
  },
  {
    name: 'app-site',
    kind: 'app',
    net: true,
    files: [new RegExp(`^${B}(main/site|preload/site)\\.ts$`), /^packages\/manna\/src\/stage\/(Stage|SiteGallery|bridge)\.tsx?$/, /^packages\/manna\/src\/agent\//, /^packages\/manna\/src\/ui\/labels\.ts$/],
    async run() {
      const { app, page, ws } = await appWithScreen({ screen: false });
      try {
        await page.click('.welcome button:has-text("URL 추가")');
        await page.fill('.modal input[aria-label="주소"]', SITE);
        await page.click('.modal button[type=submit]');
        await until(() => page.$('webview.stage-webview'), 8000);
        await until(async () => !(await page.$('.stage-note')), 30000);
        await wait(3000);
        await ctrlPick(page, await stagePoint(page, 800, 450));
        check('요소를 골라도 캡처, 붙이기는 없다', (await page.getAttribute('.snip-btn:has-text("캡처")', 'aria-pressed')) === 'true' && !(await page.$('.snip-btn:has-text("화면에 붙이기")')));
        await typeIn(page, '.popover-card .composer .cm-content', '사이트 캡처');
        await page.keyboard.press('Control+Enter');
        const c = await until(() => comments(ws, 'SCR-001')[0], 8000);
        check('화면 전체를 찍은 캡처로 저장', c?.kind === 'capture' && !!c?.shot?.box);
        await page.keyboard.press('Escape');
        check('실시간 화면에 마커가 붙지 않는다', (await page.$$eval('.marker', (ms) => ms.filter((m) => (m as HTMLElement).style.display === 'flex').length)) === 0);
        await page.click('.sc-bar .seg-btn:has-text("캡처 모음")');
        check('프로그램에서도 캡처 모음', !!(await until(() => page.$('.gallery .gal-item .gal-shot img'), 5000)));
        // 실시간 / 캡처 모음은 탭마다 따로 — 다른 URL 탭은 실시간 그대로, 돌아오면 캡처 모음 그대로
        await page.click('button[aria-label="화면 추가"]');
        await page.click('.popover-item:has-text("URL")');
        await page.fill('.modal input[aria-label="주소"]', SITE);
        await page.click('.modal button[type=submit]');
        check('다른 URL 탭은 실시간', !!(await until(async () => (await page.getAttribute('.tab.is-on', 'data-id')) === 'SCR-002' && !!(await page.$('webview.stage-webview')) && !(await page.$('.gallery')), 8000)));
        await page.click('.tab[data-id="SCR-001"] .tab-main');
        check('돌아오면 그 탭은 캡처 모음 그대로', !!(await until(async () => !!(await page.$('.gallery .gal-item')) && !(await page.$('webview.stage-webview')), 5000)));
        await page.click('.tab[data-id="SCR-002"] .tab-main');
        check('다시 가면 그 탭은 실시간 그대로', !!(await until(async () => !!(await page.$('webview.stage-webview')) && !(await page.$('.gallery')), 5000)));
        await page.click('.tab[data-id="SCR-001"] .tab-main');
        await page.click('.sc-bar .seg-btn:has-text("실시간")');
        // 받는 사람
        await page.keyboard.press('Control+s');
        await wait(2500);
        const dist = join(ws, 'dist', readdirSync(join(ws, 'dist')).find((n) => n.endsWith('.terr.html'))!);
        const br = await chromium.launch({ executablePath: CHROME });
        const rp = await (await br.newContext({ viewport: { width: 1600, height: 960 } })).newPage();
        await rp.goto(pathToFileURL(dist).href);
        await rp.fill('.modal input', '수신자');
        await rp.click('.modal button[type=submit]');
        check('받는 사람 — URL 화면은 캡처 모음', !!(await until(() => rp.$('.gallery .gal-item .gal-shot img'), 8000)));
        await br.close();
      } finally {
        await app.close();
      }
    },
  },
  {
    name: 'app-workspace',
    kind: 'app',
    files: [/^packages\/manna\/src\/stage\/ScreenTabs\.tsx$/, new RegExp(`^${B}main/(index|workspace|image)\\.ts$`), new RegExp(`^${B}renderer/src/(session|Welcome|Tools|ImportDialog|UrlDialog)\\.tsx?$`), new RegExp(`^${B}(shared|preload)/`), /^packages\/core\/node\//],
    async run() {
      const ctx = await appWithScreen();
      let { app, page } = ctx;
      const { ws, ud, src } = ctx;
      try {
        check('작업 폴더에 화면이 저장된다', !!(await until(() => existsSync(join(ws, 'screens', 'SCR-001', 'screen.json')), 8000)));
        await page.dblclick('.tab[data-id="SCR-001"] .tab-main');
        await page.fill('.tab-input', '바꾼 이름');
        await page.keyboard.press('Enter');
        check('탭을 두 번 눌러 이름 바꾸기', !!(await until(() => JSON.parse(readFileSync(join(ws, 'screens', 'SCR-001', 'screen.json'), 'utf8')).title === '바꾼 이름', 5000)));
        // 탭 × — 묻고 화면을 지운다 (임시 화면 하나를 더해서)
        await page.click('button[aria-label="화면 추가"]');
        await nextOpen(app, src);
        await page.click('.popover-item:has-text("화면 폴더 선택")');
        await page.waitForSelector('.file-list');
        await page.click('.modal button[type=submit]');
        await until(() => existsSync(join(ws, 'screens', 'SCR-002')), 8000);
        let asked = '';
        page.once('dialog', (dg) => {
          asked = dg.message();
          dg.accept();
        });
        await page.click('.tab[data-id="SCR-002"] .tab-x');
        check('탭 × — 한 번 묻고 화면을 지운다', asked.includes('SCR-002') && !!(await until(() => !existsSync(join(ws, 'screens', 'SCR-002')), 8000)) && !(await page.$('.tab[data-id="SCR-002"]')));
        await page.click('.tab[data-id="SCR-001"] .tab-main').catch(() => {});
        // 바깥에서 고치면 다시 불러온다
        await ctrlPick(page, await stagePoint(page, 960, 120));
        await page.click('.snip-btn:has-text("화면에 붙이기")').catch(() => {});
        await typeIn(page, '.popover-card .composer .cm-content', '바깥 테스트');
        await page.keyboard.press('Control+Enter');
        const cj = join(ws, 'screens', 'SCR-001', 'comments.json');
        await until(() => comments(ws, 'SCR-001').length === 1, 8000);
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        await wait(4500); // dist 굽기까지 지나가게 — 그 쓰기를 바깥 변경으로 잘못 알면 안 된다
        const list = JSON.parse(readFileSync(cj, 'utf8'));
        list[0].title = '바깥에서 단 제목';
        writeFileSync(cj, JSON.stringify(list, null, 2));
        check('바깥에서 comments.json 을 고치면 바로 다시 불러온다', !!(await until(async () => ((await page.textContent('.cards > .card:first-child .card-name')) ?? '') === '바깥에서 단 제목', 10000)));
        // ＋ → 파일 (다른 테라리움 문서 + 그림)
        const dist = join(ws, 'dist', readdirSync(join(ws, 'dist')).find((n) => n.endsWith('.terr.html'))!);
        const img = join(OUT, 'smoke-icon.png');
        mkdirSync(OUT, { recursive: true });
        cpSync(resolve('docs/icon.png'), img);
        await nextOpen(app, [dist, img]);
        await page.click('button[aria-label="화면 추가"]');
        await page.click('.popover-item:has-text("파일")');
        check('＋ → 파일 — 문서의 화면과 그림이 들어온다', !!(await until(() => readdirSync(join(ws, 'screens')).length === 3, 10000)), readdirSync(join(ws, 'screens')).join(','));
        // 탭 숨기기 — 지우지 않고 탭에서만 뺀다
        const tabIds = () => page.$$eval('.tabs .tab', (t) => t.map((x) => (x as HTMLElement).dataset.id));
        const before = await tabIds();
        const hideId = before[before.length - 1]!;
        await page.click(`.tab[data-id="${hideId}"] .tab-main`, { button: 'right' });
        await page.click('.tab-menu .popover-item:has-text("탭 숨기기")');
        check('오른쪽 클릭 → 탭 숨기기: 탭만 빠지고 화면은 남는다', !(await tabIds()).includes(hideId) && existsSync(join(ws, 'screens', hideId)));
        check('▾ 에 숨긴 개수가 뜬다', ((await page.textContent('.tab-more').catch(() => '')) ?? '') === '+1');
        await page.click('button[aria-label="화면 목록"]');
        await page.click(`button[aria-label="${hideId} 탭 보이기"]`);
        check('▾ 의 눈 아이콘으로 다시 보인다', (await tabIds()).includes(hideId) && !(await page.$('.tab-more')));
        await page.click('button[aria-label="화면 목록"]');
        await page.click(`.tab[data-id="${hideId}"] .tab-main`, { button: 'middle' });
        check('가운데 클릭도 숨기기 (지우지 않는다)', !(await tabIds()).includes(hideId) && existsSync(join(ws, 'screens', hideId)));
        // 탭 배치(숨김 · 순서)는 문서에 들어가 내보낸 파일에서도 그대로
        const [t1, t3] = await tabIds(); // 하나는 숨긴 채 — 남은 둘의 순서를 바꾼다
        const b1 = (await (await page.$(`.tab[data-id="${t1}"] .tab-main`))!.boundingBox())!;
        const b3 = (await (await page.$(`.tab[data-id="${t3}"] .tab-main`))!.boundingBox())!;
        await page.mouse.move(b3.x + b3.width / 2, b3.y + b3.height / 2);
        await page.mouse.down();
        await page.mouse.move(b1.x + 5, b1.y + b1.height / 2, { steps: 8 });
        await page.mouse.up();
        const layout = await tabIds();
        check('탭을 끌어 순서를 바꾼다', layout[0] === t3, layout.join(','));
        await page.keyboard.press('Control+s');
        await wait(2000);
        const distNow = join(ws, 'dist', readdirSync(join(ws, 'dist')).find((n) => n.endsWith('.terr.html'))!);
        const meta = parseManna(readFileSync(distNow, 'utf8')).doc.meta.tabs;
        check('문서에 탭 배치가 들어 있다 (순서 · 숨김)', meta?.open.join(',') === layout.join(',') && meta?.hidden.join(',') === hideId, JSON.stringify(meta));
        const br = await chromium.launch({ executablePath: CHROME });
        const rp = await (await br.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
        await rp.goto(pathToFileURL(distNow).href);
        await rp.fill('.modal input', '받는이').catch(() => {});
        await rp.click('.modal button[type=submit]').catch(() => {});
        const got = await until(async () => {
          const ids = await rp.$$eval('.tabs .tab', (t) => t.map((x) => (x as HTMLElement).dataset.id));
          return ids.length ? ids : null;
        }, 8000);
        check('받는 사람이 처음 열면 작성자의 탭 순서 · 숨김 그대로', got?.join(',') === layout.join(','), `${got?.join(',')} / ${layout.join(',')}`);
        await br.close();
        await page.click('button[aria-label="화면 목록"]');
        await page.click(`button[aria-label="${hideId} 탭 보이기"]`);
        await page.click('button[aria-label="화면 목록"]');
        // 현재 탭만 저장
        const oneOut = join(OUT, 'smoke-app-one-tab');
        await app.evaluate(({ dialog }, d) => {
          dialog.showSaveDialog = (async () => ({ canceled: false, filePath: d })) as typeof dialog.showSaveDialog;
        }, oneOut);
        const cur = await page.getAttribute('.tab.is-on', 'data-id');
        await page.click('button[aria-label="저장 방식"]');
        await page.click('.save-menu button[aria-label="현재 탭만 저장"]');
        const oneFile = await until(() => (existsSync(oneOut + '.terr.html') ? oneOut + '.terr.html' : null), 8000);
        const oneIds = oneFile ? parseManna(readFileSync(oneFile, 'utf8')).doc.screens.map((s) => s.id) : [];
        check('현재 탭만 저장 — 그 화면 하나만 새 파일로', oneIds.length === 1 && oneIds[0] === cur, `${cur} → ${oneIds.join(',')}`);
        // 다시 켜면 최근 목록
        await app.close();
        ({ app, page } = await launchApp(ud, [ws, src]));
        const name = ws.split(/[\\/]/).pop()!;
        check('켜면 저절로 열지 않고 최근 목록', !!(await until(() => page.$(`.recent-places .recent-item:has-text("${name}")`), 10000)));
        await page.click(`.recent-places .recent-item:has-text("${name}")`);
        check('최근 목록에서 고르면 열린다', !!(await until(async () => ((await page.textContent('.tb-place').catch(() => '')) ?? '').includes(name), 10000)));
        // 테라리움 문서가 든 폴더 → 풀어서
        const unpack = tempDir('unpack');
        cpSync(dist, join(unpack, 'got.terr.html'));
        await app.close();
        ({ app, page } = await launchApp(ud, [ws, src, unpack]));
        await nextOpen(app, unpack);
        await page.click('.welcome button:has-text("폴더 열기")');
        check('문서가 든 폴더를 열면 풀어서 작업 폴더로', !!(await until(() => existsSync(join(unpack, 'terrarium.json')), 10000)));
      } finally {
        await app.close();
      }
    },
  },
  {
    name: 'app-terminal',
    kind: 'app',
    files: [new RegExp(`^${B}(main/terminal\\.ts|renderer/src/Terminal\\.tsx)$`)],
    async run() {
      const { app, page, ws } = await appWithScreen({ screen: false });
      try {
        await page.keyboard.press('Control+Backquote');
        check('Ctrl+` 로 터미널', !!(await until(() => page.$('.term.is-open .xterm'), 5000)));
        const text = () => page.evaluate(() => document.querySelector('.term .xterm-rows')?.textContent ?? '');
        await until(async () => /PS |\$ /.test(await text()), 15000);
        await page.click('.term .xterm');
        await page.keyboard.type('echo terr-ok; (Get-Location).Path');
        await page.keyboard.press('Enter');
        const leaf = ws.split(/[\\/]/).pop()!.toLowerCase();
        check('작업 폴더에서 셸이 돈다', !!(await until(async () => (await text()).includes('terr-ok') && (await text()).toLowerCase().includes(leaf), 15000)));
        check('Claude Code 단추', !!(await page.$('.term button:has-text("Claude Code")')));
      } finally {
        await app.close();
      }
    },
  },
  {
    name: 'app-shell',
    kind: 'app',
    files: [new RegExp(`^${B}(main/menu\\.ts|renderer/src/(Guide|menu|main)\\.tsx?)$`), /^docs\/USER_GUIDE\.md$/],
    async run() {
      const { app, page } = await appWithScreen({ screen: false });
      try {
        const menu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((m) => m.label) ?? []);
        check('창 메뉴', ['파일', '편집', '화면', '보기', '도움말'].every((l) => menu.some((m) => m.startsWith(l))), menu.join(' '));
        check('창 제목 Terrarium', (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())) === 'Terrarium');
        await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.find((m) => m.label.startsWith('도움말'))?.submenu?.items.find((i) => i.label === '사용자 가이드')?.click());
        check('가이드 창 — 마크다운을 그린다', !!(await until(() => page.$('.guide-win .md-render table'), 5000)));
        const f0 = await page.$eval('.guide-body', (el) => parseFloat(getComputedStyle(el).fontSize));
        await page.click('.guide-win button[aria-label="글자 크게"]');
        check('가이드 글자 크기', (await page.$eval('.guide-body', (el) => parseFloat(getComputedStyle(el).fontSize))) > f0);
        const box = async () => (await (await page.$('.guide-win'))!.boundingBox())!;
        const dragBy = async (sel: string, dx: number, dy: number) => {
          const b = (await (await page.$(sel))!.boundingBox())!;
          await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
          await page.mouse.down();
          await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 5 });
          await page.mouse.up();
        };
        const g0 = await box();
        await dragBy('.gw-w', -120, 0);
        const g1 = await box();
        check('왼쪽 가장자리를 끌면 왼쪽으로 넓어진다', g1.width > g0.width + 100 && g1.x < g0.x - 100, `${Math.round(g0.width)} → ${Math.round(g1.width)}`);
        await dragBy('.gw-se', 60, -80);
        const g2 = await box();
        check('모서리를 끌면 두 방향으로 바뀐다', g2.width > g1.width + 40 && g2.height < g1.height - 60);
        await dragBy('.gw-n', 0, 50);
        check('위 가장자리', (await box()).height < g2.height - 30);
        await page.click('.guide-win button[aria-label="최대화"]');
        const gm = await box();
        const vw = await page.evaluate(() => [innerWidth, innerHeight]);
        check('최대화', Math.abs(gm.width - vw[0]!) < 2 && Math.abs(gm.height - vw[1]!) < 2);
        await page.dblclick('.guide-head strong');
        check('제목줄 두 번 누르면 원래 크기', Math.abs((await box()).width - g2.width) < 3);
        const f1 = await page.$eval('.guide-body', (el) => parseFloat(getComputedStyle(el).fontSize));
        await page.hover('.guide-body');
        await page.keyboard.down('Control');
        await page.mouse.wheel(0, -200);
        await page.keyboard.up('Control');
        check('Ctrl+휠로 글자 확대', !!(await until(async () => (await page.$eval('.guide-body', (el) => parseFloat(getComputedStyle(el).fontSize))) > f1, 2000)));
        await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('devtools')?.click());
        check('보기 → 개발자 도구', !!(await until(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.isDevToolsOpened())), 5000)));
      } finally {
        await app.close();
      }
    },
  },
  {
    name: 'app-windows',
    kind: 'app',
    files: [/^packages\/manna\/src\/stage\/ScreenTabs\.tsx$/, new RegExp(`^${B}renderer/src/(sync|main)\\.tsx?$`), new RegExp(`^${B}main/index\\.ts$`), /^packages\/manna\/src\/store\.ts$/],
    async run() {
      const { app, page, ws, src } = await appWithScreen();
      try {
        await page.click('button[aria-label="화면 추가"]');
        await nextOpen(app, src);
        await page.click('.popover-item:has-text("화면 폴더 선택")');
        await page.waitForSelector('.file-list');
        await page.click('.modal button[type=submit]');
        await until(() => page.$('.tab[data-id="SCR-002"]'), 8000);
        await page.click('.tab[data-id="SCR-001"] .tab-main');
        await screenFrame(page);
        // 복제 보기 — 같은 화면을 새 창에, 본 창의 탭은 그대로
        await page.click('.tab[data-id="SCR-001"] .tab-main', { button: 'right' });
        const dupP = app.waitForEvent('window');
        await page.click('.popover-item:has-text("복제 보기")');
        const dup = await dupP;
        await dup.waitForSelector('.tab[data-id="SCR-001"]', { timeout: 10000 });
        check('복제 보기 — 새 창에 그 화면 하나만', (await dup.$$('.tabs .tab')).length === 1 && !(await dup.$('button[aria-label="화면 목록"]')));
        check('복제 보기 — 본 창 탭은 그대로', !!(await page.$('.tab[data-id="SCR-001"]')));
        await splashDone(await screenFrame(dup));
        await ctrlPick(dup, await stagePoint(dup, 400, 300), await stagePoint(dup, 800, 600));
        await typeIn(dup, '.popover-card .composer .cm-content', '복제 창에서');
        await dup.keyboard.press('Control+Enter');
        check('띄운 창에서 단 Comment — 본 창에 바로 보이고', !!(await until(async () => (await page.$$eval('.cards > .card', (cs) => cs.map((c) => c.textContent ?? ''))).some((t) => t.includes('복제 창에서')), 8000)));
        const c = await until(() => comments(ws, 'SCR-001').find((x: { body: string }) => x.body.includes('복제 창에서')), 10000);
        check('본 창이 작업 폴더에 저장 (그 창의 화면을 찍은 캡처로)', c?.kind === 'capture' && !!c?.shot);
        await dup.keyboard.press('Escape');
        await page.dblclick('.tab[data-id="SCR-001"] .tab-main');
        await page.fill('.tab-input', '본 창에서 바꿈');
        await page.keyboard.press('Enter');
        check('본 창에서 고친 것 — 띄운 창에 바로', !!(await until(async () => ((await dup.textContent('.tab[data-id="SCR-001"]')) ?? '').includes('본 창에서 바꿈'), 5000)));
        await dup.close();
        // 탭 빼기 — 탭 줄 밖으로 끌어 놓으면 새 창, 본 창 탭 줄에서는 빠졌다가 닫으면 돌아온다
        const tb = (await (await page.$('.tab[data-id="SCR-002"] .tab-main'))!.boundingBox())!;
        await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
        await page.mouse.down();
        await page.mouse.move(tb.x + tb.width / 2 + 20, tb.y + 120, { steps: 6 });
        await page.mouse.move(tb.x + tb.width / 2 + 40, tb.y + 260, { steps: 6 });
        check('끌고 있을 때 빠질 탭 표시', !!(await page.$('.tab.is-tearing[data-id="SCR-002"]')));
        const offP = app.waitForEvent('window');
        await page.mouse.up();
        const off = await offP;
        await off.waitForSelector('.tab[data-id="SCR-002"]', { timeout: 10000 });
        check('탭을 끌어 내면 그 화면이 새 창으로', (await off.$$('.tabs .tab')).length === 1);
        check('뺀 탭은 본 창 탭 줄에서 빠진다', !!(await until(async () => !(await page.$('.tab[data-id="SCR-002"]')), 5000)) && !!(await page.$('.tabs-detached')));
        await off.close();
        check('뺀 창을 닫으면 본 창 탭 줄로 돌아온다', !!(await until(() => page.$('.tab[data-id="SCR-002"]'), 5000)));
        const order = JSON.parse(readFileSync(join(ws, 'terrarium.json'), 'utf8'));
        check('띄운 창이 탭 배치를 바꾸지 않는다', !JSON.stringify(order.meta?.tabs?.hidden ?? []).includes('SCR-002'));
      } finally {
        await app.close();
      }
    },
  },
];

// 쓰지 않는 도구를 가져오지 않았다고 타입 검사가 투덜대지 않게
void openScreen;
void screenFrame;
