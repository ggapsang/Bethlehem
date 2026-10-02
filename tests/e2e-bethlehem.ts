/* Bethlehem E2E — 빌드된 Electron 앱으로
 *   폴더 열기(비어 있지 않은 폴더) → 폴더 화면 등록 → Ctrl 피커(멈춤 그림) → 팝업 Comment(달 때 화면) → 자동 저장
 *   → FAB 조망 → BAY-4 상세 맵 Comment 로 찾아가기 → 원본 변경 감지 → URL 화면(실시간 사이트 · 사용자 지정 테스트 사이트)
 *   → 여러 페이지 화면(index.html → detail.html) → 그림 화면 → 다른 이름으로 저장 → 돌아온 문서 병합 → 다시 켜면 이어서
 *   → 테라리움 문서가 든 폴더를 열면 풀어서 작업 폴더로
 * 파일 대화상자는 메인 프로세스에서 바꿔 끼운다.
 *
 *   npm run test:e2e:app
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron, chromium, type ElectronApplication, type Frame, type Page } from 'playwright-core';
import { parseManna, serializeManna } from '../packages/core/src';

const ROOT = resolve('.');
const OUT = resolve('out/e2e');
const SITE = 'http://semicon-xms.xdt.com/monitor';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WS = mkdtempSync(join(tmpdir(), 'terr-ws-'));
const SRC = mkdtempSync(join(tmpdir(), 'terr-src-'));
const UD = mkdtempSync(join(tmpdir(), 'terr-ud-'));
const EXPORT = join(OUT, 'export-test');
const MULTI = join(OUT, 'multi-src');
const IMG = join(OUT, 'img-src', 'icon.png');
const UNPACK = join(OUT, 'unpack-ws');

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | Promise<T>, ms = 15000): Promise<T | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(250);
  }
  return null;
}

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [ROOT],
    cwd: ROOT,
    env: { ...process.env, BETHLEHEM_E2E_GRANT: `${WS};${SRC};${OUT}`, BETHLEHEM_USER_DATA: UD, ELECTRON_RENDERER_URL: '' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

const nextOpen = (app: ElectronApplication, p: string) =>
  app.evaluate(({ dialog }, d) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [d] })) as typeof dialog.showOpenDialog;
  }, p);
const nextSave = (app: ElectronApplication, p: string) =>
  app.evaluate(({ dialog }, d) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: d })) as typeof dialog.showSaveDialog;
  }, p);

/** 화면을 연다 — 탭이 있으면 그 탭, 없으면 화면 목록에서 */
async function openScreen(p: Page, id: string) {
  if (await p.$(`.tab[data-id="${id}"]`)) await p.click(`.tab[data-id="${id}"] .tab-main`);
  else {
    await p.click('button[aria-label="화면 목록"]');
    await p.click(`.popover-item[data-id="${id}"]`);
  }
  await p.waitForTimeout(300);
}

async function screenFrame(page: Page): Promise<Frame> {
  for (let i = 0; i < 300; i++) {
    const h = await page.$('iframe.stage-iframe');
    const f = h && (await h.contentFrame());
    if (f && (await f.evaluate(() => !!(window as unknown as { __manna?: unknown }).__manna).catch(() => false))) return f;
    await page.waitForTimeout(100);
  }
  throw new Error('품은 화면이 뜨지 않았습니다');
}

const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const comments = (id: string) => (existsSync(join(WS, 'screens', id, 'comments.json')) ? readJson(join(WS, 'screens', id, 'comments.json')) : []);
const distFile = () => (existsSync(join(WS, 'dist')) ? readdirSync(join(WS, 'dist')).find((n) => n.endsWith('.terr.html')) : undefined);

/** 스테이지 위의 점(화면 뷰포트 좌표 → 창 좌표) */
async function stagePoint(page: Page, x: number, y: number) {
  const box = (await (await page.$('.stage-frame'))!.boundingBox())!;
  const s = box.width / 1920;
  return { x: box.x + x * s, y: box.y + y * s };
}

async function ctrlPick(page: Page, p: { x: number; y: number }, to?: { x: number; y: number }) {
  await page.mouse.move(p.x, p.y);
  await page.keyboard.down('Control');
  await page.waitForTimeout(400); // 멈춤 그림을 찍을 시간
  if (to) {
    await page.mouse.down();
    await page.mouse.move((p.x + to.x) / 2, (p.y + to.y) / 2, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
  } else await page.mouse.click(p.x, p.y);
  await page.keyboard.up('Control');
}

async function main() {
  cpSync(resolve('example/proto'), SRC, { recursive: true });
  writeFileSync(join(WS, '메모.txt'), '작업 폴더는 비어 있지 않아도 된다');
  for (const d of [MULTI, UNPACK, join(OUT, 'img-src')]) rmSync(d, { recursive: true, force: true });
  mkdirSync(MULTI, { recursive: true });
  mkdirSync(join(OUT, 'img-src'), { recursive: true });
  cpSync(resolve('docs/icon.png'), IMG);
  const PAGE = (title: string, body: string) =>
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title><style>body{margin:0;font:16px sans-serif;background:#f5f5f4}a{display:inline-block;margin:40px;font-size:32px}#detailBox{margin:40px;width:600px;height:300px;background:#fb923c}</style></head><body>${body}</body></html>`;
  writeFileSync(join(MULTI, 'index.html'), PAGE('목록', '<h1>목록</h1><a id="toDetail" href="detail.html">상세로</a>'));
  writeFileSync(join(MULTI, 'detail.html'), PAGE('상세', '<h1>상세</h1><a id="toHome" href="index.html">목록으로</a><div id="detailBox"></div>'));
  let { app, page } = await launch();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  console.log('\n[1] 폴더 열기 — 비어 있지 않은 폴더도 작업 폴더가 된다');
  await page.waitForSelector('.modal input');
  await page.fill('.modal input', '기획자');
  await page.click('.modal button[type=submit]');
  check('키 아트 첫 화면 · 소개 문구 없음', !!(await page.$('.welcome-art')) && !((await page.textContent('.welcome')) ?? '').includes('바이브'));
  await nextOpen(app, WS);
  await page.click('.welcome button:has-text("폴더 열기")');
  check('terrarium.json 이 생긴다', !!(await until(() => existsSync(join(WS, 'terrarium.json')))));
  check('원래 있던 파일은 그대로 둔다', existsSync(join(WS, '메모.txt')));
  check('다크 테마가 기본이다', (await page.getAttribute('html', 'data-theme')) === 'dark');
  await page.click('button[aria-label="작업 폴더 · 문서"]');
  await page.click('.popover-item:has-text("개발자 도구")');
  const devOpen = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.isDevToolsOpened()));
  check('메뉴에서 개발자 도구를 연다', !!(await until(devOpen, 5000)));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.closeDevTools()));
  check('툴바에 작업 폴더 이름이 보인다', ((await page.textContent('.tb-place')) ?? '').includes(WS.split(/[\\/]/).pop()!));

  console.log('\n[2] 폴더 화면 · 자동 저장 · 보낼 파일');
  await nextOpen(app, SRC);
  await page.click('.welcome button:has-text("화면 폴더 추가")');
  await page.waitForSelector('.file-list');
  await page.click('.modal button[type=submit]');
  let f = await screenFrame(page);
  await f.waitForFunction(() => document.querySelector('#splash')?.classList.contains('done'), null, { timeout: 30000 }).catch(() => {});
  check('screens/SCR-001 에 screen.json · notes.md · comments.json', !!(await until(() => ['screen.json', 'notes.md', 'comments.json'].every((n) => existsSync(join(WS, 'screens', 'SCR-001', n))))));
  check('blobs/ 에 내용 해시 파일', existsSync(join(WS, 'blobs')) && readdirSync(join(WS, 'blobs')).length > 0);
  check('dist/ 에 보낼 파일이 자동으로 구워진다', !!(await until(distFile, 12000)), distFile());
  const link = readJson(join(WS, 'screens', 'SCR-001', 'screen.json')).link;
  check('원본 폴더 연결이 작업 폴더에만 남는다', link?.dir === SRC && !readFileSync(join(WS, 'dist', distFile()!), 'utf8').includes(SRC.replace(/\\/g, '\\\\')));

  console.log('\n[3] Ctrl 피커 → 멈춤 그림 → 팝업 Comment → 달 때 화면');
  const tab = await f.evaluate(() => { const b = document.querySelector('#tabB')!.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  const tp = await stagePoint(page, tab.x, tab.y);
  await page.mouse.move(tp.x, tp.y);
  await page.keyboard.down('Control');
  check('Ctrl 을 누르면 화면이 멈춘 그림으로 덮인다', !!(await until(() => page.$('.stage-still'), 3000)));
  await page.mouse.click(tp.x, tp.y);
  await page.keyboard.up('Control');
  if (!(await until(() => page.$('.popover-card .composer'), 5000))) {
    // 드물게 첫 피커가 잡히지 않는다(원인 미확인) — 한 번 더 해 보고 기록한다
    console.log('  ! 첫 피커가 잡히지 않아 다시 시도합니다');
    await ctrlPick(page, tp);
  }
  await page.waitForSelector('.popover-card .composer');
  check('작성 창이 대상 옆 팝업으로 뜬다', true);
  await page.click('.popover-card .composer .cm-content');
  await page.keyboard.type('설비정보 탭 — **OHT-01** 기본 선택');
  await page.keyboard.press('Control+Enter');
  const c1 = await until(() => comments('SCR-001').find((c: { body: string }) => c.body.includes('OHT-01')), 8000);
  check('저장을 누르지 않아도 comments.json 에 들어간다', !!c1);
  check('Comment 에 달 때 화면(shot)이 붙는다', !!c1?.shot?.sha && existsSync(join(WS, 'blobs', c1.shot.sha.slice(0, 2), c1.shot.sha)));
  await page.click('.popover-card button[aria-label="닫기"]');
  await page.click('.cards > .card:first-child .card-title');
  check('Comment 를 열면 달 때 화면과 박스가 보인다', !!(await until(() => page.$('.shot-view .shot-box'), 3000)));
  await page.screenshot({ path: resolve(OUT, 'b3-shot.png') });
  await page.click('.badge-btn:has-text("지금 화면 보기")');
  check('"지금 화면 보기" 로 돌아간다', !(await page.$('.shot-view')));

  console.log('\n[3b] FAB 조망 → BAY-4 상세 맵 Comment — 누르면 그 화면으로');
  await page.keyboard.press('Escape');
  f = await screenFrame(page);
  const fabAt = await until(() => f.evaluate(() => {
    const h = (0, eval)('typeof FB !== "undefined" ? FB.hit : null') as { x: number; y: number }[] | null;
    const r = document.querySelector('#fabStage')!.getBoundingClientRect();
    return h && { x: r.left + h.reduce((a, q) => a + q.x, 0) / h.length, y: r.top + h.reduce((a, q) => a + q.y, 0) / h.length };
  }).catch(() => null), 10000);
  check('BAY-4 구역을 찾는다', !!fabAt);
  if (fabAt) {
    const inA = () => f.evaluate(() => !document.querySelector('#viewA')?.hasAttribute('hidden')).catch(() => false);
    const fp = await stagePoint(page, fabAt.x, fabAt.y);
    await page.mouse.move(fp.x, fp.y);
    await page.mouse.click(fp.x, fp.y);
    check('BAY-4 를 누르면 상세 맵', !!(await until(inA, 3000)));
    const iso = await f.evaluate(() => { const b = document.querySelector('#iso')!.getBoundingClientRect(); return { x: b.x + b.width * 0.45, y: b.y + b.height * 0.45 }; });
    await ctrlPick(page, await stagePoint(page, iso.x, iso.y));
    await page.waitForSelector('.popover-card .composer');
    await page.click('.popover-card .composer .cm-content');
    await page.keyboard.type('상세 맵 — 차량 라벨이 겹칩니다');
    await page.keyboard.press('Control+Enter');
    const cIso = await until(() => comments('SCR-001').find((c: { body: string }) => c.body.includes('상세 맵')), 8000);
    check('상세 맵 Comment 에 FAB 클릭 경로가 남는다', !!cIso?.anchor?.path?.some((st: { fp: { id?: string } }) => st.fp.id === 'fabCv'), JSON.stringify(cIso?.anchor?.path?.map((st: { fp: { id?: string } }) => st.fp.id)));
    await page.keyboard.press('Escape');
    await f.click('#backFab');
    check('FAB 로 돌아왔다', !!(await until(async () => !(await inA()), 3000)));
    await page.click('.cards > .card:nth-child(2) .card-title');
    const back = await until(async () => {
      f = await screenFrame(page);
      return (await inA()) && !(await page.$('.stage-note'));
    }, 30000);
    const marks = await page.$$eval('.marker', (ms) => ms.filter((m) => (m as HTMLElement).style.display === 'flex').map((m) => m.textContent));
    check('Comment 를 누르면 FAB → BAY-4 를 다시 눌러 상세 맵으로 간다', !!back && marks.includes('2'), JSON.stringify(marks));
    await page.screenshot({ path: resolve(OUT, 'b3b-bay4.png') });
    await page.keyboard.press('Escape');
  }

  console.log('\n[4] 원본 폴더가 바뀌면');
  appendFileSync(join(SRC, 'index.html'), '\n<!-- 수정 -->\n');
  const toast = await until(() => page.$('.toast:has-text("원본 폴더가 바뀌었습니다")'), 10000);
  check('새 버전 등록을 권한다', !!toast);
  if (toast) {
    await page.click('.toast .toast-btn');
    check('누르면 새 버전 등록 창이 열린다', !!(await until(() => page.$('.modal h2:has-text("새 버전")'), 5000)));
    await page.click('.modal button:has-text("취소")');
  }

  console.log('\n[5] URL 화면 — 편집기 안에서 실시간');
  await page.click('button[aria-label="화면 추가"]');
  await page.click('.popover-item:has-text("URL")');
  await page.fill('.modal input[aria-label="주소"]', SITE);
  await page.click('.modal button[type=submit]');
  const wv = await until(() => page.$('webview.stage-webview'), 5000);
  check('webview 로 실제 사이트를 띄운다', !!wv);
  await until(async () => !(await page.$('.stage-note')), 30000);
  // 지도(shadow DOM 안의 캔버스)가 그려질 때까지
  await until(() => page.evaluate(() => (document.querySelector('webview') as unknown as { executeJavaScript(c: string): Promise<boolean> })
    .executeJavaScript('!!document.querySelector("xms-fe-map-monitor")?.shadowRoot?.querySelector("canvas")')).catch(() => false), 30000);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: resolve(OUT, 'b5-site-live.png') });
  const live = await page.evaluate(async () => {
    const w = document.querySelector('webview') as unknown as { executeJavaScript(c: string): Promise<unknown> };
    return w.executeJavaScript('({ map: !!document.querySelector("xms-fe-map-monitor"), agent: !!window.__terrAgent })');
  }) as { map: boolean; agent: boolean };
  check('사이트 지도와 에이전트가 들어 있다', live.map && live.agent, JSON.stringify(live));
  // 지도 위 영역에 Comment
  await ctrlPick(page, await stagePoint(page, 800, 450), await stagePoint(page, 1100, 650));
  await page.waitForSelector('.popover-card .composer');
  await page.click('.popover-card .composer .cm-content');
  await page.keyboard.type('지도 — 이 구역 차량 아이콘이 겹칩니다');
  await page.keyboard.press('Control+Enter');
  const c2 = await until(() => comments('SCR-002')[0], 8000);
  check('URL 화면 Comment 에도 달 때 화면이 붙는다', !!c2?.shot?.sha);
  check('지도 위 드래그는 지도 요소 안의 영역으로 잡힌다', !!c2?.anchor?.region && /xms-fe-map-monitor/i.test(c2?.anchor?.fp?.tag ?? ''), c2?.anchor?.fp?.tag);
  const snap = await until(() => {
    const sj = existsSync(join(WS, 'screens', 'SCR-002', 'screen.json')) ? readJson(join(WS, 'screens', 'SCR-002', 'screen.json')) : null;
    const ext = sj?.versions?.[0]?.external ?? [];
    return ext.some((e: { url: string }) => e.url.startsWith('https://terr.shot/')) ? ext : null;
  }, 20000);
  check('보낸 파일용 사본 — 지도 같은 shadow DOM·캔버스는 픽셀로 담긴다', !!snap, snap ? `리소스 ${snap.length}개` : '');
  await page.screenshot({ path: resolve(OUT, 'b5-site-comment.png') });

  console.log('\n[5b] 여러 페이지 화면 — index.html → detail.html');
  await nextOpen(app, MULTI);
  await page.click('button[aria-label="화면 추가"]');
  await page.click('.popover-item:has-text("화면 폴더 선택")');
  await page.waitForSelector('.file-list');
  await page.click('.modal button[type=submit]');
  f = await screenFrame(page);
  await f.waitForSelector('#toDetail');
  await f.click('#toDetail');
  const onDetail = await until(async () => {
    const fr = await screenFrame(page);
    return (await fr.$('#detailBox')) ? fr : null;
  }, 10000);
  check('화면 안의 링크로 다른 페이지(detail.html)로 간다', !!onDetail);
  check('화면 머리에 지금 페이지가 보인다', ((await page.textContent('.sc-page').catch(() => '')) ?? '').includes('detail.html'));
  if (onDetail) {
    f = onDetail;
    const db = await f.evaluate(() => { const b = document.querySelector('#detailBox')!.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    await ctrlPick(page, await stagePoint(page, db.x, db.y));
    await page.waitForSelector('.popover-card .composer');
    await page.click('.popover-card .composer .cm-content');
    await page.keyboard.type('상세 페이지의 상자');
    await page.keyboard.press('Control+Enter');
    const cm = await until(() => comments('SCR-003')[0], 8000);
    check('Comment 에 페이지(detail.html)가 남는다', cm?.anchor?.page === 'detail.html', cm?.anchor?.page);
    await page.keyboard.press('Escape');
    await page.click('.sc-page');
    const home = await until(async () => {
      const fr = await screenFrame(page);
      return (await fr.$('#toDetail')) ? fr : null;
    }, 10000);
    check('머리의 경로를 누르면 첫 페이지로', !!home);
    await page.click('.cards > .card:first-child .card-title');
    const again = await until(async () => {
      const fr = await screenFrame(page);
      if (!(await fr.$('#detailBox'))) return false;
      const ms = await page.$$eval('.marker', (m) => m.filter((x) => (x as HTMLElement).style.display === 'flex').length);
      return ms === 1;
    }, 15000);
    check('다른 페이지의 Comment 를 누르면 그 페이지로 가서 마커가 붙는다', !!again);
    await page.screenshot({ path: resolve(OUT, 'b5b-multipage.png') });
    await page.keyboard.press('Escape');
  }

  console.log('\n[5c] 그림 화면 (png)');
  await nextOpen(app, IMG);
  await page.click('button[aria-label="화면 추가"]');
  await page.click('.popover-item:has-text("그림")');
  await until(async () => (await page.getAttribute('.tab.is-on', 'data-id').catch(() => '')) === 'SCR-004', 10000);
  check('그림이 화면(SCR-004)으로 들어와 새 탭으로 열린다', (await page.getAttribute('.tab.is-on', 'data-id')) === 'SCR-004');
  check('실행 상태가 "그림" — 일시정지·녹화가 없다', ((await page.textContent('.sc-state')) ?? '').includes('그림') && !(await page.$('.sc-bar button[aria-label="화면 일시정지"]')));
  const ib = (await (await page.$('.stage-frame'))!.boundingBox())!;
  await ctrlPick(page, { x: ib.x + ib.width * 0.5, y: ib.y + ib.height * 0.5 });
  await page.waitForSelector('.popover-card .composer');
  await page.click('.popover-card .composer .cm-content');
  await page.keyboard.type('로고 가운데');
  await page.keyboard.press('Control+Enter');
  const ci = await until(() => comments('SCR-004')[0], 8000);
  check('그림 위 클릭은 박스(영역) Comment 가 된다', !!ci?.anchor?.region, JSON.stringify(ci?.anchor?.region));
  await page.keyboard.press('Escape');
  await page.screenshot({ path: resolve(OUT, 'b5c-image.png') });

  console.log('\n[5d] 탭');
  check('등록한 화면마다 탭이 열려 있다', (await page.$$('.tabs .tab')).length === 4, `${(await page.$$('.tabs .tab')).length}개`);
  await page.click('.tab[data-id="SCR-004"] .tab-x');
  check('× 로 탭을 닫으면 옆 탭으로', (await page.$$('.tabs .tab')).length === 3 && (await page.getAttribute('.tab.is-on', 'data-id')) === 'SCR-003');
  await page.click('.tab[data-id="SCR-001"] .tab-main');
  check('탭을 눌러 화면을 바꾼다', !!(await until(async () => (await page.getAttribute('.tab.is-on', 'data-id')) === 'SCR-001' && !!(await page.$('iframe.stage-iframe')), 5000)));
  await openScreen(page, 'SCR-004');
  check('화면 목록에서 고르면 탭으로 다시 열린다', (await page.$$('.tabs .tab')).length === 4 && (await page.getAttribute('.tab.is-on', 'data-id')) === 'SCR-004');

  console.log('\n[6] 다른 이름으로 저장');
  await nextSave(app, EXPORT);
  await page.click('button[aria-label="다른 이름으로 저장"]');
  check('다른 이름으로 저장 — .terr.html 이 붙는다', !!(await until(() => existsSync(EXPORT + '.terr.html'), 8000)));

  console.log('\n[7] 받는 사람이 보는 URL 화면');
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(2500);
  const dist = join(WS, 'dist', distFile()!);
  const browser = await chromium.launch({ executablePath: CHROME });
  const rp = await (await browser.newContext({ viewport: { width: 1600, height: 960 } })).newPage();
  await rp.goto(pathToFileURL(dist).href);
  await rp.fill('.modal input', '수신자');
  await rp.click('.modal button[type=submit]');
  await openScreen(rp, 'SCR-002');
  const rf = await screenFrame(rp);
  await rp.waitForTimeout(1500);
  const map = await rf.evaluate(() => {
    const el = document.querySelector('xms-fe-map-monitor') as HTMLElement | null;
    return el ? getComputedStyle(el).backgroundImage.slice(0, 12) : 'none';
  });
  check('지도 자리에 사본 그림이 들어 있다 (빈칸이 아니다)', map.startsWith('url("blob:'), map);
  const marks = await rp.$$eval('.marker', (ms) => ms.filter((m) => (m as HTMLElement).style.display === 'flex').length);
  check('받은 문서에서도 지도 Comment 마커가 붙는다', marks >= 1, `${marks}개`);
  await rp.screenshot({ path: resolve(OUT, 'b7-recipient-site.png') });
  await browser.close();

  console.log('\n[8] 돌아온 문서 병합');
  const { doc, blobs } = parseManna(readFileSync(dist, 'utf8'));
  const s1 = doc.screens.find((s) => s.id === 'SCR-001')!;
  const base = s1.annotations[0];
  s1.annotations.push({ ...JSON.parse(JSON.stringify(base)), id: crypto.randomUUID(), body: '회신 — 이 탭 이름 확인했습니다', author: '수신자', replies: [], shot: undefined });
  base.replies.push({ id: crypto.randomUUID(), author: '수신자', at: new Date().toISOString(), body: '네, 반영해 주세요' });
  doc.origin = { by: '수신자', at: new Date().toISOString(), baseUpdatedAt: doc.meta.updatedAt };
  const runtime = { js: readFileSync('out/manna/manna-runtime.js', 'utf8'), css: readFileSync('out/manna/manna-runtime.css', 'utf8') };
  writeFileSync(join(WS, 'returned', 'proto_수신자.terr.html'), serializeManna(doc, blobs, runtime));
  const badge = await until(() => page.$('.tb-returned'), 10000);
  check('returned/ 에 넣으면 "회신 1" 이 뜬다', !!badge);
  if (badge) {
    await badge.click();
    await page.click('.popover-returned button:has-text("병합")');
    await openScreen(page, 'SCR-001');
    const merged = await until(() => comments('SCR-001').length === 3 && comments('SCR-001')[0].replies.length === 1, 8000);
    check('병합 — Comment 추가와 답글이 들어온다', !!merged);
    check('병합한 회신본은 returned/merged/ 로', existsSync(join(WS, 'returned', 'merged', 'proto_수신자.terr.html')));
  }

  check('렌더러 오류가 없다', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log('\n[9] 다시 켜면 이어서');
  await openScreen(page, 'SCR-002');
  await page.waitForTimeout(1500);
  await app.close();
  ({ app, page } = await launch());
  check('마지막 작업 폴더가 그대로 열린다', !!(await until(async () => ((await page.textContent('.tb-place').catch(() => '')) ?? '').includes(WS.split(/[\\/]/).pop()!), 15000)));
  check('마지막으로 보던 화면(SCR-002)으로', !!(await until(async () => (await page.getAttribute('.tab.is-on', 'data-id').catch(() => '')) === 'SCR-002', 10000)));
  check('Comment 가 그대로 있다', (await page.$$('.cards > .card')).length === 1);

  console.log('\n[10] 테라리움 문서가 든 폴더 열기 — 풀어서 작업 폴더로');
  mkdirSync(UNPACK, { recursive: true });
  cpSync(dist, join(UNPACK, 'proto_받은.terr.html'));
  await nextOpen(app, UNPACK);
  await page.click('button[aria-label="작업 폴더 · 문서"]');
  await page.click('.popover-item:has-text("폴더 열기")');
  check('문서를 풀어 terrarium.json 을 만든다', !!(await until(() => existsSync(join(UNPACK, 'terrarium.json')), 10000)));
  check('화면이 모두 풀린다', !!(await until(() => existsSync(join(UNPACK, 'screens')) && readdirSync(join(UNPACK, 'screens')).length === 4, 8000)),
    existsSync(join(UNPACK, 'screens')) ? readdirSync(join(UNPACK, 'screens')).join(',') : '');
  check('툴바가 그 폴더를 가리킨다', !!(await until(async () => ((await page.textContent('.tb-place')) ?? '').includes('unpack-ws'), 5000)));
  await app.close();

  for (const d of [WS, SRC, UD]) rmSync(d, { recursive: true, force: true });
  console.log(failed ? `\n실패 ${failed}건` : '\n모두 통과');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
