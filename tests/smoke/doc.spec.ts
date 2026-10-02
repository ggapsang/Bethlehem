/* 문서(받는 사람 브라우저) 스모크 — 기능마다 따로, 새 브라우저 맥락에서 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseManna, serializeManna } from '../../packages/core/src';
import {
  DOC, OUT, cardCount, check, ctrlPick, menuVisible, onTop, openDoc, pagePoint, screenFrame, typeIn, until, visibleMarkers, type Spec,
} from './lib';

const M = 'packages/manna/src/';
const shared = [/^packages\/manna\/src\/(store|App|keys)\.tsx?$/, /^packages\/manna\/src\/styles\.css$/, /^packages\/core\/src\/types\.ts$/];

export const docSpecs: Spec[] = [
  {
    name: 'doc-boot',
    kind: 'doc',
    files: [/^packages\/manna\/src\/(main|host|idb)\.tsx?$/, /^packages\/manna\/src\/stage\/(loader|shim|bridge)\./, /^packages\/core\//, /^scripts\/bake/],
    async run() {
      const { page, f, errors } = await openDoc();
      check('문서가 열리고 품은 화면이 뜬다', !!f);
      check('찾지 못한 파일이 없다', (await f.evaluate(() => (window as unknown as { __manna: { misses: unknown[] } }).__manna.misses.length)) === 0);
      check('다크 테마가 기본', (await page.getAttribute('html', 'data-theme')) === 'dark');
      check('페이지 오류가 없다', errors.length === 0, errors.slice(0, 2).join(' | '));
    },
  },
  {
    name: 'doc-comment',
    kind: 'doc',
    files: [new RegExp(`^${M}(ui/(Popover|Panel|labels)|actions|keys)\\.tsx?$`), new RegExp(`^${M}ui/editor/`), new RegExp(`^${M}stage/Stage\\.tsx$`), ...shared],
    async run() {
      const { page, f } = await openDoc();
      await ctrlPick(page, await pagePoint(page, f, '#tabB'));
      await page.fill('.composer .title-input', '탭 이름');
      await typeIn(page, '.composer .cm-content', '- [ ] 띄어쓰기');
      await page.keyboard.press('Control+Enter');
      await until(async () => (await cardCount(page)) === 1, 3000);
      check('제목 · 본문 Comment 가 생긴다', (await cardCount(page)) === 1);
      check('카드 첫 줄에 제목, 둘째 줄에 이름', ((await page.textContent('.card .card-name')) ?? '') === '탭 이름' && ((await page.textContent('.card .author')) ?? '') === '검증봇');
      check('마커 옆 이름표', (await page.getAttribute('.marker', 'data-label')) === '탭 이름 · 검증봇');
      // 제목만
      await ctrlPick(page, await pagePoint(page, f, '#tabC'));
      await page.fill('.composer .title-input', '제목만');
      await page.keyboard.press('Control+Enter');
      check('제목만 있어도 단다', !!(await until(async () => (await cardCount(page)) === 2, 3000)));
      // Delete · 되돌리기 — 방금 단 Comment 가 골라져 있다
      check('방금 단 Comment 가 골라져 있다', !!(await page.$('.cards > .card:nth-child(2).is-sel')));
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Delete');
      check('Delete 로 지운다', !!(await until(async () => (await cardCount(page)) === 1, 3000)));
      await page.keyboard.press('Control+z');
      check('Ctrl+Z 로 되살린다', !!(await until(async () => (await cardCount(page)) === 2, 3000)));
    },
  },
  {
    name: 'doc-popover',
    kind: 'doc',
    files: [new RegExp(`^${M}ui/Popover\\.tsx$`), ...shared],
    async run() {
      const { page, f } = await openDoc();
      await ctrlPick(page, await pagePoint(page, f, '#fabCv', 0.3, 0.3), await pagePoint(page, f, '#fabCv', 0.45, 0.5));
      check('작성 창이 화면 영역에 갇히지 않고 "추가" 단추까지 보인다', await onTop(page, '.popover-card .composer .btn-primary'));
      const b0 = (await (await page.$('.popover-card'))!.boundingBox())!;
      const h = (await (await page.$('.popover-card .pop-drag strong'))!.boundingBox())!;
      await page.mouse.move(h.x + 5, h.y + 5);
      await page.mouse.down();
      await page.mouse.move(h.x - 140, h.y + 70, { steps: 6 });
      await page.mouse.up();
      const b1 = (await (await page.$('.popover-card'))!.boundingBox())!;
      check('머리줄을 끌어 옮긴다', b1.x < b0.x - 100 && b1.y > b0.y + 40, `${Math.round(b0.x)},${Math.round(b0.y)} → ${Math.round(b1.x)},${Math.round(b1.y)}`);
      check('모서리로 크기를 바꿀 수 있다', (await page.$eval('.popover-card', (el) => getComputedStyle(el).resize)) === 'both');
      check('옮긴 뒤에도 "추가" 단추가 보인다', await onTop(page, '.popover-card .composer .btn-primary'));
    },
  },
  {
    name: 'doc-panel',
    kind: 'doc',
    files: [new RegExp(`^${M}ui/Panel\\.tsx$`), new RegExp(`^${M}actions\\.ts$`), new RegExp(`^${M}ui/editor/`), ...shared],
    async run() {
      const { page } = await openDoc();
      check('자유 노트는 기본으로 접혀 있다', !(await page.$('.notes .cm-content')));
      await page.click('.notes .section-head');
      await page.waitForSelector('.notes .cm-content');
      const ratio = await page.evaluate(() => document.querySelector('.notes')!.getBoundingClientRect().height / document.querySelector('.panel')!.getBoundingClientRect().height);
      check('펼치면 패널의 절반', ratio > 0.42 && ratio < 0.6, ratio.toFixed(2));
      const nh = () => page.evaluate(() => document.querySelector('.notes')!.getBoundingClientRect().height);
      const h0 = await nh();
      const sp = (await (await page.$('.notes-splitter'))!.boundingBox())!;
      await page.mouse.move(sp.x + sp.width / 2, sp.y + sp.height / 2);
      await page.mouse.down();
      await page.mouse.move(sp.x + sp.width / 2, sp.y - 120, { steps: 5 });
      await page.mouse.up();
      check('사이 손잡이로 높이를 바꾼다', (await nh()) < h0 - 80);
      await page.dblclick('.notes-splitter');
      check('더블클릭하면 절반', Math.abs((await nh()) - h0) < 4);
      await page.click('.note-tab-add');
      await page.fill('.note-tab-input', '회의록');
      await page.keyboard.press('Enter');
      await page.click('.notes .cm-content');
      await page.keyboard.type('회의 메모');
      await page.click('.note-tab-main:has-text("개요")');
      await page.click('.note-tab-main:has-text("회의록")');
      check('노트 탭 — 더하고 이름 짓고 따로 쓴다', ((await page.textContent('.notes .cm-content')) ?? '').includes('회의 메모'));
      let asked = '';
      page.once('dialog', (dg) => {
        asked = dg.message();
        dg.accept();
      });
      await page.click('.note-tab:has-text("회의록") .note-tab-x');
      check('노트 탭 × — 한 번 묻고 지운다', asked.includes('회의록') && !!(await until(async () => (await page.$$('.note-tab')).length === 1, 2000)));
      page.once('dialog', (dg) => dg.accept());
      await page.hover('.note-tab:has-text("개요")');
      await page.click('.note-tab:has-text("개요") .note-tab-x');
      check('하나 남은 탭을 지우면 내용만 비운다', !!(await until(async () => ((await page.textContent('.notes .cm-content')) ?? '').trim() === '' || !!(await page.$('.notes .cm-placeholder')), 2000)));
      await page.keyboard.press('Control+z');
      await page.click('.comments .section-head');
      check('Comment 도 접힌다', !(await page.$('.cards')));
    },
  },
  {
    name: 'doc-view',
    kind: 'doc',
    files: [new RegExp(`^${M}stage/(Stage|StageHeader|ScreenTabs)\\.tsx$`), new RegExp(`^${M}ui/Toolbar\\.tsx$`), ...shared],
    async run() {
      const { page } = await openDoc();
      check('탭 줄 · 화면 목록', (await page.$$('.tabs .tab')).length >= 1 && (await menuVisible(page, '화면 목록')));
      check('마커 색 메뉴가 잘리지 않는다', await menuVisible(page, '마커 색'));
      const fw = async () => (await (await page.$('.stage-frame'))!.boundingBox())!.width;
      const w0 = await fw();
      await page.click('button[aria-label="확대"]');
      await page.click('button[aria-label="확대"]');
      check('확대하면 커지고 스크롤', (await fw()) > w0 * 1.1 && !!(await page.$('.stage.stage-scroll')));
      await page.click('.zoom-val');
      check('배율 칸 → 맞춤', Math.abs((await fw()) - w0) < 2);
      await page.click('.seg-btn:has-text("꽉 채움")');
      await page.waitForTimeout(300);
      const s = (await (await page.$('.stage'))!.boundingBox())!;
      const fb = (await (await page.$('.stage-frame'))!.boundingBox())!;
      check('꽉 채움 — 탭을 가득', Math.abs(fb.width - s.width) < 3 && Math.abs(fb.height - s.height) < 3);
      await page.click('.seg-btn:has-text("여백")');
    },
  },
  {
    name: 'doc-fullscreen',
    kind: 'doc',
    files: [new RegExp(`^${M}App\\.tsx$`), new RegExp(`^${M}stage/StageHeader\\.tsx$`), new RegExp(`^${M}ui/Toolbar\\.tsx$`), /^packages\/manna\/src\/styles\.css$/],
    async run() {
      const { page } = await openDoc();
      await page.click('button[aria-label="전체화면"]');
      await page.waitForTimeout(400);
      const op = () => page.$eval('.stage-top', (el) => getComputedStyle(el).opacity);
      check('그 화면만 — 툴바 · 탭 없음, 막대는 숨음', !(await page.$('.toolbar')) && !(await page.isVisible('.tabs')) && (await op()) === '0');
      await page.mouse.move(800, 3);
      check('위쪽 끝 → 화면 막대', !!(await until(async () => (await op()) === '1', 2000)));
      await page.mouse.move(700, 500);
      const vw = await page.evaluate(() => innerWidth);
      await page.mouse.move(vw - 3, 400);
      await page.waitForTimeout(200);
      check('오른쪽 끝 → 패널이 뜬다', !!(await page.$('.panel-float .panel')));
      await page.click('.panel-float button[aria-label="패널 고정"]');
      check('고정하면 옆에 붙는다', !!(await until(() => page.$('.panel-dock .panel'), 2000)));
      await page.click('.panel-dock button[aria-label="패널 고정 풀기"]');
      await page.keyboard.press('Escape');
    },
  },
  {
    name: 'doc-reveal',
    kind: 'doc',
    files: [new RegExp(`^${M}agent/`), new RegExp(`^${M}stage/(Stage|MarkerStrip)\\.tsx$`), /^packages\/core\/src\/(fingerprint|anchor)/],
    async run() {
      const { page } = await openDoc();
      let f = await screenFrame(page);
      await f.click('#tabB');
      await page.waitForTimeout(500);
      await ctrlPick(page, await pagePoint(page, f, '#eqFleetRadar'));
      await typeIn(page, '.composer .cm-content', '설비정보 탭');
      await page.keyboard.press('Control+Enter');
      await page.keyboard.press('Escape');
      await f.click('#tabC');
      await page.waitForTimeout(500);
      check('다른 탭이면 마커가 숨고 마커 줄에 "다른 상태"', !(await visibleMarkers(page)).length && !!(await page.$('.mk-list .mk-other')));
      await page.click('.cards > .card:first-child .card-title');
      const inB = await until(() => f.evaluate(() => !document.querySelector('#viewB')?.hasAttribute('hidden')), 15000);
      check('누르면 그 탭으로 간다', !!inB && (await visibleMarkers(page)).length === 1);
      f = await screenFrame(page);
    },
  },
  {
    name: 'doc-save',
    kind: 'doc',
    files: [/^packages\/manna\/src\/(host|idb|store)\.ts$/, /^packages\/manna\/src\/stage\/ScreenTabs\.tsx$/, /^packages\/core\/src\/(manna-file|merge)\.ts$/],
    async run() {
      const { page, f } = await openDoc();
      await ctrlPick(page, await pagePoint(page, f, '#tabB'));
      await typeIn(page, '.composer .cm-content', '저장 확인');
      await page.keyboard.press('Control+Enter');
      await page.waitForTimeout(1500);
      const dl = page.waitForEvent('download');
      await page.click('.toolbar .split-main');
      const d = await dl;
      const saved = join(OUT, 'smoke-saved.terr.html');
      await d.saveAs(saved);
      check('저장 이름에 내 이름이 붙는다', /_검증봇\.terr\.html$/.test(d.suggestedFilename()), d.suggestedFilename());
      const re = await openDoc(saved, '다른사람');
      check('다시 열면 Comment 가 남아 있다', (await cardCount(re.page)) === 1);
      // (버그 재현) 이 브라우저에 예전 판의 초안이 있는데, 작성자가 새 판을 보냈다.
      // 새 판은 작성자의 새 Comment 를 담고 있고, 판 시각은 초안보다 이르다 — 예전에는 초안이 이겨 새 Comment 가 사라졌다
      const { doc: nd, blobs } = parseManna(readFileSync(DOC, 'utf8'));
      nd.meta.updatedAt = new Date(Date.parse(nd.meta.updatedAt) + 1000).toISOString();
      const t = nd.meta.updatedAt;
      nd.screens.push({ ...JSON.parse(JSON.stringify(nd.screens[0])), id: 'SCR-002', title: '새 판에 더한 화면', annotations: [] });
      nd.screens[0].annotations.push({ id: 'author-new', version: nd.screens[0].versions.at(-1)!.v, title: '작성자 새 Comment', body: '', author: '기획자', createdAt: t, updatedAt: t, replies: [], history: [] });
      const newer = join(OUT, 'smoke-newer.terr.html');
      writeFileSync(newer, serializeManna(nd, blobs, { js: readFileSync('out/manna/manna-runtime.js', 'utf8'), css: readFileSync('out/manna/manna-runtime.css', 'utf8') }));
      const p2 = await page.context().newPage();
      await p2.goto(pathToFileURL(newer).href);
      await screenFrame(p2);
      await p2.waitForTimeout(1500);
      const names = await p2.$$eval('.card .card-name', (els) => els.map((e) => e.textContent ?? ''));
      const tabIds = await p2.$$eval('.tabs .tab', (t) => t.map((x) => (x as HTMLElement).dataset.id));
      check('새 판에 더해진 화면은 저절로 탭으로 열린다 (이 브라우저가 기억한 탭에 없어도)', tabIds.includes('SCR-002'), JSON.stringify(tabIds));
      check('새 판을 열면 작성자의 새 Comment 가 보이고, 이 브라우저에서 단 것도 합쳐진다', names.includes('작성자 새 Comment') && names.some((n) => n.includes('저장 확인')), JSON.stringify(names));
    },
  },
  {
    name: 'doc-record',
    kind: 'doc',
    files: [/^packages\/manna\/src\/stage\/record\.ts$/, /^packages\/manna\/src\/actions\.ts$/],
    async run() {
      const { page } = await openDoc();
      await page.click('button[aria-label="화면 녹화"]');
      await page.waitForSelector('.btn-icon.is-rec');
      await page.waitForTimeout(1200);
      await page.click('button[aria-label="녹화 멈추기"]');
      const v = await until(() => page.$('.popover-card .clip video'), 10000);
      const w = v ? await v.evaluate(async (el) => {
        const x = el as HTMLVideoElement;
        if (x.readyState < 1) await new Promise((r) => x.addEventListener('loadedmetadata', r, { once: true }));
        return x.videoWidth;
      }) : 0;
      check('녹화한 클립이 붙고 재생된다', w > 0, `폭 ${w}px`);
    },
  },
];
