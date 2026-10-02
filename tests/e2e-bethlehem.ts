/* Bethlehem E2E — 빌드된 Electron 앱으로 화면 등록 → Comment → 새 버전 → 녹화 → URL 담기 → 저장 → 최근 목록.
 * 파일 대화상자는 메인 프로세스에서 바꿔 끼우고, URL 담기는 로컬 HTTP 서버로 확인한다.
 *
 *   npm run test:e2e:app
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { _electron as electron, type Frame, type Page } from 'playwright-core';
import { isManna, parseManna } from '../packages/core/src';

const ROOT = resolve('.');
const PROTO = resolve('example/proto');
const OUT = resolve('out/e2e');
const SAVED = resolve(OUT, 'bethlehem.terr.html');

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
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

/* URL 담기 확인용 — API 응답을 받아 그리는 작은 페이지 */
function startSite(): Promise<{ url: string; close: () => void }> {
  const pages: Record<string, [string, string]> = {
    '/': ['text/html', `<!doctype html><html><head><title>현장 대시보드</title><link rel="stylesheet" href="/app.css"></head>
<body><h1 id="title">대시보드</h1><ul id="list"></ul><canvas id="cv" width="80" height="40"></canvas>
<script src="/app.js"></script></body></html>`],
    '/app.css': ['text/css', 'body{font-family:sans-serif;background:#fafafa} h1{color:rgb(200, 50, 50)}'],
    '/app.js': ['text/javascript', `fetch('/api/items?site=1').then(r=>r.json()).then(d=>{document.getElementById('list').innerHTML=d.items.map(i=>'<li class="item">'+i+'</li>').join('');document.title='현장 대시보드 · '+d.items.length})
const c=document.getElementById('cv').getContext('2d');c.fillStyle='#3366ff';c.fillRect(0,0,80,40);`],
    '/api/items?site=1': ['application/json', JSON.stringify({ items: ['OHT-01 정상', 'OHT-02 경고', 'OHT-03 정상'] })],
  };
  const server = createServer((req, res) => {
    const hit = pages[req.url ?? '/'];
    if (!hit) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': `${hit[0]}; charset=utf-8` }).end(hit[1]);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as { port: number };
    ok({ url: `http://127.0.0.1:${port}/`, close: () => server.close() });
  }));
}

async function main() {
  rmSync(SAVED, { force: true });
  const site = await startSite();
  const app = await electron.launch({
    args: [ROOT],
    cwd: ROOT,
    env: { ...process.env, BETHLEHEM_E2E_GRANT: `${PROTO};${OUT}`, BETHLEHEM_USER_DATA: mkdtempSync(resolve(tmpdir(), 'bethlehem-e2e-')), ELECTRON_RENDERER_URL: '' },
  });
  const pickFolder = (dir: string) =>
    app.evaluate(({ dialog }, d) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [d] })) as typeof dialog.showOpenDialog;
    }, dir);
  // 확장자 없이 이름만 적은 경우 — .terr.html 이 붙어야 한다
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: p })) as typeof dialog.showSaveDialog;
  }, SAVED.replace(/\.terr\.html$/, ''));

  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  console.log('\n[1] 첫 화면');
  await page.waitForSelector('.modal input');
  await page.fill('.modal input', '기획자');
  await page.click('.modal button[type=submit]');
  check('키 아트가 있는 첫 화면이 뜬다', !!(await page.$('.welcome-art')));
  check('첫 화면에 소개 문구가 없다', !((await page.textContent('.welcome')) ?? '').includes('바이브'));
  check('왼쪽 패널이 없다', !(await page.$('.sidebar')));
  check('창 제목이 테라리움', (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).includes('테라리움'));
  await page.screenshot({ path: resolve(OUT, 'b1-welcome.png') });

  console.log('\n[2] 화면 등록');
  await pickFolder(PROTO);
  await page.click('.welcome .btn-primary');
  await page.waitForSelector('.file-list');
  const chips = (await page.textContent('.file-list')) ?? '';
  check('안 쓰는 파일에 "참조 없음" · "제외"', chips.includes('참조 없음') && chips.includes('제외'));
  check('README 는 개요로 가져온다', chips.includes('개요로 가져옴'));
  check('빠지는 파일에 취소선이 없다', await page.$eval('.file-list li.is-off .mono', (el) => getComputedStyle(el).textDecorationLine === 'none'));
  await page.screenshot({ path: resolve(OUT, 'b2-import.png') });
  await page.click('.modal button[type=submit]');
  let f = await screenFrame(page);
  check('등록한 화면이 동작한다', await f.waitForFunction(() => document.querySelector('#splash')?.classList.contains('done'), null, { timeout: 30000 }).then(() => true, () => false));
  check('개요에 README 가 들어온다', ((await page.textContent('.notes')) ?? '').includes('데이터 매핑'));

  console.log('\n[3] Comment');
  await page.click('.notes .section-head');
  const box = (await (await page.$('iframe.stage-iframe'))!.boundingBox())!;
  const r = await f.evaluate(() => {
    const b = document.querySelector('#tabB')!.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  const s = box.width / 1920;
  await page.mouse.move(box.x + r.x * s, box.y + r.y * s);
  await page.keyboard.down('Control');
  await page.mouse.click(box.x + r.x * s, box.y + r.y * s);
  await page.keyboard.up('Control');
  await page.click('.composer .cm-content');
  await page.keyboard.type('설비정보 확인 탭 — 진입 시 **OHT-01** 기본 선택');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(300);
  check('Comment 1번이 생긴다', ((await page.textContent('.card .no')) ?? '') === '1');

  console.log('\n[4] 녹화 (Electron 화면 공유)');
  await page.click('button[aria-label="화면 녹화"]');
  const recOn = await page.waitForSelector('.btn-icon.is-rec', { timeout: 8000 }).then(() => true, () => false);
  check('녹화가 시작된다 (권한 대화상자 없이)', recOn);
  await page.waitForTimeout(1500);
  if (recOn) await page.click('button[aria-label="녹화 멈추기"]');
  const clipW = await page.waitForSelector('.card.is-sel .clip video', { timeout: 8000 })
    .then((v) => v.evaluate(async (el) => {
      const vid = el as HTMLVideoElement;
      if (vid.readyState < 1) await new Promise((ok) => vid.addEventListener('loadedmetadata', ok, { once: true }));
      return vid.videoWidth;
    }), () => 0);
  check('클립이 Comment 에 붙고 재생된다', clipW > 0, `폭 ${clipW}px`);

  console.log('\n[5] 새 버전 — 툴바에서');
  await pickFolder(PROTO);
  await page.click('button[aria-label^="SCR-001 새 버전"]');
  await page.click('.popover-item:has-text("화면 폴더 선택")');
  await page.waitForSelector('.file-list');
  await page.selectOption('.modal select >> nth=0', 'index - old.html');
  await page.waitForTimeout(500);
  check('기존 Comment 옮기기 선택지가 있다', !!(await page.$('.modal label:has-text("새 버전으로 옮기기")')));
  await page.click('.modal button[type=submit]');
  f = await screenFrame(page);
  await page.waitForTimeout(1000);
  check('v2 가 선택된다', ((await page.$eval('select[aria-label="화면 버전"]', (el) => (el as HTMLSelectElement).value)) ?? '') === '2');
  check('옮긴 Comment 가 v2 에 있다', (await page.$$('.cards > .card')).length === 1);

  console.log('\n[6] 최근 폴더');
  await page.click('button[aria-label="화면 추가 — 폴더나 URL"]');
  await page.waitForSelector('.popover');
  check('화면 추가 메뉴에 최근 폴더가 보인다', ((await page.textContent('.popover')) ?? '').includes('proto'));
  await page.keyboard.press('Escape');
  await page.mouse.click(10, 500);

  console.log('\n[7] URL 로 담기');
  await page.click('button[aria-label="화면 추가 — 폴더나 URL"]');
  await page.click('.popover-item:has-text("URL 로 담기")');
  await page.fill('.modal input', site.url);
  await page.click('.modal button[type=submit]');
  // 담기 창이 응답을 다 받을 때까지
  let st: { count: number; loading: boolean } = { count: 0, loading: true };
  for (let i = 0; i < 60 && (st.loading || st.count < 3); i++) {
    await page.waitForTimeout(200);
    st = await app.evaluate(() => (globalThis as unknown as { __terrSnapshot?: { state(): { count: number; loading: boolean } } }).__terrSnapshot?.state() ?? { count: 0, loading: true });
  }
  check('담기 창이 페이지와 응답을 받는다', st.count >= 3, `응답 ${st.count}개`);
  await app.evaluate(() => (globalThis as unknown as { __terrSnapshot: { capture(m: string): Promise<void> } }).__terrSnapshot.capture('static'));
  await page.waitForTimeout(1500);
  check('URL 화면이 SCR-002 로 등록된다', ((await page.$eval('select[aria-label="화면"]', (el) => (el as HTMLSelectElement).value)) ?? '') === 'SCR-002');
  f = await screenFrame(page);
  const still = await f.evaluate(() => ({ items: document.querySelectorAll('.item').length, scripts: document.querySelectorAll('script:not(:first-child)').length, img: !!document.querySelector('img#cv') }));
  check('보이는 그대로 — 그린 결과가 정지 화면으로, 스크립트 없이, 캔버스는 이미지로', still.items === 3 && still.img, JSON.stringify(still));

  // 같은 화면의 새 버전으로 — 동작 포함
  await page.click('button[aria-label^="SCR-002 새 버전"]');
  await page.click('.popover-item:has-text("URL 로 담기")');
  await page.fill('.modal input', site.url);
  await page.click('.modal button[type=submit]');
  st = { count: 0, loading: true };
  for (let i = 0; i < 60 && (st.loading || st.count < 3); i++) {
    await page.waitForTimeout(200);
    st = await app.evaluate(() => (globalThis as unknown as { __terrSnapshot?: { state(): { count: number; loading: boolean } } }).__terrSnapshot?.state() ?? { count: 0, loading: true });
  }
  site.close(); // 이제 서버가 없어도 문서 안에서 돌아야 한다
  await app.evaluate(() => (globalThis as unknown as { __terrSnapshot: { capture(m: string): Promise<void> } }).__terrSnapshot.capture('live'));
  await page.waitForTimeout(1500);
  check('SCR-002 v2 로 들어간다', ((await page.$eval('select[aria-label="화면 버전"]', (el) => (el as HTMLSelectElement).value)) ?? '') === '2');
  f = await screenFrame(page);
  const items = await f.waitForFunction(() => document.querySelectorAll('.item').length, null, { timeout: 8000 }).then((h) => h.jsonValue(), () => 0);
  check('동작 포함 — 서버 없이 스크립트가 돌고, 담을 때 받은 API 응답이 재생된다', items === 3, `항목 ${items}개`);
  check('CSS 도 문서 안에서 적용된다', (await f.$eval('#title', (el) => getComputedStyle(el).color)) === 'rgb(200, 50, 50)');
  await page.screenshot({ path: resolve(OUT, 'b4-url.png') });

  console.log('\n[8] 저장 · 최근 문서');
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(1500);
  check('확장자가 .terr.html 로 붙어 저장된다', existsSync(SAVED));
  if (existsSync(SAVED)) {
    const html = readFileSync(SAVED, 'utf8');
    const { doc } = parseManna(html);
    check('테라리움 문서 형식', isManna(html));
    const s1 = doc.screens[0];
    check('SCR-001: 버전 2 · Comment 1 · 클립 1 · 개요', s1.versions.length === 2 && s1.annotations.length === 1 && (s1.annotations[0].clips?.length ?? 0) === 1 && s1.notes.length > 100);
    const s2 = doc.screens[1];
    check('SCR-002: URL 출처가 기록된다 (v1 보이는 그대로 · v2 동작 포함)', s2?.versions[0].source?.mode === 'static' && s2.versions[1]?.source?.mode === 'live' && s2.versions[1].entry.startsWith('http://127.0.0.1'));
    check('두 버전이 데이터 블롭을 공유한다', s1.versions[0].files['data/ad7.js']?.sha === s1.versions[1].files['data/ad7.js']?.sha, `${(html.length / 1024 / 1024).toFixed(1)}MB`);
  }
  check('창 제목에 저장 안 됨 표시가 없다', !(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).includes('•'));
  await page.click('button[aria-label="열기 · 최근 문서"]');
  await page.waitForSelector('.popover');
  check('열기 메뉴에 최근 문서가 보인다', ((await page.textContent('.popover')) ?? '').includes('bethlehem.terr.html'));
  await page.screenshot({ path: resolve(OUT, 'b5-recent.png') });

  check('렌더러 오류가 없다', errors.length === 0, errors.slice(0, 3).join(' | '));
  await app.close();
  console.log(failed ? `\n실패 ${failed}건` : '\n모두 통과');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
