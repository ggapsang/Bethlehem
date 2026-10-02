/* Manna E2E — 구운 문서(out/e2e/proto.terr.html)를 설치된 Chrome 에서 file:// 로 열어 확인한다.
 *
 *   npm run test:e2e
 */
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Frame, type Page } from 'playwright-core';

const OUT = resolve('out/e2e');
const DOC = resolve(OUT, 'proto.terr.html');
const SAVED = resolve(OUT, 'proto.saved.terr.html');
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

async function screenFrame(page: Page): Promise<Frame> {
  for (let i = 0; i < 150; i++) {
    const h = await page.$('iframe.stage-iframe');
    const f = h && (await h.contentFrame());
    if (f && (await f.evaluate(() => !!(window as unknown as { __manna?: unknown }).__manna).catch(() => false))) return f;
    await page.waitForTimeout(100);
  }
  throw new Error('품은 화면이 뜨지 않았습니다');
}

const splashDone = (f: Frame) =>
  f.waitForFunction(() => document.querySelector('#splash')?.classList.contains('done'), null, { timeout: 30000 }).then(() => true, () => false);

/** iframe 안 요소의 페이지 좌표 (스테이지 축소 반영) */
async function pagePoint(page: Page, f: Frame, sel: string, fx = 0.5, fy = 0.5) {
  const box = (await (await page.$('iframe.stage-iframe'))!.boundingBox())!;
  const r = await f.evaluate((s) => {
    const b = document.querySelector(s)!.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }, sel);
  const scale = box.width / 1920;
  return { x: box.x + (r.x + r.w * fx) * scale, y: box.y + (r.y + r.h * fy) * scale };
}

const visibleMarkers = (page: Page) => page.$$eval('.marker', (ms) => ms.filter((m) => (m as HTMLElement).style.display === 'flex').map((m) => m.textContent));
const cardCount = (page: Page) => page.$$eval('.cards > .card', (cs) => cs.length);

/** 피커 — Ctrl 을 누른 채 클릭 */
async function ctrlClick(page: Page, p: { x: number; y: number }) {
  await page.mouse.move(p.x, p.y);
  await page.keyboard.down('Control');
  await page.waitForTimeout(80);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.up('Control');
}

async function typeComposer(page: Page, text: string) {
  await page.waitForSelector('.composer .cm-content');
  await page.click('.composer .cm-content');
  await page.keyboard.type(text);
}

async function main() {
  if (!CHROME) throw new Error('Chrome 또는 Edge 를 찾지 못했습니다. CHROME_PATH 로 지정해 주세요.');
  if (!existsSync(DOC)) throw new Error(`${DOC} 가 없습니다. npm run test:e2e 로 실행해 주세요.`);
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 960 }, acceptDownloads: true });
  await ctx.addInitScript(() => {
    // 저장은 다운로드 흐름으로, 화면 공유는 움직이는 캔버스 스트림으로 바꿔 끼운다 (자동 테스트에서 대화상자를 띄울 수 없다)
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined });
    if (window.top !== window) return;
    navigator.mediaDevices.getDisplayMedia = async () => {
      const c = document.createElement('canvas');
      c.width = innerWidth;
      c.height = innerHeight;
      const g = c.getContext('2d')!;
      let t = 0;
      setInterval(() => {
        t++;
        g.fillStyle = `hsl(${(t * 7) % 360} 70% 50%)`;
        g.fillRect(0, 0, c.width, c.height);
      }, 33);
      return c.captureStream(30);
    };
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  console.log('\n[1] 문서 열기');
  const t0 = Date.now();
  await page.goto(pathToFileURL(DOC).href);
  await page.waitForSelector('.modal input');
  await page.fill('.modal input', '검증봇');
  await page.click('.modal button[type=submit]');
  let f = await screenFrame(page);
  check('품은 화면의 데이터 로딩이 끝난다', await splashDone(f), `${Date.now() - t0}ms`);
  const loaded = await f.$$eval('.loadrow.ok', (rows) => rows.length);
  check('data/*.js 6개를 모두 불러온다', loaded === 6, `${loaded}개`);
  check('찾지 못한 파일이 없다', (await f.evaluate(() => (window as unknown as { __manna: { misses: unknown[] } }).__manna.misses.length)) === 0);
  check('Pretendard 가 문서 안의 파일로 적용된다', await f.evaluate(() => document.fonts.check('16px "Pretendard Variable"')));
  check('개요에 README 가 마크다운으로 보인다', ((await page.textContent('.notes .cm-content')) ?? '').includes('데이터 매핑'));
  check('개요의 # 기호는 숨고 제목 서식만 보인다', !!(await page.$('.notes .cm-h1')) && !((await page.textContent('.notes .cm-h1')) ?? '').startsWith('#'));
  await page.click('.notes .section-head'); // 개요 접기 — Comment 를 위로
  await page.screenshot({ path: resolve(OUT, '1-open.png') });

  console.log('\n[2] Ctrl 피커 · 마크다운 Comment');
  let p = await pagePoint(page, f, '#tabB');
  await page.mouse.move(p.x, p.y);
  await page.keyboard.down('Control');
  await page.waitForTimeout(100);
  check('Ctrl 을 누르면 피커가 된다', !!(await page.$('.pick-layer')) && !!(await page.$('.stage-badge-pick')));
  await page.mouse.click(p.x, p.y);
  await page.keyboard.up('Control');
  await page.waitForTimeout(100);
  check('Ctrl 을 떼면 피커가 꺼지고 작성 창은 남는다', !(await page.$('.pick-layer')) && !!(await page.$('.composer')));
  await typeComposer(page, '## 탭 이름\n- [ ] 띄어쓰기 "설비 정보"');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(300);
  check('Comment 가 생긴다', (await cardCount(page)) === 1);
  check('목록 이어 쓰기와 체크박스가 렌더링된다', !!(await page.$('.card .cm-task')));
  // 캔버스 위 영역 — Ctrl 누른 채 드래그
  const a = await pagePoint(page, f, '#fabCv', 0.3, 0.3);
  const b = await pagePoint(page, f, '#fabCv', 0.45, 0.5);
  await page.mouse.move(a.x, a.y);
  await page.keyboard.down('Control');
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.keyboard.up('Control'); // 끄는 중에 떼도 영역은 잡힌다
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForSelector('.composer');
  const regionLabel = (await page.textContent('.composer .mono')) ?? '';
  check('드래그는 캔버스 안의 영역으로 잡힌다', regionLabel === 'canvas#fabCv 안의 영역', regionLabel);
  check('작성 창이 대상 옆 팝업으로 뜬다', !!(await page.$('.popover-card .composer')) && !(await page.$('.panel .composer')));
  await typeComposer(page, 'BAY-4 구역 — **경고 색** 대비가 약함');
  await page.click('.composer .btn-primary');
  await page.waitForTimeout(400);
  check('Comment 2개 · 마커 2개', (await cardCount(page)) === 2 && (await visibleMarkers(page)).length === 2, JSON.stringify(await visibleMarkers(page)));
  check('유형·상태·담당 입력이 없다', !(await page.$('.detail select')) && !(await page.$('.detail input:not([type=checkbox])')));
  await page.screenshot({ path: resolve(OUT, '2-comments.png') });

  console.log('\n[3] 마커 색');
  const tones = await page.$$eval('.marker', (ms) => ms.map((m) => (m as HTMLElement).dataset.tone));
  check('자동 — 배경 밝기에 따라 마커 톤을 고른다', tones.every((t) => t === 'ondark' || t === 'onlight'), tones.join(','));
  await page.click('button[aria-label="마커 색"]');
  await page.click('.popover-item:has-text("빨강")');
  check('마커 색을 바꿀 수 있다', (await page.getAttribute('.marker-layer', 'data-color')) === 'red');

  console.log('\n[4] 되돌리기');
  await page.click('.toolbar .tb-title');
  await page.mouse.click(5, 300); // 입력창 밖으로 포커스
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  check('Ctrl+Z — 마커 색이 돌아간다', (await page.getAttribute('.marker-layer', 'data-color')) === 'auto');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  check('Ctrl+Z — 마지막 Comment 가 사라진다', (await cardCount(page)) === 1);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(300);
  check('Ctrl+Shift+Z — 다시 생긴다', (await cardCount(page)) === 2);

  console.log('\n[5] 순서 바꾸기');
  const grips = await page.$$('.cards > .card .grip');
  const g2 = (await grips[1].boundingBox())!;
  const g1 = (await grips[0].boundingBox())!;
  await page.mouse.move(g2.x + g2.width / 2, g2.y + g2.height / 2);
  await page.mouse.down();
  await page.mouse.move(g1.x + g1.width / 2, g1.y + 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const firstPreview = (await page.textContent('.cards > .card:first-child')) ?? '';
  check('끌어서 순서를 바꾼다', firstPreview.includes('BAY-4'), firstPreview.slice(0, 40));
  const firstNo = await page.textContent('.cards > .card:first-child .no');
  check('번호가 순서를 따른다', firstNo === '1');

  console.log('\n[6] 체크박스');
  await page.click('.cards > .card:nth-child(2) .card-title');
  await page.waitForSelector('.popover-card .detail .cm-task');
  await page.click('.popover-card .detail .cm-task');
  await page.waitForTimeout(200);
  check('팝업의 체크박스를 누르면 [x] 로 바뀐다', await page.$eval('.popover-card .detail .cm-task', (el) => (el as HTMLInputElement).checked));
  check('패널 카드에도 반영된다', await page.$eval('.cards > .card:nth-child(2) .card-body .cm-task', (el) => (el as HTMLInputElement).checked));

  console.log('\n[7] 다른 화면 상태로 이동');
  await f.click('#tabB');
  await page.waitForTimeout(600);
  check('설비정보 탭에서는 FAB 캔버스 마커가 숨는다', (await visibleMarkers(page)).length === 1);
  check('숨은 Comment 에 "다른 상태" 표시', !!(await page.$('.card .chip-hint')));
  // 설비정보 탭 안의 캔버스에 하나 더 단다 — 경로에 #tabB 클릭이 남는다
  await ctrlClick(page, await pagePoint(page, f, '#eqFleetRadar'));
  await typeComposer(page, '설비정보 탭에서 단 Comment');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(300);
  await f.click('#tabC');
  await page.waitForTimeout(600);
  check('FAB 로 가면 설비정보 탭의 Comment 가 숨는다', !(await visibleMarkers(page)).includes('3'));
  // 수신자가 숨은 Comment 를 누른다 — 경로의 탭을 눌러 그 상태로 간다 (빠른 길)
  await page.click('.cards > .card:nth-child(3) .card-title');
  await page.waitForFunction(() => !document.querySelector('.stage-note'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(700);
  const inB = await f.evaluate(() => !document.querySelector('#viewB')?.hasAttribute('hidden'));
  check('탭 안의 Comment 를 누르면 그 탭으로 전환된다', inB && (await visibleMarkers(page)).includes('3'), JSON.stringify(await visibleMarkers(page)));
  // 캔버스 Comment(경로 없음)를 누른다 — 처음부터 다시 불러와 FAB 로 돌아간다
  await page.click('.cards > .card:first-child .card-title');
  await page.waitForFunction(() => !document.querySelector('.stage-note'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
  f = await screenFrame(page);
  const back = await visibleMarkers(page);
  check('다른 상태의 Comment 를 누르면 그 화면 상태로 돌아간다', back.includes('1'), JSON.stringify(back));

  console.log('\n[8] 녹화');
  await page.click('.cards > .card:first-child .card-title').catch(() => {});
  if (!(await page.$('.cards > .card.is-sel'))) await page.click('.cards > .card:first-child .card-title');
  await page.click('button[aria-label="화면 녹화"]');
  await page.waitForSelector('.btn-icon.is-rec');
  await page.waitForTimeout(1500);
  await page.click('button[aria-label="녹화 멈추기"]');
  await page.waitForSelector('.popover-card .clip video', { timeout: 10000 }).catch(() => {});
  const dur = await page.$eval('.popover-card .clip video', async (v) => {
    const el = v as HTMLVideoElement;
    if (el.readyState < 1) await new Promise((r) => el.addEventListener('loadedmetadata', r, { once: true }));
    return el.videoWidth;
  }).catch(() => 0);
  check('녹화한 클립이 선택한 Comment 에 붙고 재생된다', dur > 0, `폭 ${dur}px`);

  console.log('\n[9] 패널 폭 · 전체화면');
  const panelW = async () => (await (await page.$('.panel'))!.boundingBox())!.width;
  const w0 = await panelW();
  const sp = (await (await page.$('.splitter'))!.boundingBox())!;
  await page.mouse.move(sp.x + 2, sp.y + 200);
  await page.mouse.down();
  await page.mouse.move(sp.x - 120, sp.y + 200, { steps: 5 });
  await page.mouse.up();
  const w1 = await panelW();
  check('손잡이로 패널 폭을 바꾼다', w1 - w0 > 100, `${Math.round(w0)} → ${Math.round(w1)}px`);
  await page.click('button[aria-label="전체화면"]');
  await page.waitForTimeout(400);
  const full = await page.evaluate(() => !!document.fullscreenElement);
  check('전체화면 — 툴바가 숨고 작은 막대가 뜬다', full && !(await page.$('.toolbar')) && !!(await page.$('.float-bar')));
  await page.screenshot({ path: resolve(OUT, '3-fullscreen.png') });
  await page.click('button[aria-label="전체화면 나가기"]');
  await page.waitForTimeout(300);

  console.log('\n[10] 개요 편집 · 저장 → 다시 열기');
  await page.click('.notes .section-head');
  await page.click('.notes .cm-content');
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('검증 메모\n');
  await page.click('.toolbar .tb-title').catch(() => {});
  await page.waitForTimeout(500);
  const dl = page.waitForEvent('download');
  await page.click('.toolbar .btn-primary');
  const d = await dl;
  check('저장 이름이 .terr.html 이고 내 이름이 붙는다', /_검증봇\.terr\.html$/.test(d.suggestedFilename()), d.suggestedFilename());
  await d.saveAs(SAVED);
  const page2 = await ctx.newPage();
  page2.on('pageerror', (e) => errors.push(e.message));
  await page2.goto(pathToFileURL(SAVED).href);
  f = await screenFrame(page2);
  await splashDone(f);
  await page2.waitForTimeout(800);
  check('Comment 3개가 남아 있다', (await cardCount(page2)) === 3);
  check('개요 편집이 남아 있다', ((await page2.textContent('.notes .cm-content')) ?? '').startsWith('검증 메모'));
  check('클립이 남아 있다', ((await page2.textContent('.cards')) ?? '').length > 0 && (await page2.$$('.card .badge-icon')).length > 0);

  console.log('\n[11] 버전 · 테마');
  await page2.selectOption('select[aria-label="화면 버전"]', '1');
  f = await screenFrame(page2);
  check('v1(옛 화면)도 같은 데이터로 뜬다', await splashDone(f));
  await page2.click('button[aria-label="테마 전환"]');
  await page2.waitForTimeout(100);
  check('다크 테마로 바뀐다', (await page2.getAttribute('html', 'data-theme')) === 'dark');
  await page2.screenshot({ path: resolve(OUT, '4-dark-v1.png') });

  console.log('\n[12] 라이브 문서 — 저장을 누르지 않아도');
  const page3 = await ctx.newPage();
  await page3.goto(pathToFileURL(DOC).href); // 처음 받은 원본을 다시 연다
  await screenFrame(page3);
  await page3.waitForTimeout(1500);
  check('이 브라우저에 남은 변경이 이어서 열린다 (Comment 3개)', (await cardCount(page3)) === 3, `${await cardCount(page3)}개`);
  check('자동 저장 상태가 보인다', ((await page3.textContent('.save-status')) ?? '').length > 0, (await page3.textContent('.save-status')) ?? '');
  check('저장과 다른 이름으로 저장이 따로 있다', !!(await page3.$('.split-main')) && !!(await page3.$('button[aria-label="다른 이름으로 저장"]')));

  const real = errors.filter((e) => !/favicon|ERR_FILE_NOT_FOUND/.test(e));
  check('페이지 오류가 없다', real.length === 0, real.slice(0, 3).join(' | '));

  await browser.close();
  console.log(failed ? `\n실패 ${failed}건` : '\n모두 통과');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
