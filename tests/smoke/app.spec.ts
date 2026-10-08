/* 작성 프로그램(Electron) 스모크 — 기능마다 새 작업 폴더 · 새 설정으로 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { parseManna } from '../../packages/core/src';
import {
  CHROME, OUT, SITE, appWithScreen, splashDone, visibleMarkers, check, comments, ctrlPick, launchApp, nextOpen, openScreen, screenFrame, stagePoint, tempDir, typeIn, until, wait, type Spec,
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
        // 켜자마자 멈추기 — 녹화기가 준비되는 중에 눌러도 다시 켜지 않고 바로 멈춘다
        await page.click('.snip-btn:has-text("녹화")');
        await page.click('.snip-btn.is-rec');
        const quick = Date.now();
        // 바쁠 때는 화면 공유를 받는 것부터 늦다 — 30초 자동 멈춤이 아니라 곧 붙으면 된다
        check('켜자마자 멈춰도 곧바로 클립이 붙는다', !!(await until(() => page.$('.popover-card .composer .clip video'), 15000)), `${Date.now() - quick}ms`);
        await page.click('.popover-card .composer .clip button').catch(() => {});
        await until(async () => !(await page.$('.popover-card .composer .clip')), 3000);
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
        await until(() => page.$('webview.stage-webview:not(.is-hidden)'), 8000);
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
        // URL 화면의 원본 내려받기 — 지금 DOM 을 CSS · 글꼴 · 그림까지 넣은 HTML 하나로 (스크립트 없이, 오프라인으로 열린다)
        const domOut = join(tempDir('dom'), 'copy.html');
        await app.evaluate(({ session }, p) => session.defaultSession.once('will-download', (_e, item) => item.setSavePath(p)), domOut);
        await page.click('button[aria-label="저장 방식"]');
        check('URL 화면 — 메뉴가 DOM 사본 내려받기로', ((await page.textContent('.save-menu button[aria-label="원본 파일 내려받기"]')) ?? '').includes('DOM 사본'));
        await page.click('.save-menu button[aria-label="원본 파일 내려받기"]');
        const dom = await until(() => (existsSync(domOut) && readFileSync(domOut, 'utf8').includes('</html>') ? readFileSync(domOut, 'utf8') : null), 30000);
        check('DOM 사본 HTML — 스크립트 없음 · 바깥 스타일시트 없음 · 캔버스는 그림으로', !!dom && !/<script/i.test(dom) && !/<link[^>]*stylesheet/i.test(dom) && /style="[^"]*data:image\/jpeg[^"]*"[^>]*data-terr-pixels/.test(dom) && !dom.includes('terr.shot'), dom ? `${Math.round(dom.length / 1024)}KB` : '없음');
        if (dom) {
          const br = await chromium.launch({ executablePath: CHROME });
          const ctx = await br.newContext({ viewport: { width: 1920, height: 1080 }, offline: true });
          const pg = await ctx.newPage();
          const failed: string[] = [];
          pg.on('requestfailed', (r) => failed.push(r.url()));
          await pg.goto(pathToFileURL(domOut).href);
          await wait(800);
          check('DOM 사본 — 오프라인 브라우저에서 리소스 빠짐없이 열린다', failed.length === 0 && (await pg.$$('body *')).length > 50, failed.slice(0, 3).join(' '));
          await br.close();
        }
        await page.click('.sc-bar .seg-btn:has-text("캡처 모음")');
        check('프로그램에서도 캡처 모음', !!(await until(() => page.$('.gallery .gal-item .gal-shot img'), 5000)));
        // 실시간 / 캡처 모음은 탭마다 따로 — 다른 URL 탭은 실시간 그대로, 돌아오면 캡처 모음 그대로
        await page.click('button[aria-label="화면 추가"]');
        await page.click('.popover-item:has-text("URL")');
        await page.fill('.modal input[aria-label="주소"]', SITE);
        await page.click('.modal button[type=submit]');
        check('다른 URL 탭은 실시간', !!(await until(async () => (await page.getAttribute('.tab.is-on', 'data-id')) === 'SCR-002' && !!(await page.$('webview.stage-webview:not(.is-hidden)')) && !(await page.$('.gallery')), 8000)));
        await until(async () => (await page.$eval('webview.stage-webview:not(.is-hidden)', (w) => (w as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript('document.readyState').catch(() => ''))) === 'complete', 30000);
        await page.$eval('webview.stage-webview:not(.is-hidden)', (w) => (w as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript('window.__keep = 7'));
        await page.click('.tab[data-id="SCR-001"] .tab-main');
        check('돌아오면 그 탭은 캡처 모음 그대로', !!(await until(async () => !!(await page.$('.gallery .gal-item')) && !(await page.$('webview.stage-webview:not(.is-hidden)')), 5000)));
        await page.click('.tab[data-id="SCR-002"] .tab-main');
        check('다시 가면 그 탭은 실시간 그대로', !!(await until(async () => !!(await page.$('webview.stage-webview:not(.is-hidden)')) && !(await page.$('.gallery')), 5000)));
        const kept = await page.$eval('webview.stage-webview:not(.is-hidden)', (w) => (w as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript('window.__keep'));
        check('URL 탭을 다녀와도 사이트를 다시 불러오지 않는다 (그 상태 그대로)', kept === 7, String(kept));
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
        await rp.click('button[aria-label="저장 방식"]');
        const dl = rp.waitForEvent('download');
        await rp.click('.save-menu button[aria-label="원본 파일 내려받기"]');
        const got = await dl;
        const rhtml = readFileSync((await got.path())!, 'utf8');
        check('받는 사람도 담아 둔 DOM 사본을 HTML 로 내려받는다', /_DOM\.html$/.test(got.suggestedFilename()) && !/<script/i.test(rhtml) && rhtml.includes('data-terr-pixels'), got.suggestedFilename());
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
      const { app, page, ws, src } = await appWithScreen();
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
        await typeIn(page, '.popover-card .composer .cm-content', '바깥 테스트');
        await page.keyboard.press('Control+Enter');
        const cj = join(ws, 'screens', 'SCR-001', 'comments.json');
        await until(() => comments(ws, 'SCR-001').length === 1, 8000);
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        // 보낼 파일 굽기까지 지나가게 — 그 쓰기를 바깥 변경으로 잘못 알면 안 된다
        await until(() => existsSync(join(ws, 'dist')) && readdirSync(join(ws, 'dist')).some((n) => n.endsWith('.terr.html')), 8000);
        await wait(800);
        const list = JSON.parse(readFileSync(cj, 'utf8'));
        list[0].title = '바깥에서 단 제목';
        writeFileSync(cj, JSON.stringify(list, null, 2));
        check('바깥에서 comments.json 을 고치면 바로 다시 불러온다', !!(await until(async () => ((await page.textContent('.cards > .card:first-child .card-name')) ?? '') === '바깥에서 단 제목', 10000)));
        // 현재 탭만 저장
        const oneOut = join(tempDir('one'), 'one-tab');
        await app.evaluate(({ dialog }, d) => {
          dialog.showSaveDialog = (async () => ({ canceled: false, filePath: d })) as typeof dialog.showSaveDialog;
        }, oneOut);
        const cur = await page.getAttribute('.tab.is-on', 'data-id');
        await page.click('button[aria-label="저장 방식"]');
        await page.click('.save-menu button[aria-label="현재 탭만 저장"]');
        const oneFile = await until(() => (existsSync(oneOut + '.terr.html') ? oneOut + '.terr.html' : null), 8000);
        const oneIds = oneFile ? parseManna(readFileSync(oneFile, 'utf8')).doc.screens.map((x) => x.id) : [];
        check('현재 탭만 저장 — 그 화면 하나만 새 파일로', oneIds.length === 1 && oneIds[0] === cur, `${cur} → ${oneIds.join(',')}`);
      } finally {
        await app.close();
      }
    },
  },
  {
    name: 'app-tab-layout',
    kind: 'app',
    files: [/^packages\/manna\/src\/stage\/ScreenTabs\.tsx$/, new RegExp(`^${B}main/(index|workspace|image)\\.ts$`), new RegExp(`^${B}renderer/src/(session|Welcome|Tools|ImportDialog|UrlDialog)\\.tsx?$`), new RegExp(`^${B}(shared|preload)/`), /^packages\/core\/node\//],
    async run() {
      const { app, page, ws } = await appWithScreen();
      try {
        // ＋ → 파일 (다른 테라리움 문서 + 그림) — 화면이 들어간 보낼 파일이 구워질 때까지
        const dist = await until(() => {
          const n = existsSync(join(ws, 'dist')) ? readdirSync(join(ws, 'dist')).find((x) => x.endsWith('.terr.html')) : undefined;
          return n && parseManna(readFileSync(join(ws, 'dist', n), 'utf8')).doc.screens.length ? join(ws, 'dist', n) : null;
        }, 15000);
        const img = join(tempDir('img'), 'smoke-icon.png');
        cpSync(resolve('docs/icon.png'), img);
        await nextOpen(app, [dist!, img]);
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
        const distFile = dist!;
        const stamp = statSync(distFile).mtimeMs;
        await page.keyboard.press('Control+s');
        await until(() => statSync(distFile).mtimeMs > stamp, 8000);
        const meta = parseManna(readFileSync(distFile, 'utf8')).doc.meta.tabs;
        check('문서에 탭 배치가 들어 있다 (순서 · 숨김)', meta?.open.join(',') === layout.join(',') && meta?.hidden.join(',') === hideId, JSON.stringify(meta));
        const br = await chromium.launch({ executablePath: CHROME });
        const rp = await (await br.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
        await rp.goto(pathToFileURL(distFile).href);
        await rp.fill('.modal input', '받는이').catch(() => {});
        await rp.click('.modal button[type=submit]').catch(() => {});
        const got = await until(async () => {
          const ids = await rp.$$eval('.tabs .tab', (t) => t.map((x) => (x as HTMLElement).dataset.id));
          return ids.length ? ids : null;
        }, 8000);
        check('받는 사람이 처음 열면 작성자의 탭 순서 · 숨김 그대로', got?.join(',') === layout.join(','), `${got?.join(',')} / ${layout.join(',')}`);
        await br.close();
      } finally {
        await app.close();
      }
    },
  },
  {
    name: 'app-reopen',
    kind: 'app',
    files: [/^packages\/manna\/src\/stage\/ScreenTabs\.tsx$/, new RegExp(`^${B}main/(index|workspace|image)\\.ts$`), new RegExp(`^${B}renderer/src/(session|Welcome|Tools|ImportDialog|UrlDialog)\\.tsx?$`), new RegExp(`^${B}(shared|preload)/`), /^packages\/core\/node\//],
    async run() {
      const ctx = await appWithScreen();
      let { app, page } = ctx;
      const { ws, ud, src } = ctx;
      try {
        const dist = await until(() => {
          const n = existsSync(join(ws, 'dist')) ? readdirSync(join(ws, 'dist')).find((x) => x.endsWith('.terr.html')) : undefined;
          return n ? join(ws, 'dist', n) : null;
        }, 10000);
        // 다시 켜면 최근 목록
        await app.close();
        ({ app, page } = await launchApp(ud, [ws, src]));
        const name = ws.split(/[\\/]/).pop()!;
        check('켜면 저절로 열지 않고 최근 목록', !!(await until(() => page.$(`.recent-places .recent-item:has-text("${name}")`), 10000)));
        await page.click(`.recent-places .recent-item:has-text("${name}")`);
        check('최근 목록에서 고르면 열린다', !!(await until(async () => ((await page.textContent('.tb-place').catch(() => '')) ?? '').includes(name), 10000)));
        // 테라리움 문서가 든 폴더 → 풀어서
        const unpack = tempDir('unpack');
        cpSync(dist!, join(unpack, 'got.terr.html'));
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
        const getTitle = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());
        await until(async () => (await getTitle()).startsWith('terr-ws-'), 5000);
        const title = await getTitle();
        check('창 제목 — 열린 곳 이름 — Terrarium', / — Terrarium$/.test(title) && title.startsWith('terr-ws-'), title);
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
  {
    name: 'app-source',
    kind: 'app',
    files: [/^packages\/core\/node\/pack\.ts$/, new RegExp(`^${B}renderer/src/(session|Tools)\\.tsx?$`), new RegExp(`^${B}main/index\\.ts$`)],
    async run() {
      const ctx = await appWithScreen();
      let { app, page } = ctx;
      const { ws, ud, src } = ctx;
      try {
        await until(() => existsSync(join(ws, 'screens', 'SCR-001', 'screen.json')), 8000);
        await wait(1500);
        check('원본 그대로면 표시 없음', !(await page.$('.src-stale')) && !(await page.$('.tab-mark')));
        // 꺼져 있는 동안 원본이 바뀌었다 → 다시 열면 표시. 원본 폴더 권한은 작업 폴더가 준다(따로 허락하지 않는다)
        await app.close();
        writeFileSync(join(src, 'index.html'), readFileSync(join(src, 'index.html'), 'utf8') + '\n<!-- 꺼진 동안 고침 -->\n');
        ({ app, page } = await launchApp(ud, [ws]));
        const name = ws.split(/[\\/]/).pop()!;
        await page.click(`.recent-places .recent-item:has-text("${name}")`);
        check('꺼진 동안 바뀐 원본 — 열 때 버전 줄에 "원본 바뀜"', !!(await until(() => page.$('.src-stale'), 10000)));
        check('탭에도 표시', !!(await page.$('.tab[data-id="SCR-001"] .tab-mark')));
        check('무엇이 바뀌었는지', ((await page.getAttribute('.src-stale', 'title')) ?? '').includes('index.html'));
        check('알림으로도', ((await page.textContent('.toast').catch(() => '')) ?? '').includes('SCR-001'));
        await page.click('.src-stale');
        await page.waitForSelector('.file-list', { timeout: 10000 });
        await page.click('.modal button[type=submit]');
        check('눌러서 새 버전 등록 → v2, 표시가 걷힌다', !!(await until(async () => !(await page.$('.src-stale')) && !(await page.$('.tab-mark')) && existsSync(join(ws, 'screens', 'SCR-001', 'screen.json')) && JSON.parse(readFileSync(join(ws, 'screens', 'SCR-001', 'screen.json'), 'utf8')).versions?.length === 2, 15000)));
        // 켜 둔 채로 원본이 바뀌면 — 알림이 사라져도 표시는 남는다
        await wait(1500);
        writeFileSync(join(src, 'index.html'), readFileSync(join(src, 'index.html'), 'utf8') + '\n<!-- 켜 둔 채 고침 -->\n');
        check('켜 둔 채 바뀐 원본 — 표시', !!(await until(() => page.$('.src-stale'), 10000)));
        // 새 파일을 하나 더해도 — 원본 폴더 안의 새 파일
        writeFileSync(join(src, 'added.js'), 'console.log(1);');
        check('새 파일도 목록에', !!(await until(async () => ((await page.getAttribute('.src-stale', 'title')) ?? '').includes('added.js'), 10000)));
      } finally {
        await app.close();
      }
    },
  },
  {
    name: 'app-projects',
    kind: 'app',
    files: [new RegExp(`^${B}main/(index|menu|terminal)\\.ts$`), new RegExp(`^${B}renderer/src/(session|Tools|main|sync)\\.tsx?$`), new RegExp(`^${B}(shared|preload)/`)],
    async run() {
      const { app, page, ws, src } = await appWithScreen();
      try {
        await until(() => existsSync(join(ws, 'screens', 'SCR-001', 'screen.json')), 8000);
        await page.dblclick('.tab[data-id="SCR-001"] .tab-main');
        await page.fill('.tab-input', '첫 프로젝트 화면');
        await page.keyboard.press('Enter');
        // 열기 = 새 프로젝트 — 프로젝트가 열린 창에서 폴더를 열면 새 창, 지금 것은 그대로
        const wsB = tempDir('wsB');
        await page.click('.tb-place');
        check('열기 메뉴에 "새 프로젝트 — 새 창에서 열기"', !!(await page.$('.popover-label:has-text("새 창에서 열기")')));
        await nextOpen(app, wsB);
        const nwP = app.waitForEvent('window');
        await page.click('.popover-item:has-text("폴더 열기")');
        const pb = await nwP;
        await pb.waitForSelector('.tb-place', { timeout: 15000 });
        check('새 창에서 새 프로젝트가 열린다', !!(await until(() => existsSync(join(wsB, 'terrarium.json')), 10000)) && ((await pb.textContent('.tb-place')) ?? '').includes(wsB.split(/[\\/]/).pop()!));
        check('원래 창의 프로젝트는 그대로', ((await page.textContent('.tb-place')) ?? '').includes(ws.split(/[\\/]/).pop()!) && !!(await page.$('.tab[data-id="SCR-001"]')));
        const titles = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getTitle()));
        check('창 제목으로 두 프로젝트가 구분된다', new Set(titles).size === 2, titles.join(' | '));
        // ＋ = 이 프로젝트에 추가 — 새 창의 프로젝트에만 들어간다
        await nextOpen(app, src);
        await pb.click('.welcome button:has-text("화면 폴더 추가")');
        await pb.waitForSelector('.file-list');
        await pb.click('.modal button[type=submit]');
        check('추가는 그 창의 프로젝트에만', !!(await until(() => existsSync(join(wsB, 'screens', 'SCR-001', 'screen.json')), 10000)) && readdirSync(join(ws, 'screens')).length === 1);
        await pb.click('button[aria-label="화면 추가"]');
        check('＋ 메뉴에 "이 프로젝트에 탭으로 추가"', !!(await pb.$('.popover-label:has-text("이 프로젝트에 탭으로 추가")')));
        await pb.keyboard.press('Escape');
        await wait(1500);
        check('창마다 따로 저장 — 원래 프로젝트의 화면 이름 그대로', JSON.parse(readFileSync(join(ws, 'screens', 'SCR-001', 'screen.json'), 'utf8')).title === '첫 프로젝트 화면' && JSON.parse(readFileSync(join(wsB, 'screens', 'SCR-001', 'screen.json'), 'utf8')).title !== '첫 프로젝트 화면');
        // 이미 열린 곳을 다시 열면 새 창 대신 그 창으로
        await pb.click('.tb-place');
        const before = app.windows().length;
        await pb.click(`.popover-recent:has-text("${ws.split(/[\\/]/).pop()}")`);
        await wait(1500);
        check('이미 다른 창에 열린 프로젝트 — 새 창을 만들지 않는다', app.windows().length === before);
        // 복제 보기는 그 창의 프로젝트에서 — 다른 프로젝트 창이 대답하지 않는다
        await page.click('.tab[data-id="SCR-001"] .tab-main', { button: 'right' });
        const dupP = app.waitForEvent('window');
        await page.click('.popover-item:has-text("복제 보기")');
        const dup = await dupP;
        await dup.waitForSelector('.tab[data-id="SCR-001"]', { timeout: 10000 });
        check('복제 보기는 자기 프로젝트의 화면', ((await dup.textContent('.tab[data-id="SCR-001"]')) ?? '').includes('첫 프로젝트 화면'));
        await dup.close();
        await pb.close();
        check('새 창을 닫아도 원래 창은 그대로', !page.isClosed() && !!(await page.$('.tab[data-id="SCR-001"]')));
      } finally {
        await app.close();
      }
    },
  },
  {
    name: 'app-record',
    kind: 'app',
    files: [/^packages\/manna\/src\/stage\/(Trace|Stage|record)\.tsx?$/, /^packages\/manna\/src\/agent\//, /^packages\/manna\/src\/ui\/Popover\.tsx$/, /^packages\/manna\/src\/actions\.ts$/],
    async run() {
      const { app, page, ws } = await appWithScreen();
      try {
        await ctrlPick(page, await stagePoint(page, 960, 300));
        await page.waitForSelector('.popover-card .composer');
        await page.fill('.popover-card .composer .title-input', '재현 영상');
        await page.click('.popover-card .rec-full');
        check('화면 녹화 — 팝업이 접히고 녹화 막대가 뜬다', !!(await until(() => page.$('.rec-bar'), 8000)) && !!(await page.$('.popover-card.is-rec-hidden')));
        check('녹화 중에는 멈춤 그림 · 피커가 걷혀 화면을 만질 수 있다', !(await page.$('.stage-still')) && !(await page.$('.pick-layer')));
        // 화면을 조작한다 — 움직이고, 누르고, 친다
        const a = await stagePoint(page, 500, 500);
        const b = await stagePoint(page, 900, 400);
        await page.mouse.move(a.x, a.y);
        await page.mouse.move(b.x, b.y, { steps: 8 });
        await page.mouse.down();
        check('누르면 그 자리에 클릭 표시', !!(await until(() => page.$('.trace-ripple'), 3000)));
        await page.mouse.up();
        const cur = await page.$eval('.trace-cursor', (el) => ({ hidden: (el as HTMLElement).hidden, t: (el as HTMLElement).style.transform }));
        const fb = (await (await page.$('.stage-frame'))!.boundingBox())!;
        const m = /translate\(([\d.]+)px, ([\d.]+)px\)/.exec(cur.t);
        check('커서가 누른 자리를 따라간다', !cur.hidden && !!m && Math.abs(fb.x + Number(m[1]) - b.x) < 6 && Math.abs(fb.y + Number(m[2]) - b.y) < 6, cur.t);
        await page.keyboard.type('abc');
        await page.keyboard.press('Enter');
        const chips = await until(async () => {
          const t = await page.$$eval('.trace-key', (els) => els.map((e) => e.textContent));
          return t.includes('abc') && t.includes('Enter') ? t : null;
        }, 3000);
        check('친 글자와 특수 키가 화면에 보인다', !!chips, (chips ?? []).join(' · '));
        check('녹화 중 화면 안의 키는 테라리움 단축키로 받지 않는다 (Enter 로 팝업이 바뀌지 않음)', !!(await page.$('.popover-card .composer')));
        await wait(1200);
        await page.click('.rec-bar .rec-stop');
        const v = await until(() => page.$('.popover-card:not(.is-rec-hidden) .composer .clip video'), 10000);
        check('멈추면 팝업이 돌아오고 녹화가 붙어 있다', !!v);
        check('쓰던 제목은 그대로', (await page.inputValue('.popover-card .composer .title-input')) === '재현 영상');
        await page.click('.popover-card .composer button:has-text("추가")');
        const c = await until(() => comments(ws, 'SCR-001').find((x: { title?: string }) => x.title === '재현 영상'), 8000);
        check('Comment 와 함께 녹화가 저장된다', !!c && c.clips?.length === 1 && c.clips[0].ms > 1000, c ? `${c.clips?.[0]?.ms}ms ${c.clips?.[0]?.w}×${c.clips?.[0]?.h}` : '없음');
        check('표시 층은 녹화가 끝나면 사라진다', !(await page.$('.trace-layer')) && !(await page.$('.rec-bar')));
      } finally {
        await app.close();
      }
    },
  },
  {
    name: 'app-links',
    kind: 'app',
    files: [/^packages\/manna\/src\/(links\.ts|stage\/Links\.tsx|stage\/StageHeader\.tsx)$/, /^packages\/core\/src\/(merge|types)\.ts$/, /^packages\/manna\/src\/ui\/Popover\.tsx$/],
    async run() {
      const { app, page, ws, src } = await appWithScreen();
      const conns = () => (JSON.parse(readFileSync(join(ws, 'terrarium.json'), 'utf8')).doc.connections ?? []) as { a: { kind: string; screen: string }; b: { kind: string; screen: string } }[];
      const addComment = async (text: string, x: number, y: number) => {
        await ctrlPick(page, await stagePoint(page, x, y));
        await typeIn(page, '.popover-card .composer .cm-content', text);
        await page.keyboard.press('Control+Enter');
        await until(async () => ((await page.textContent('.cards')) ?? '').includes(text), 8000);
        await page.keyboard.press('Escape');
      };
      try {
        await page.click('button[aria-label="화면 추가"]');
        await nextOpen(app, src);
        await page.click('.popover-item:has-text("화면 폴더 선택")');
        await page.waitForSelector('.file-list');
        await page.click('.modal button[type=submit]');
        await until(() => page.$('.tab[data-id="SCR-002"].is-on'), 10000);
        await splashDone(await screenFrame(page));
        await addComment('제품 쪽 화면', 960, 300);
        await page.click('.tab[data-id="SCR-001"] .tab-main');
        await splashDone(await screenFrame(page));
        await addComment('기획안 쪽 화면', 960, 300);
        // 기획안 Comment 에서 "잇기" → 다른 탭의 Comment 를 누른다
        await page.click('.cards > .card:has-text("기획안 쪽 화면")');
        await page.click('.popover-card .link-add');
        check('잇기 — 무엇을 고르면 되는지 안내 막대', !!(await until(() => page.$('.link-bar'), 3000)));
        await page.click('.tab[data-id="SCR-002"] .tab-main');
        await page.click('.cards > .card:has-text("제품 쪽 화면")');
        const c1 = await until(() => conns().find((c) => c.a.kind === 'comment' && c.b.kind === 'comment'), 8000);
        check('다른 탭의 Comment 를 누르면 이어진다 (문서에 저장)', !!c1 && c1.a.screen === 'SCR-001' && c1.b.screen === 'SCR-002' && !(await page.$('.link-bar')));
        const chip = await until(() => page.$('.popover-card .comment-links .link-go'), 5000);
        check('반대쪽 Comment 에도 탭-번호 이름표', ((await chip?.textContent()) ?? '').includes('SCR-001 #1'), (await chip?.textContent()) ?? '');
        await chip!.click();
        check('이름표를 누르면 그 탭 · 그 Comment 로', !!(await until(async () => !!(await page.$('.tab[data-id="SCR-001"].is-on')) && ((await page.textContent('.popover-card').catch(() => '')) ?? '').includes('기획안 쪽 화면'), 8000)));
        check('다른 탭이 다 뜬 뒤 그 Comment 의 대상에 선택 박스', !!(await until(() => page.$eval('.hl-sel', (el) => (el as HTMLElement).style.display === 'block'), 8000)));
        check('왔던 곳으로 돌아가기', ((await page.textContent('.link-back').catch(() => '')) ?? '').includes('SCR-002'));
        await page.click('.link-back');
        check('돌아가기 — 원래 탭 · Comment', !!(await until(async () => !!(await page.$('.tab[data-id="SCR-002"].is-on')) && ((await page.textContent('.popover-card').catch(() => '')) ?? '').includes('제품 쪽 화면'), 8000)));
        await page.keyboard.press('Escape');
        // Comment 없이 — 영역끼리 (탭과 상관없이)
        await page.click('button[aria-label="연결"]');
        await page.click('.link-menu .popover-item:has-text("영역을 그려서 잇기")');
        const drag = async (x0: number, y0: number, x1: number, y1: number) => {
          const a = await stagePoint(page, x0, y0);
          const b = await stagePoint(page, x1, y1);
          await page.mouse.move(a.x, a.y);
          await page.mouse.down();
          await page.mouse.move(b.x, b.y, { steps: 6 });
          await page.mouse.up();
        };
        await page.waitForSelector('.area-place');
        await drag(200, 200, 600, 420);
        check('영역을 그리면 거기서 잇기 시작', !!(await until(() => page.$('.link-bar'), 3000)));
        // 목록에서 — 펼친 채로 검색칸으로 거른다 (엑셀 필터처럼)
        await page.click('.link-bar button:has-text("목록에서")');
        check('목록 — 검색칸에 바로 쓸 수 있다', !!(await until(() => page.$('.link-list .link-search:focus'), 3000)));
        const allAnn = (await page.$$('.link-list .link-list-ann')).length;
        await page.keyboard.type('기획안');
        const shown = await page.$$eval('.link-list .link-list-ann', (els) => els.map((e) => e.textContent ?? ''));
        check('검색어가 든 Comment 만 남는다', allAnn === 2 && shown.length === 1 && shown[0]!.includes('기획안'), `${allAnn} → ${shown.length}`);
        await page.keyboard.press('Escape');
        check('Esc 는 먼저 검색어를 지운다 (잇기는 그대로)', (await page.inputValue('.link-list .link-search')) === '' && !!(await page.$('.link-bar')) && (await page.$$('.link-list .link-list-ann')).length === 2);
        await page.click('.link-bar button:has-text("목록에서")');
        await page.click('.tab[data-id="SCR-001"] .tab-main');
        await page.click('.link-bar button:has-text("영역 그리기")');
        await page.waitForSelector('.area-place');
        await drag(1200, 600, 1500, 800);
        const c2 = await until(() => conns().find((c) => c.a.kind === 'area' && c.b.kind === 'area'), 8000);
        check('Comment 없이 영역 ↔ 영역 연결', !!c2 && c2.a.screen === 'SCR-002' && c2.b.screen === 'SCR-001');
        const tag = await until(() => page.$('.link-area .link-go:has-text("SCR-002")'), 5000);
        check('영역에 반대쪽 이름표가 붙는다', !!tag);
        await tag!.click();
        check('영역 이름표를 누르면 그 탭으로 가서 그 영역이 반짝인다', !!(await until(async () => !!(await page.$('.tab[data-id="SCR-002"].is-on')) && !!(await page.$('.link-area.is-flash')), 5000)));
        check('화면 막대의 연결 수', ((await page.textContent('.link-count')) ?? '') === '2');
        // 화면의 연결 영역 — 숨기기 / 보이기 (숨겨도 연결은 그대로, 따라온 영역은 잠깐 보인다)
        await wait(2500);
        await page.click('button[aria-label="연결"]');
        await page.click('.link-menu [role=menuitemcheckbox]');
        check('끄면 화면의 연결 영역이 숨는다', !!(await until(async () => (await page.$$('.link-area')).length === 0, 3000)));
        await page.click('.link-menu .link-row:has-text("SCR-001 영역")');
        check('숨겨도 연결을 따라온 영역은 반짝이는 동안 보인다', !!(await until(async () => !!(await page.$('.tab[data-id="SCR-001"].is-on')) && !!(await page.$('.link-area.is-flash')), 5000)));
        check('반짝임이 끝나면 다시 숨는다', !!(await until(async () => (await page.$$('.link-area')).length === 0, 5000)));
        await page.click('button[aria-label="연결"]');
        await page.click('.link-menu [role=menuitemcheckbox]');
        await page.keyboard.press('Escape');
        check('켜면 다시 보인다', !!(await until(() => page.$('.link-area'), 3000)));
        await page.click('.tab[data-id="SCR-002"] .tab-main');
        // 받는 사람 — 보낸 파일에서도 따라간다
        await page.keyboard.press('Control+s');
        await wait(2500);
        const dist = join(ws, 'dist', readdirSync(join(ws, 'dist')).find((n) => n.endsWith('.terr.html'))!);
        const br = await chromium.launch({ executablePath: CHROME });
        const rp = await (await br.newContext({ viewport: { width: 1600, height: 960 } })).newPage();
        await rp.goto(pathToFileURL(dist).href);
        await rp.fill('.modal input', '수신자');
        await rp.click('.modal button[type=submit]');
        await rp.click('.tab[data-id="SCR-001"] .tab-main');
        const rtag = await until(() => rp.$('.link-area .link-go'), 10000);
        await rtag?.click();
        check('받는 사람도 영역 이름표로 다른 탭에 간다', !!(await until(() => rp.$('.tab[data-id="SCR-002"].is-on'), 5000)));
        await br.close();
        // Comment 를 지우면 그 연결도 걷힌다
        await page.click('.tab[data-id="SCR-002"] .tab-main');
        await page.click('.cards > .card:has-text("제품 쪽 화면")');
        page.once('dialog', (dg) => dg.accept());
        await page.keyboard.press('Escape');
        await page.click('.cards > .card:has-text("제품 쪽 화면")');
        await page.keyboard.press('Delete');
        check('Comment 를 지우면 그 연결도 함께 걷힌다', !!(await until(() => conns().length === 1 && conns()[0]!.a.kind === 'area', 8000)), JSON.stringify(conns().map((c) => c.a.kind)));
      } finally {
        await app.close();
      }
    },
  },
  {
    name: 'app-tabs-alive',
    kind: 'app',
    files: [/^packages\/manna\/src\/stage\/(Stage|bridge|loader)\.tsx?$/, /^packages\/manna\/src\/agent\//, /^packages\/manna\/src\/stage\/Links\.tsx$/],
    async run() {
      const { app, page, src } = await appWithScreen();
      try {
        await ctrlPick(page, await stagePoint(page, 960, 300));
        await typeIn(page, '.popover-card .composer .cm-content', '첫 탭 Comment');
        await page.keyboard.press('Control+Enter');
        await page.keyboard.press('Escape');
        const f1 = await screenFrame(page);
        // 화면 안에서 상태를 바꿔 둔다 — 다시 불러오면 사라진다
        await f1.evaluate(() => {
          (window as unknown as { __keep: number }).__keep = 42;
          document.body.dataset.keep = 'yes';
        });
        await page.click('button[aria-label="화면 추가"]');
        await nextOpen(app, src);
        await page.click('.popover-item:has-text("화면 폴더 선택")');
        await page.waitForSelector('.file-list');
        await page.click('.modal button[type=submit]');
        await until(() => page.$('.tab[data-id="SCR-002"].is-on'), 10000);
        await splashDone(await screenFrame(page));
        check('두 탭의 틀이 함께 떠 있다 (지금 탭만 보인다)', (await page.$$('.stage-frame iframe.stage-iframe')).length === 2 && (await page.$$('.stage-frame iframe.stage-iframe.is-hidden')).length === 1);
        await page.click('.tab[data-id="SCR-001"] .tab-main');
        await wait(300);
        check('돌아오면 불러오는 표시 없이 바로', !(await page.$('.stage-note')));
        const f1b = await screenFrame(page);
        const kept = await f1b.evaluate(() => [(window as unknown as { __keep?: number }).__keep, document.body.dataset.keep]);
        check('탭을 바꿔도 화면을 다시 불러오지 않는다 (상태 그대로)', kept[0] === 42 && kept[1] === 'yes', JSON.stringify(kept));
        check('돌아온 탭의 Comment 마커가 그대로', !!(await until(async () => (await visibleMarkers(page)).length === 1, 5000)));
        // 숨은 탭은 멈춰 둔다 — 시계가 서 있다가 돌아오면 다시 간다
        const t0 = await f1b.evaluate(() => performance.now());
        await page.click('.tab[data-id="SCR-002"] .tab-main');
        await wait(1500);
        await page.click('.tab[data-id="SCR-001"] .tab-main');
        const t1 = await f1b.evaluate(() => performance.now());
        check('숨어 있는 동안은 멈춰 둔다', t1 - t0 < 1200, `${Math.round(t1 - t0)}ms`);
        await wait(600);
        const t2 = await f1b.evaluate(() => performance.now());
        check('돌아오면 다시 돈다', t2 - t1 > 300, `${Math.round(t2 - t1)}ms`);
        // 피커로 고르기도 바로 — 다시 불러오느라 못 고르는 일이 없다
        await ctrlPick(page, await stagePoint(page, 700, 500));
        check('돌아온 탭에서 바로 고를 수 있다', !!(await until(() => page.$('.popover-card .composer'), 5000)));
        await page.keyboard.press('Escape');
        // 새로 고침은 그 탭만 처음부터
        await page.click('button[aria-label="새로 고침"]');
        const f1c = await screenFrame(page);
        await splashDone(f1c);
        check('새로 고침하면 그 탭만 처음부터', (await f1c.evaluate(() => (window as unknown as { __keep?: number }).__keep)) === undefined);
      } finally {
        await app.close();
      }
    },
  },
  {
    name: 'app-pointerlock',
    kind: 'app',
    files: [/^packages\/manna\/src\/agent\//],
    async run() {
      const { app, page } = await appWithScreen();
      // 클릭하면 마우스를 잠그는 화면 (Unity 같은 게임 엔진이 하는 것처럼)
      const game = tempDir('game');
      writeFileSync(join(game, 'index.html'), `<!doctype html><html><head><title>게임</title></head><body style="margin:0">
<canvas id="c" width="1920" height="1080" style="display:block;width:100vw;height:100vh;background:#234"></canvas>
<script>
window.__req = 0; window.__err = 0;
c.addEventListener('pointerdown', () => {
  window.__req++;
  try { const r = c.requestPointerLock(); if (r && r.catch) r.catch(() => window.__err++); } catch (e) { window.__err++; }
});
</script></body></html>`);
      try {
        await page.click('button[aria-label="화면 추가"]');
        await nextOpen(app, game);
        await page.click('.popover-item:has-text("화면 폴더 선택")');
        await page.waitForSelector('.file-list');
        await page.click('.modal button[type=submit]');
        await until(() => page.$('.tab[data-id="SCR-002"].is-on'), 10000);
        const f = await screenFrame(page);
        const locked = () => f.evaluate(() => !!document.pointerLockElement);
        const at = await stagePoint(page, 960, 540);
        // 화면이 클릭마다 마우스를 잠그려 해도 — 잠기지 않고, 오류도 받지 않는다 (오류 창 없음)
        for (let i = 0; i < 5; i++) await page.mouse.click(at.x, at.y);
        await wait(300);
        const n = await f.evaluate(() => [(window as unknown as { __req: number }).__req, (window as unknown as { __err: number }).__err]);
        check('품은 화면은 마우스를 잠그지 못한다 — 커서는 늘 보인다', !(await locked()) && n[0]! >= 5, JSON.stringify(n));
        check('잠금 요청에 오류가 가지 않는다 (화면이 오류 창을 띄우지 않게)', n[1] === 0);
        // 잠그려던 화면 다음에도 탭 · 고르기가 그대로
        await page.click('.tab[data-id="SCR-001"] .tab-main');
        check('잠그려던 화면 다음에도 탭을 누를 수 있다', !!(await until(() => page.$('.tab[data-id="SCR-001"].is-on'), 3000)));
        await page.click('.tab[data-id="SCR-002"] .tab-main');
        await ctrlPick(page, at);
        check('잠그려던 화면에서도 Ctrl 로 고를 수 있다', !!(await until(() => page.$('.popover-card .composer'), 5000)));
      } finally {
        await app.close();
      }
    },
  },
  {
    name: 'app-versions',
    kind: 'app',
    files: [new RegExp(`^${B}renderer/src/(session|ImportDialog)\\.tsx?$`), /^packages\/manna\/src\/ui\/Panel\.tsx$/, /^packages\/manna\/src\/stage\/StageHeader\.tsx$/, /^packages\/manna\/src\/actions\.ts$/],
    async run() {
      const { app, page, ws, src } = await appWithScreen();
      const vers = () => (comments(ws, 'SCR-001') as { version: number; body: string }[]).map((c) => c.version);
      const add = async (text: string, x: number, y: number) => {
        await ctrlPick(page, await stagePoint(page, x, y));
        await typeIn(page, '.popover-card .composer .cm-content', text);
        await page.keyboard.press('Control+Enter');
        await until(async () => ((await page.textContent('.cards')) ?? '').includes(text), 8000);
        await page.keyboard.press('Escape');
      };
      const touch = (tag: string) => writeFileSync(join(src, 'index.html'), readFileSync(join(src, 'index.html'), 'utf8') + `\n<!-- ${tag} -->\n`);
      const register = async (move = true) => {
        await page.click('.src-stale');
        await page.waitForSelector('.file-list');
        const box = await page.$('.modal label.row:has-text("새 버전으로 옮기기") input');
        if (box && (await box.isChecked()) !== move) await box.click();
        await page.click('.modal button[type=submit]');
        await until(async () => !(await page.$('.modal')), 15000);
      };
      try {
        await until(() => existsSync(join(ws, 'screens', 'SCR-001', 'screen.json')), 8000);
        await add('v1 에서 단 것', 960, 300);
        await wait(1500);
        touch('v2');
        await until(() => page.$('.src-stale'), 15000);
        await register();
        check('새 버전 — Comment 가 따라온다', !!(await until(() => vers().join() === '2', 8000)), vers().join());
        // 예전 버전을 보며 단 Comment (사용자가 겪은 경우)
        await page.click('.ver-chip[data-v="1"]');
        check('예전 버전을 보고 있으면 알린다', ((await page.textContent('.ver-old').catch(() => '')) ?? '').includes('최신 v2'));
        await splashDone(await screenFrame(page));
        await add('예전 v1 을 보며 단 것', 700, 600);
        check('다른 버전의 Comment 를 알린다 (지금 v1 · v2 에 1개)', ((await page.textContent('.other-versions').catch(() => '')) ?? '').includes('v2 1'));
        await page.click('.ver-old');
        check('버전 칩에 Comment 수', ((await page.textContent('.ver-chip[data-v="1"] .ver-count').catch(() => '')) ?? '') === '1');
        await wait(1500);
        touch('v3');
        await until(() => page.$('.src-stale'), 15000);
        await page.click('.src-stale');
        await page.waitForSelector('.file-list');
        check('등록 창 — 이전 모든 버전의 Comment 수', ((await page.textContent('.modal label.row:has-text("새 버전으로 옮기기")')) ?? '').includes('2개'));
        await page.click('.modal button[type=submit]');
        await until(async () => !(await page.$('.modal')), 15000);
        check('새 버전 — 예전 버전에 단 Comment 까지 모두 따라온다', !!(await until(() => vers().join() === '3,3', 8000)), vers().join());
        check('새 버전에서 Comment 가 다 보인다', (await page.$$('.cards > .card')).length === 2);
        // 옮기지 않고 올렸거나 바깥에서 버전이 늘었으면 — 알림 줄에서 한 번에 되살린다
        await wait(1500);
        touch('v4');
        await until(() => page.$('.src-stale'), 15000);
        await register(false);
        await until(async () => ((await page.textContent('.ver-chip[aria-checked="true"]')) ?? '').startsWith('v4'), 8000);
        check('남겨진 Comment 를 알린다', ((await page.textContent('.other-versions').catch(() => '')) ?? '').includes('v3 2'));
        await page.click('.other-versions button:has-text("모두 옮기기")');
        check('한 번에 지금 버전으로', !!(await until(() => vers().join() === '4,4', 8000)) && (await page.$$('.cards > .card')).length === 2 && !(await page.$('.other-versions')));
      } finally {
        await app.close();
      }
    },
  },
];

// 쓰지 않는 도구를 가져오지 않았다고 타입 검사가 투덜대지 않게
void openScreen;
void screenFrame;
