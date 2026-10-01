/* Manna E2E — 구운 첫 빵(out/e2e/proto.manna.html)을 설치된 Chrome 에서 file:// 로 열어 확인한다.
 * docs/ARCHITECTURE.md §9 Phase 0 완료 기준 2~6.
 *
 *   npm run test:e2e
 */
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Frame, type Page } from 'playwright-core';

const OUT = resolve('out/e2e');
const DOC = resolve(OUT, 'proto.manna.html');
const SAVED = resolve(OUT, 'proto.saved.html');
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
  const handle = await page.waitForSelector('iframe.stage-iframe');
  for (let i = 0; i < 100; i++) {
    const f = await handle.contentFrame();
    if (f && (await f.evaluate(() => !!(window as unknown as { __manna?: unknown }).__manna).catch(() => false))) return f;
    await page.waitForTimeout(100);
  }
  throw new Error('품은 화면이 뜨지 않았습니다');
}

async function waitSplash(f: Frame): Promise<boolean> {
  return f
    .waitForFunction(() => document.querySelector('#splash')?.classList.contains('done'), null, { timeout: 30000 })
    .then(() => true, () => false);
}

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

async function visibleMarkers(page: Page): Promise<number> {
  return page.$$eval('.marker', (ms) => ms.filter((m) => (m as HTMLElement).style.display === 'flex').length);
}

async function main() {
  if (!CHROME) throw new Error('Chrome 또는 Edge 를 찾지 못했습니다. CHROME_PATH 로 지정해 주세요.');
  if (!existsSync(DOC)) throw new Error(`${DOC} 가 없습니다. npm run test:e2e 로 실행해 주세요.`);
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 960 }, acceptDownloads: true });
  // 파일 저장 대화상자 대신 다운로드 경로(Firefox·Safari 와 같은 흐름)로 확인한다
  await ctx.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  console.log('\n[1] 문서 열기');
  const t0 = Date.now();
  await page.goto(pathToFileURL(DOC).href);
  await page.waitForSelector('.modal input');
  check('이름 입력 창이 뜬다', true);
  await page.fill('.modal input', '검증봇');
  await page.click('.modal button[type=submit]');
  let f = await screenFrame(page);
  check('품은 화면의 데이터 로딩이 끝난다 (스플래시 종료)', await waitSplash(f), `${Date.now() - t0}ms`);
  const loaded = await f.$$eval('.loadrow.ok', (rows) => rows.length);
  const failedRows = await f.$$eval('.loadrow .rt', (rs) => rs.filter((r) => r.textContent === '불러오지 못함').length);
  check('data/*.js 6개를 모두 불러온다', loaded === 6 && failedRows === 0, `ok ${loaded}, 실패 ${failedRows}`);
  const misses = await f.evaluate(() => (window as unknown as { __manna: { misses: unknown[] } }).__manna.misses.length);
  check('찾지 못한 파일이 없다', misses === 0, `${misses}개`);
  const font = await f.evaluate(() => document.fonts.check('16px "Pretendard Variable"'));
  check('Pretendard 가 문서 안의 파일로 적용된다 (오프라인)', font);
  await page.screenshot({ path: resolve(OUT, '1-open.png') });

  console.log('\n[2] 어노테이션');
  await page.click('.seg-btn:has-text("어노테이션")');
  let p = await pagePoint(page, f, '#tabB');
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await page.waitForSelector('.composer textarea');
  check('요소 클릭으로 작성 창이 열린다', true, await page.textContent('.composer .mono') ?? '');
  await page.fill('.composer textarea', '설비정보 탭 — 탭 이름을 "설비 정보"로 띄어 써 주세요.');
  await page.click('.composer .btn-primary');
  // 캔버스 위 영역 드래그
  const a = await pagePoint(page, f, '#fabCv', 0.3, 0.3);
  const b = await pagePoint(page, f, '#fabCv', 0.45, 0.5);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForSelector('.composer textarea');
  const label = (await page.textContent('.composer .mono')) ?? '';
  check('캔버스 드래그는 canvas 안의 영역으로 잡힌다', /canvas#fabCv 안의 영역/.test(label), label);
  await page.click('.composer .seg-btn:has-text("이슈")');
  await page.fill('.composer textarea', 'BAY-4 구역 — 경고 색이 배경과 구분이 약합니다.');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(300);
  check('카드 2개가 생긴다', (await page.$$('.card')).length === 2);
  check('마커 2개가 화면에 보인다', (await visibleMarkers(page)) === 2);
  await page.screenshot({ path: resolve(OUT, '2-annotated.png') });

  console.log('\n[3] 일시정지');
  await page.click('button[aria-label="화면 일시정지"]');
  await page.waitForTimeout(100);
  const frozen = await f.evaluate(async () => {
    const a = performance.now();
    await new Promise((r) => setTimeout(r, 400));
    return performance.now() - a;
  });
  check('일시정지하면 품은 화면의 시계가 멈춘다', frozen < 5, `${frozen.toFixed(1)}ms 흐름`);
  await page.click('button[aria-label="화면 재생"]');
  const running = await f.evaluate(async () => {
    const a = performance.now();
    await new Promise((r) => setTimeout(r, 200));
    return performance.now() - a;
  });
  check('재생하면 시계가 이어서 흐른다', running > 150, `${running.toFixed(0)}ms`);

  console.log('\n[4] 화면 상태와 마커');
  await page.click('.seg-btn:has-text("보기")');
  await f.click('#tabB');
  await page.waitForTimeout(500);
  const afterTab = await visibleMarkers(page);
  check('설비정보 탭으로 가면 FAB 캔버스의 마커가 숨는다', afterTab === 1, `보이는 마커 ${afterTab}`);
  check('패널에 "다른 화면 상태" 묶음이 생긴다', !!(await page.$('.group-title:has-text("다른 화면 상태")')));
  await page.screenshot({ path: resolve(OUT, '3-tab-b.png') });
  await f.click('#tabC');
  await page.waitForTimeout(500);
  check('FAB 로 돌아오면 다시 보인다', (await visibleMarkers(page)) === 2);

  console.log('\n[5] 저장 → 다시 열기');
  const dl = page.waitForEvent('download');
  await page.click('.toolbar .btn-primary');
  const d = await dl;
  check('저장하면 HTML 한 장이 내려받아진다', /\.html$/.test(d.suggestedFilename()), d.suggestedFilename());
  await d.saveAs(SAVED);
  const page2 = await ctx.newPage();
  page2.on('pageerror', (e) => errors.push(e.message));
  await page2.goto(pathToFileURL(SAVED).href);
  f = await screenFrame(page2);
  await waitSplash(f);
  await page2.waitForTimeout(800);
  const cards = await page2.$$eval('.card', (cs) => cs.length);
  check('다시 연 문서에 어노테이션 2개가 남아 있다', cards === 2, `${cards}개`);
  check('수신자가 단 항목은 "새 N" 번호로 보인다', ((await page2.textContent('.card .no')) ?? '').startsWith('새'));
  check('다시 연 문서에서도 마커가 붙는다', (await visibleMarkers(page2)) === 2);

  console.log('\n[6] 버전');
  const options = await page2.$$eval('select[aria-label="화면 버전"] option', (os) => os.map((o) => o.textContent));
  check('화면 버전 v1·v2 가 있다', options.length === 2, options.join(' / '));
  await page2.selectOption('select[aria-label="화면 버전"]', '1');
  f = await screenFrame(page2);
  check('v1(옛 화면)도 같은 데이터로 뜬다', await waitSplash(f));
  const m1 = await f.evaluate(() => (window as unknown as { __manna: { misses: unknown[] } }).__manna.misses.length);
  check('v1 에서도 찾지 못한 파일이 없다', m1 === 0, `${m1}개`);
  await page2.screenshot({ path: resolve(OUT, '4-v1.png') });

  console.log('\n[7] 설명 · 테마');
  await page2.click('.ptab:has-text("설명")');
  await page2.waitForSelector('.markdown h1, .markdown h2');
  check('README 가 설명 탭에 렌더링된다', true, (await page2.textContent('.markdown h1, .markdown h2'))?.slice(0, 40));
  await page2.click('button[aria-label="테마 전환"]');
  await page2.waitForTimeout(100);
  check('다크 테마로 바뀐다', (await page2.getAttribute('html', 'data-theme')) === 'dark');
  await page2.screenshot({ path: resolve(OUT, '5-dark-desc.png') });

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
