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

async function until<T>(fn: () => T | Promise<T>, ms = 15000): Promise<T | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
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

/** 펼침 메뉴가 잘리지 않고 실제로 보이는가 — 메뉴의 첫 항목 자리에서 맨 위 요소가 그 항목인가 */
async function menuVisible(page: Page, label: string): Promise<boolean> {
  await page.click(`button[aria-label="${label}"]`);
  await page.waitForTimeout(100);
  const ok = await page.evaluate((l) => {
    const btn = document.querySelector(`button[aria-label="${l}"]`)!;
    const item = btn.closest('.popover-wrap')?.querySelector('.popover .popover-item') as HTMLElement | null;
    if (!item) return false;
    const r = item.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && item.contains(top);
  }, label);
  await page.click(`button[aria-label="${label}"]`); // 다시 눌러 닫는다
  await page.waitForTimeout(50);
  return ok;
}

/** Comment 를 눌러 화면 상태를 찾아가는 동안 — 불러오는 표시가 떴다 사라질 때까지 */
async function revealDone(page: Page) {
  await page.waitForSelector('.stage-note', { timeout: 1500 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('.stage-note'), null, { timeout: 30000 }).catch(() => {});
}

/** 패널의 n번째 Comment 를 고른 상태로 — 이미 골라져 있으면 그대로 둔다 */
async function selectCard(page: Page, n: number) {
  const sel = `.cards > .card:nth-child(${n})`;
  if (!(await page.$(sel + '.is-sel'))) await page.click(sel + ' .no');
  if (!(await page.$(sel + '.is-sel'))) await page.click(sel + ' .no');
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
  if (process.env.DEBUG_REVEAL) {
    await ctx.addInitScript(() => {
      if (window.top === window) return;
      window.addEventListener('message', (e) => {
        const m = (e.data as { __terrHost?: { type: string } })?.__terrHost;
        if (m && m.type === 'reveal') console.log('REVEAL ' + JSON.stringify(m));
      });
      const t0 = Date.now();
      setInterval(() => {
        try {
          console.log(`T${Date.now() - t0} view=${(0, eval)('typeof store !== "undefined" ? store.view : "-"')} splash=${document.querySelector('#splash')?.className}`);
        } catch {}
      }, 1000);
    });
  }
  const page = await ctx.newPage();
  if (process.env.DEBUG_REVEAL) page.on('console', (m) => /^(REVEAL|T\d)/.test(m.text()) && console.log('    [frame]', m.text().slice(0, 600)));
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
  check('개요는 기본으로 접혀 있다', !(await page.$('.notes .cm-content')));
  await page.click('.notes .section-head'); // 펼친다
  await page.waitForSelector('.notes .cm-content');
  await page.waitForTimeout(100);
  const ratio = await page.evaluate(() => document.querySelector('.notes')!.getBoundingClientRect().height / document.querySelector('.panel')!.getBoundingClientRect().height);
  check('개요를 펼치면 패널의 절반쯤', ratio > 0.42 && ratio < 0.75, ratio.toFixed(2));
  check('개요에 README 가 마크다운으로 보인다', ((await page.textContent('.notes .cm-content')) ?? '').includes('데이터 매핑'));
  check('개요의 # 기호는 숨고 제목 서식만 보인다', !!(await page.$('.notes .cm-h1')) && !((await page.textContent('.notes .cm-h1')) ?? '').startsWith('#'));
  await page.click('.notes .section-head'); // 개요 접기 — Comment 를 위로
  await page.screenshot({ path: resolve(OUT, '1-open.png') });

  console.log('\n[2] Ctrl 피커 · 마크다운 Comment');
  let p = await pagePoint(page, f, '#tabB');
  await page.mouse.move(p.x, p.y);
  await page.keyboard.down('Control');
  await page.waitForTimeout(100);
  check('Ctrl 을 누르면 피커가 된다', !!(await page.$('.pick-layer')) && !!(await page.$('.app.is-picking')));
  await page.mouse.click(p.x, p.y);
  await page.keyboard.up('Control');
  await page.waitForTimeout(100);
  check('Ctrl 을 떼면 피커가 꺼지고 작성 창은 남는다', !(await page.$('.pick-layer')) && !!(await page.$('.composer')));
  await typeComposer(page, '## 탭 이름\n- [ ] 띄어쓰기 "설비 정보"');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(300);
  check('Comment 가 생긴다', (await cardCount(page)) === 1);
  check('다크 테마가 기본이다', (await page.getAttribute('html', 'data-theme')) === 'dark');
  check('마커 줄에 번호가 늘어선다', (await page.$$('.mk-strip .mk-list .mk')).length === 1 && !!(await page.$('.mk-list .mk-live')));
  check('화면 머리에 화면 ID · 버전 · 실행 상태가 보인다',
    !!(await page.$('.tabs .tab.is-on .tab-id')) && (await page.$$('.sc-bar .ver-chip')).length === 2 && !!(await page.$('.sc-bar .sc-state')));
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
  check('작성 창에 대상 설명 같은 각주가 없다', !(await page.$('.composer .mono')) && !(await page.$('.composer label')));
  check('작성 창이 대상 옆 팝업으로 뜬다', !!(await page.$('.popover-card .composer')) && !(await page.$('.panel .composer')));
  await typeComposer(page, 'BAY-4 구역 — **경고 색** 대비가 약함');
  await page.click('.composer .btn-primary');
  await page.waitForTimeout(400);
  check('Comment 2개 · 마커 2개', (await cardCount(page)) === 2 && (await visibleMarkers(page)).length === 2, JSON.stringify(await visibleMarkers(page)));
  check('브라우저에서는 영역도 화면에 붙는다 (찍을 그림이 없어 캡처 없음)', !(await page.$('.snip-bar')) && !!(await until(async () => (await page.$$('.mk-list .mk-live')).length === 2, 3000)), JSON.stringify(await page.$$eval('.mk-strip .mk-list .mk', (m) => m.map((x) => (x as HTMLElement).dataset.state))));
  check('유형·상태·담당 입력이 없다', !(await page.$('.detail select')) && !(await page.$('.detail input:not([type=checkbox])')));
  await page.screenshot({ path: resolve(OUT, '2-comments.png') });

  console.log('\n[3] 마커 색');
  const tones = await page.$$eval('.marker', (ms) => ms.map((m) => (m as HTMLElement).dataset.tone));
  check('자동 — 배경 밝기에 따라 마커 톤을 고른다', tones.every((t) => t === 'ondark' || t === 'onlight'), tones.join(','));
  await page.click('button[aria-label="마커 색"]');
  await page.click('.popover-item:has-text("빨강")');
  check('마커 색을 바꿀 수 있다', (await page.getAttribute('.marker-layer', 'data-color')) === 'red');
  check('마커 색 메뉴가 잘리지 않고 보인다', await menuVisible(page, '마커 색'));

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

  console.log('\n[6b] 팝업 닫기 · Delete 키');
  await selectCard(page, 2);
  await page.waitForSelector('.popover-card');
  await page.click('.popover-card button[aria-label="닫기"]');
  await page.waitForTimeout(150);
  check('팝업 × 는 팝업만 닫고 선택은 남긴다', !(await page.$('.popover-card')) && !!(await page.$('.cards > .card:nth-child(2).is-sel')));
  await page.click('.cards > .card:nth-child(2) .card-title');
  check('같은 카드를 다시 누르면 팝업이 다시 뜬다', !!(await until(() => page.$('.popover-card'), 2000)));
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
  check('고른 Comment 를 Delete 로 지운다', (await cardCount(page)) === 1, `${await cardCount(page)}개`);
  await page.mouse.click(5, 300);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  check('Ctrl+Z 로 되살린다', (await cardCount(page)) === 2);

  console.log('\n[7] 다른 화면 상태로 이동');
  await f.click('#tabB');
  await page.waitForTimeout(600);
  check('설비정보 탭에서는 FAB 캔버스 마커가 숨는다', (await visibleMarkers(page)).length === 1);
  check('숨은 Comment 에 "다른 상태" 표시', !!(await page.$('.card .chip-hint')));
  check('마커 줄에서도 다른 상태로 구분된다', (await page.$$('.mk-list .mk-other')).length >= 1);
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
  await revealDone(page);
  await page.waitForTimeout(700);
  const inB = await f.evaluate(() => !document.querySelector('#viewB')?.hasAttribute('hidden'));
  check('탭 안의 Comment 를 누르면 그 탭으로 전환된다', inB && (await visibleMarkers(page)).includes('3'), JSON.stringify(await visibleMarkers(page)));
  // 캔버스 Comment(경로 없음)를 누른다 — 처음부터 다시 불러와 FAB 로 돌아간다
  await page.click('.cards > .card:first-child .card-title');
  await revealDone(page);
  await page.waitForTimeout(800);
  f = await screenFrame(page);
  const back = await visibleMarkers(page);
  check('다른 상태의 Comment 를 누르면 그 화면 상태로 돌아간다', back.includes('1'), JSON.stringify(back));

  console.log('\n[7b] FAB 조망 → BAY-4 상세 맵 — 캔버스 클릭으로 들어간 화면');
  f = await screenFrame(page);
  await page.mouse.click(5, 300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check('Esc 로 Comment 팝업을 닫는다', !(await page.$('.popover-card')));
  const fabPoint = async () => {
    const box = (await (await page.$('iframe.stage-iframe'))!.boundingBox())!;
    const c = await f.evaluate(() => {
      const h = (window as unknown as { FB?: { hit: { x: number; y: number }[] | null } }).FB?.hit
        ?? (0, eval)('typeof FB !== "undefined" ? FB.hit : null');
      const r = document.querySelector('#fabStage')!.getBoundingClientRect();
      if (!h) return null;
      return { x: r.left + h.reduce((a: number, q: { x: number }) => a + q.x, 0) / h.length, y: r.top + h.reduce((a: number, q: { y: number }) => a + q.y, 0) / h.length };
    }).catch(() => null);
    return c && { x: box.x + c.x * (box.width / 1920), y: box.y + c.y * (box.width / 1920) };
  };
  let fp: { x: number; y: number } | null = null;
  for (let i = 0; i < 30 && !fp; i++) {
    fp = await fabPoint();
    if (!fp) await page.waitForTimeout(200);
  }
  check('FAB 조망에서 BAY-4 구역을 찾는다', !!fp);
  if (fp) {
    const inA = () => f.evaluate(() => !document.querySelector('#viewA')?.hasAttribute('hidden'));
    await page.mouse.move(fp.x, fp.y);
    await page.mouse.click(fp.x, fp.y);
    await page.waitForTimeout(700);
    check('BAY-4 를 누르면 상세 맵으로 들어간다', await inA());
    await ctrlClick(page, await pagePoint(page, f, '#iso', 0.45, 0.45));
    await typeComposer(page, '상세 맵 Comment');
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(300);
    const n = await cardCount(page);
    check('상세 맵에 Comment 를 단다', n === 4, `${n}개`);
    await f.click('#backFab');
    await page.waitForTimeout(600);
    check('FAB 로 돌아오면 상세 맵 Comment 가 숨는다', !(await inA()) && !(await visibleMarkers(page)).includes('4'));
    await page.click('.cards > .card:nth-child(4) .card-title');
    await revealDone(page);
    await page.waitForTimeout(800);
    f = await screenFrame(page);
    await page.keyboard.press('Escape');
    const ok = (await inA()) && (await visibleMarkers(page)).includes('4');
    check('상세 맵 Comment 를 누르면 FAB → BAY-4 를 다시 눌러 그 화면으로 간다', ok, JSON.stringify(await visibleMarkers(page)));
    await page.screenshot({ path: resolve(OUT, '2b-bay4.png') });
    await selectCard(page, 4);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);
    check('정리 — 상세 맵 Comment 를 지운다', (await cardCount(page)) === 3);
  }

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
  check('전체화면 — 툴바가 숨고 화면 막대에 조작이 남는다', full && !(await page.$('.toolbar')) && !!(await page.$('.sc-bar button[aria-label="피커"]')));
  await page.screenshot({ path: resolve(OUT, '3-fullscreen.png') });
  await page.click('button[aria-label="전체화면 나가기"]');
  await page.waitForTimeout(300);
  const frameW = async () => (await (await page.$('.stage-frame'))!.boundingBox())!.width;
  const fw0 = await frameW();
  await page.click('button[aria-label="확대"]');
  await page.click('button[aria-label="확대"]');
  await page.waitForTimeout(200);
  const fw1 = await frameW();
  check('확대하면 화면이 커지고 스크롤된다', fw1 > fw0 * 1.1 && !!(await page.$('.stage.stage-scroll')), `${Math.round(fw0)} → ${Math.round(fw1)}px`);
  await page.click('.zoom-val');
  await page.waitForTimeout(200);
  check('배율 칸을 누르면 맞춤으로 돌아간다', Math.abs((await frameW()) - fw0) < 2 && ((await page.textContent('.zoom-val')) ?? '').startsWith('맞춤'));
  check('탭 줄과 화면 목록이 있다', (await page.$$('.tabs .tab')).length === 1 && !!(await page.$('.tabs button[aria-label="화면 목록"]')));
  check('화면 목록(▾)을 누르면 목록이 보인다', await menuVisible(page, '화면 목록'));
  const stageW = async () => (await (await page.$('.stage'))!.boundingBox())!;
  await page.click('.seg-btn:has-text("꽉 채움")');
  await page.waitForTimeout(300);
  const sb = await stageW();
  const fb = (await (await page.$('.stage-frame'))!.boundingBox())!;
  check('꽉 채움 — 화면이 탭을 가득 채운다', Math.abs(fb.width - sb.width) < 3 && Math.abs(fb.height - sb.height) < 3, `${Math.round(fb.width)}×${Math.round(fb.height)} / ${Math.round(sb.width)}×${Math.round(sb.height)}`);
  f = await screenFrame(page);
  check('꽉 채움에서도 마커가 붙는다', (await visibleMarkers(page)).length >= 1);
  await page.click('.seg-btn:has-text("여백")');
  await page.waitForTimeout(300);

  console.log('\n[10] 개요 편집 · 저장 → 다시 열기');
  await page.click('.notes .section-head');
  await page.click('.notes .cm-content');
  await page.keyboard.press('Control+Home');
  await page.waitForTimeout(300); // 맨 위로 스크롤하는 순간에 글자를 쏟아 넣으면 편집기가 순서를 놓친다 — 사람 속도로
  await page.keyboard.type('검증 메모\n');
  const notesH = () => page.evaluate(() => document.querySelector('.notes')!.getBoundingClientRect().height);
  const nh0 = await notesH();
  for (let i = 0; i < 5; i++) await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const nh1 = await notesH();
  check('개요 높이는 절반 그대로 — Enter 를 쳐도 늘어나지 않는다', Math.abs(nh1 - nh0) < 2, `${Math.round(nh0)} → ${Math.round(nh1)}px`);
  for (let i = 0; i < 70; i++) await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const lay = await page.evaluate(() => {
    const panel = document.querySelector('.panel')!.getBoundingClientRect();
    const head = document.querySelector('.comments .section-head')!.getBoundingClientRect();
    const sc = document.querySelector('.notes .cm-scroller') as HTMLElement;
    return { headIn: head.bottom <= panel.bottom + 1, scrolls: sc.scrollHeight > sc.clientHeight + 4 };
  });
  check('개요가 길어지면 개요 상자 안에서 스크롤되고 Comment 제목은 그대로', lay.headIn && lay.scrolls, JSON.stringify(lay));
  // 개요와 Comment 사이 손잡이
  const spl = (await (await page.$('.notes-splitter'))!.boundingBox())!;
  await page.mouse.move(spl.x + spl.width / 2, spl.y + spl.height / 2);
  await page.mouse.down();
  await page.mouse.move(spl.x + spl.width / 2, spl.y - 150, { steps: 5 });
  await page.mouse.up();
  const nh2 = await notesH();
  check('개요와 Comment 사이를 끌어 개요 높이를 바꾼다', nh2 < nh1 - 100, `${Math.round(nh1)} → ${Math.round(nh2)}px`);
  await page.dblclick('.notes-splitter');
  check('손잡이를 더블클릭하면 절반으로', Math.abs((await notesH()) - nh1) < 4);
  await page.click('.comments .section-head');
  check('Comment 도 접힌다', !(await page.$('.cards')));
  await page.click('.comments .section-head');
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
  const notes2 = (await page2.textContent('.notes .cm-content')) ?? '';
  check('개요 편집이 남아 있다', notes2.startsWith('검증 메모'), JSON.stringify(notes2.slice(0, 40)));
  check('클립이 남아 있다', ((await page2.textContent('.cards')) ?? '').length > 0 && (await page2.$$('.card .badge-icon')).length > 0);

  console.log('\n[11] 버전 · 테마');
  await page2.click('.ver-chip[data-v="1"]');
  f = await screenFrame(page2);
  check('v1(옛 화면)도 같은 데이터로 뜬다', await splashDone(f));
  await page2.click('button[aria-label="테마 전환"]');
  await page2.waitForTimeout(100);
  check('라이트 테마로 바뀐다', (await page2.getAttribute('html', 'data-theme')) === 'light');
  await page2.screenshot({ path: resolve(OUT, '4-light-v1.png') });

  console.log('\n[12] 라이브 문서 — 저장을 누르지 않아도');
  const page3 = await ctx.newPage();
  await page3.goto(pathToFileURL(DOC).href); // 처음 받은 원본을 다시 연다
  await screenFrame(page3);
  await page3.waitForTimeout(1500);
  check('이 브라우저에 남은 변경이 이어서 열린다 (Comment 3개)', (await cardCount(page3)) === 3, `${await cardCount(page3)}개`);
  check('자동 저장 상태가 보인다', ((await page3.textContent('.save-status')) ?? '').length > 0, (await page3.textContent('.save-status')) ?? '');
  check('저장과 다른 이름으로 저장이 따로 있다 (디스켓 · 연필)', !!(await page3.$('.split-main')) && !!(await page3.$('button[aria-label="다른 이름으로 저장"] .saveas-pen')));
  check('로고는 앱 아이콘 그림', (await page3.getAttribute('.toolbar img.logo', 'src'))?.startsWith('data:image/png') ?? false);

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
