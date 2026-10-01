/* Bethlehem E2E — 빌드된 Electron 앱을 띄워 화면 등록 → 어노테이션 → 새 버전 → 저장까지.
 * 파일 대화상자는 메인 프로세스에서 바꿔 끼운다. docs/ARCHITECTURE.md §9 Phase 0 완료 기준 1·6.
 *
 *   npm run test:e2e:app
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { _electron as electron, type Frame, type Page } from 'playwright-core';
import { isManna, parseManna } from '../packages/core/src';

const ROOT = resolve('.');
const PROTO = resolve('example/proto');
const OUT = resolve('out/e2e');
const SAVED = resolve(OUT, 'bethlehem.manna.html');

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

async function main() {
  rmSync(SAVED, { force: true });
  const app = await electron.launch({
    args: [ROOT],
    cwd: ROOT,
    env: { ...process.env, BETHLEHEM_E2E_GRANT: `${PROTO};${OUT}`, BETHLEHEM_USER_DATA: mkdtempSync(resolve(tmpdir(), 'bethlehem-e2e-')), ELECTRON_RENDERER_URL: '' },
  });
  const pickFolder = (dir: string) =>
    app.evaluate(({ dialog }, d) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [d] })) as typeof dialog.showOpenDialog;
    }, dir);
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: p })) as typeof dialog.showSaveDialog;
  }, SAVED);

  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1600, height: 1000 }).catch(() => {});

  console.log('\n[1] 첫 화면');
  await page.waitForSelector('.modal input');
  await page.fill('.modal input', '기획자');
  await page.click('.modal button[type=submit]');
  check('키 아트가 있는 첫 화면이 뜬다', !!(await page.$('.welcome-art')));
  await page.screenshot({ path: resolve(OUT, 'b1-welcome.png') });

  console.log('\n[2] 화면 등록');
  await pickFolder(PROTO);
  await page.click('.welcome .btn-primary');
  await page.waitForSelector('.file-list');
  const hold = await page.$$eval('.file-list .chip.st-hold', (cs) => cs.length);
  check('안 쓰는 파일에 "미참조 추정" 표시', hold >= 3, `${hold}개`);
  check('README.md 가 설명 문서로 잡힌다', !!(await page.$('.file-list .chip.st-done')));
  check('외부 리소스(Pretendard)가 목록에 있다', /pretendard/i.test((await page.textContent('.modal')) ?? ''));
  await page.screenshot({ path: resolve(OUT, 'b2-import.png') });
  await page.click('.modal button[type=submit]');
  let f = await screenFrame(page);
  const splash = await f.waitForFunction(() => document.querySelector('#splash')?.classList.contains('done'), null, { timeout: 30000 }).then(() => true, () => false);
  check('등록한 화면이 Bethlehem 안에서 동작한다', splash);
  check('사이드바에 SCR-001 v1', /SCR-001/.test((await page.textContent('.sidebar')) ?? ''));

  console.log('\n[3] 어노테이션');
  await page.click('.seg-btn:has-text("어노테이션")');
  const box = (await (await page.$('iframe.stage-iframe'))!.boundingBox())!;
  const r = await f.evaluate(() => {
    const b = document.querySelector('#tabB')!.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  const s = box.width / 1920;
  await page.mouse.move(box.x + r.x * s, box.y + r.y * s);
  await page.mouse.click(box.x + r.x * s, box.y + r.y * s);
  await page.fill('.composer textarea', '설비정보 확인 탭 — 진입 시 OHT-01 이 기본 선택됩니다.');
  await page.click('.composer .btn-primary');
  await page.waitForTimeout(300);
  check('작성자가 단 항목은 번호 1 을 받는다', ((await page.textContent('.card .no')) ?? '') === '1');

  console.log('\n[4] 새 버전');
  await pickFolder(PROTO);
  await page.click('.sb-add');
  await page.waitForSelector('.file-list');
  await page.selectOption('.modal select >> nth=0', 'index - old.html');
  await page.waitForTimeout(500);
  check('기존 어노테이션 옮기기 선택지가 있다', !!(await page.$('.modal label:has-text("새 버전으로 옮기기")')));
  await page.click('.modal button[type=submit]');
  f = await screenFrame(page);
  await page.waitForTimeout(1500);
  check('v2 가 선택된다', ((await page.textContent('.sb-ver.is-active')) ?? '') === 'v2');
  check('옮긴 어노테이션이 v2 에서 보인다', (await page.$$('.card')).length === 1);

  console.log('\n[5] 저장');
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(1500);
  check('Manna 파일이 저장된다', existsSync(SAVED));
  if (existsSync(SAVED)) {
    const html = readFileSync(SAVED, 'utf8');
    const { doc, blobs } = parseManna(html);
    check('저장한 파일이 Manna 형식이다', isManna(html));
    check('화면 1개 · 버전 2개 · 어노테이션 1개', doc.screens.length === 1 && doc.screens[0].versions.length === 2 && doc.screens[0].annotations.length === 1);
    const v1 = doc.screens[0].versions[0].files['data/ad7.js']?.sha;
    const v2 = doc.screens[0].versions[1].files['data/ad7.js']?.sha;
    check('두 버전이 데이터 블롭을 공유한다', !!v1 && v1 === v2, `블롭 ${blobs.size}개 · ${(html.length / 1024 / 1024).toFixed(1)}MB`);
  }
  check('창 제목에 저장 안 됨 표시가 없다', !(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).includes('•'));
  await page.screenshot({ path: resolve(OUT, 'b3-saved.png') });

  check('렌더러 오류가 없다', errors.length === 0, errors.slice(0, 3).join(' | '));
  await app.close();
  console.log(failed ? `\n실패 ${failed}건` : '\n모두 통과');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
