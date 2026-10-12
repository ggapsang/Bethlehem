/* 문서(받는 사람 브라우저) 스모크 — 기능마다 따로, 새 브라우저 맥락에서 */
import { execSync } from 'node:child_process';
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
      await page.fill('.composer .assignee-input', '한재준');
      await typeIn(page, '.composer .cm-content', '- [ ] 띄어쓰기');
      await page.keyboard.press('Control+Enter');
      await until(async () => (await cardCount(page)) === 1, 3000);
      check('제목 · 본문 Comment 가 생긴다', (await cardCount(page)) === 1);
      check('카드 첫 줄에 제목, 둘째 줄에 쓴 사람 → 담당', ((await page.textContent('.card .card-name')) ?? '') === '탭 이름' && ((await page.textContent('.card .card-meta')) ?? '').startsWith('검증봇→한재준'), (await page.textContent('.card .card-meta')) ?? '');
      check('마커 옆 이름표에도 담당', (await page.getAttribute('.marker', 'data-label')) === '탭 이름 · 검증봇 → 한재준');
      await page.fill('.popover-card .detail .assignee-input', '김민수');
      await page.press('.popover-card .detail .assignee-input', 'Tab');
      check('팝업에서 담당을 바꾼다', !!(await until(async () => ((await page.textContent('.card .assignee')) ?? '') === '김민수', 2000)));
      check('담당은 고르기 목록에 남는다', !!(await page.$('#terr-people option[value="김민수"]')));
      // 제목만
      await ctrlPick(page, await pagePoint(page, f, '#tabC'));
      await page.fill('.composer .title-input', '제목만');
      await page.keyboard.press('Control+Enter');
      check('제목만 있어도 단다', !!(await until(async () => (await cardCount(page)) === 2, 3000)));
      // Delete · 되돌리기 — 방금 단 Comment 가 골라져 있다
      check('방금 단 Comment 가 골라져 있다', !!(await page.$('.cards > .card:nth-child(2).is-sel')));
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.waitForTimeout(200); // 작성 창이 닫히며 포커스가 정리될 시간
      const pre = await page.evaluate(() => { const e = document.activeElement as HTMLElement; return [e?.tagName, e?.getAttribute('aria-label'), e?.isConnected]; });
      await page.keyboard.press('Delete');
      const delOk = !!(await until(async () => (await cardCount(page)) === 1, 3000));
      check('Delete 로 지운다', delOk, delOk ? '' : JSON.stringify(pre));
      await page.keyboard.press('Control+z');
      check('Ctrl+Z 로 되살린다', !!(await until(async () => (await cardCount(page)) === 2, 3000)));
      // 완료 — 지우지 않고 숨긴다. 번호는 다시 매기지 않는다
      await page.click('.cards > .card:first-child .done-check');
      check('완료를 체크하면 카드가 숨는다', !!(await until(async () => (await cardCount(page)) === 1, 3000)));
      check('남은 Comment 의 번호는 그대로 (2번)', ((await page.textContent('.cards > .card:first-child .no')) ?? '') === '2');
      check('완료한 것은 화면 마커 · 마커 줄에서도 숨는다', !(await visibleMarkers(page)).includes('1') && !(await page.$('.mk-list .mk:has-text("1")')));
      check('"완료 1 보기" 가 뜬다', ((await page.textContent('.done-toggle')) ?? '').includes('완료 1'));
      await page.click('.done-toggle');
      check('완료 보기 — 다시 보이고 완료로 표시된다', !!(await until(async () => (await cardCount(page)) === 2, 2000)) && !!(await page.$('.cards > .card:first-child.is-done .done-check:checked')));
      await page.click('.cards > .card:first-child .done-check');
      check('체크를 풀면 완료가 풀린다', !(await page.$('.card.is-done')) && !(await page.$('.done-toggle')));
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
    serial: true,
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
    name: 'doc-pick-afterimage',
    kind: 'doc',
    files: [new RegExp(`^${M}stage/Stage\\.tsx$`), new RegExp(`^${M}agent/`)],
    async run() {
      // 움직이는 도중에 Ctrl 을 떼도 — 늦게 온 hover 답이 피커 박스를 다시 그려 잔상으로 남지 않는다
      const { page, f } = await openDoc();
      const shown = () => page.$eval('.hl-pick', (b) => getComputedStyle(b).display !== 'none');
      const a = await pagePoint(page, f, '#tabB');
      const b = await pagePoint(page, f, '#tabC');
      let left = 0;
      for (let i = 0; i < 8; i++) {
        await page.mouse.move(a.x, a.y + 200);
        await page.keyboard.down('Control');
        await page.waitForTimeout(400);
        const moving = page.mouse.move(b.x + 200, b.y + 300, { steps: 30 });
        await page.waitForTimeout(30);
        await page.keyboard.up('Control');
        await moving;
        await page.waitForTimeout(500);
        if (await shown()) left++;
      }
      check('움직이는 도중에 Ctrl 을 떼도 피커 박스가 남지 않는다', left === 0, `${left}/8 남음`);
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
      const inB = await until(async () => (await f.evaluate(() => !document.querySelector('#viewB')?.hasAttribute('hidden'))) && (await visibleMarkers(page)).length === 1, 15000);
      check('누르면 그 탭으로 간다', !!inB);
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
      nd.screens.push({ ...JSON.parse(JSON.stringify(nd.screens[0])), id: 'SCR-003', title: '작성자가 숨긴 화면', annotations: [] });
      // 작성자가 정한 탭 배치 — 순서를 뒤집고 하나는 숨겼다
      nd.meta.tabs = { open: ['SCR-002', 'SCR-001'], hidden: ['SCR-003'] };
      nd.screens[0].annotations.push({ id: 'author-new', version: nd.screens[0].versions.at(-1)!.v, title: '작성자 새 Comment', body: '', author: '기획자', createdAt: t, updatedAt: t, replies: [], history: [] });
      const newer = join(OUT, 'smoke-newer.terr.html');
      writeFileSync(newer, serializeManna(nd, blobs, { js: readFileSync('out/manna/manna-runtime.js', 'utf8'), css: readFileSync('out/manna/manna-runtime.css', 'utf8') }));
      const p2 = await page.context().newPage();
      await p2.goto(pathToFileURL(newer).href);
      await screenFrame(p2);
      await p2.waitForTimeout(1500);
      await p2.click('.tab[data-id="SCR-001"] .tab-main');
      await p2.waitForTimeout(300);
      const names = await p2.$$eval('.card .card-name', (els) => els.map((e) => e.textContent ?? ''));
      const tabIds = await p2.$$eval('.tabs .tab', (t) => t.map((x) => (x as HTMLElement).dataset.id));
      check('예전 판을 연 적 있는 브라우저도 새 판은 작성자의 탭 순서 · 숨김 그대로', tabIds.join(',') === 'SCR-002,SCR-001', JSON.stringify(tabIds));
      // 받는 사람이 직접 바꾼 것은 다시 열어도 남는다
      await p2.click('.tab[data-id="SCR-001"] .tab-main', { button: 'middle' });
      const p3 = await page.context().newPage();
      await p3.goto(pathToFileURL(newer).href);
      await screenFrame(p3);
      await p3.waitForTimeout(800);
      check('받는 사람이 숨긴 탭은 다시 열어도 숨겨져 있다', (await p3.$$eval('.tabs .tab', (t) => t.map((x) => (x as HTMLElement).dataset.id))).join(',') === 'SCR-002');
      await p3.close();
      // 작성자가 배치를 또 바꿔 보냈다 — 그것을 따른다
      nd.meta.tabs = { open: ['SCR-001', 'SCR-003'], hidden: ['SCR-002'] };
      const newest = join(OUT, 'smoke-newest.terr.html');
      writeFileSync(newest, serializeManna(nd, blobs, { js: readFileSync('out/manna/manna-runtime.js', 'utf8'), css: readFileSync('out/manna/manna-runtime.css', 'utf8') }));
      const p4 = await page.context().newPage();
      await p4.goto(pathToFileURL(newest).href);
      await screenFrame(p4);
      await p4.waitForTimeout(800);
      check('작성자가 배치를 바꿔 다시 보내면 그것을 따른다', (await p4.$$eval('.tabs .tab', (t) => t.map((x) => (x as HTMLElement).dataset.id))).join(',') === 'SCR-001,SCR-003');
      await p4.close();
      await p2.click('button[aria-label="화면 목록"]');
      await p2.click('button[aria-label="SCR-001 탭 보이기"]');
      await p2.click('button[aria-label="화면 목록"]');
      // 현재 탭만 저장 — 저장 옆 단추를 펼쳐서
      await p2.click('.tab[data-id="SCR-002"] .tab-main');
      await p2.click('button[aria-label="저장 방식"]');
      const items = await p2.$$eval('.save-menu .popover-item', (els) => els.map((e) => e.getAttribute('aria-label')));
      check('저장 옆 단추를 누르면 다른 이름으로 저장 · 현재 탭만 저장 · 원본 파일 내려받기', items.join(',') === '다른 이름으로 저장,현재 탭만 저장,원본 파일 내려받기', items.join(','));
      const dl2 = p2.waitForEvent('download');
      await p2.click('.save-menu button[aria-label="현재 탭만 저장"]');
      const one = join(OUT, 'smoke-one-tab.terr.html');
      await (await dl2).saveAs(one);
      const oneDoc = parseManna(readFileSync(one, 'utf8')).doc;
      check('현재 탭만 저장 — 그 화면 하나만 담긴다 (문서 id 는 그대로)', oneDoc.screens.length === 1 && oneDoc.screens[0]!.id === 'SCR-002' && oneDoc.id === nd.id, oneDoc.screens.map((s) => s.id).join(','));
      check('새 판을 열면 작성자의 새 Comment 가 보이고, 이 브라우저에서 단 것도 합쳐진다', names.includes('작성자 새 Comment') && names.some((n) => n.includes('저장 확인')), JSON.stringify(names));
    },
  },
  {
    name: 'doc-pins',
    kind: 'doc',
    files: [/^packages\/manna\/src\/stage\/(Pins|Stage|StageHeader)\.tsx$/, /^packages\/manna\/src\/(actions|keys|store)\.ts$/, /^packages\/core\/src\/(types|merge)\.ts$/],
    async run() {
      const { page, f } = await openDoc();
      const frameBox = async () => (await (await page.$('.stage-frame'))!.boundingBox())!;
      const pinBox = async () => (await (await page.$('.pin .pin-icon'))!.boundingBox())!;
      await page.click('button[aria-label="핀 꽂기"]');
      check('핀 꽂기를 누르면 화면에 꽂을 자리가 뜬다', !!(await page.$('.pin-place')));
      const fb = await frameBox();
      const at = { x: fb.x + fb.width * 0.4, y: fb.y + fb.height * 0.5 };
      await page.mouse.click(at.x, at.y);
      await page.waitForSelector('.pin-input');
      await page.click('.pin-input');
      await page.keyboard.type('입구');
      await page.keyboard.press('Enter');
      check('누른 자리에 핀이 박히고 이름을 단다', ((await page.textContent('.pin .pin-name')) ?? '') === '입구');
      const tip = async () => { const b = await pinBox(); return { x: b.x + b.width / 2, y: b.y + b.height }; };
      const t0 = await tip();
      check('핀 끝이 누른 점을 가리킨다', Math.abs(t0.x - at.x) < 4 && Math.abs(t0.y - at.y) < 6, `${Math.round(t0.x - at.x)},${Math.round(t0.y - at.y)}`);
      // 화면 내용이 바뀌어도 그 자리
      await f.click('#tabB');
      await page.waitForTimeout(400);
      const t1 = await tip();
      check('화면 내용이 바뀌어도(탭 전환) 핀은 그 자리', Math.abs(t1.x - t0.x) < 1 && Math.abs(t1.y - t0.y) < 1);
      // 확대하면 화면과 같이 움직인다 — 프레임 안의 비율 자리는 그대로
      const rel = async () => { const b = await frameBox(); const t = await tip(); return { x: (t.x - b.x) / b.width, y: (t.y - b.y) / b.height }; };
      const r0 = await rel();
      await page.click('button[aria-label="확대"]');
      await page.click('button[aria-label="확대"]');
      await page.waitForTimeout(200);
      const r1 = await rel();
      check('확대하면 화면과 같이 움직인다 (화면 안의 자리는 그대로)', Math.abs(r1.x - r0.x) < 0.01 && Math.abs(r1.y - r0.y) < 0.01);
      await page.click('.zoom-val');
      await page.waitForTimeout(200);
      // 끌어서 옮기기
      const tA = await tip();
      await page.mouse.move(tA.x, tA.y - 12);
      await page.mouse.down();
      await page.mouse.move(tA.x + 120, tA.y + 40, { steps: 6 });
      await page.mouse.up();
      const tB = await tip();
      check('끌어서 옮긴다', tB.x > tA.x + 100 && tB.y > tA.y + 25);
      // 화살표
      await page.click('button[aria-label="화살표 꽂기"]');
      await page.mouse.click(fb.x + fb.width * 0.6, fb.y + fb.height * 0.3);
      await page.waitForSelector('.pin-input');
      await page.click('.pin-input');
      await page.keyboard.press('Enter');
      check('화살표 모양도 꽂는다 (이름 없이도)', (await page.$$('.pin')).length === 2 && !!(await page.$('.pin.pin-nav')));
      // 골라서 Delete
      check('방금 꽂은 화살표가 골라져 있다', !!(await page.$('.pin.pin-nav.is-sel')));
      await page.keyboard.press('Escape');
      check('Esc 로 고르기를 푼다', !(await page.$('.pin.is-sel')));
      await page.click('.pin.pin-nav .pin-icon');
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Delete');
      check('골라서 Delete 로 지운다', !!(await until(async () => (await page.$$('.pin')).length === 1, 2000)));
      await page.keyboard.press('Control+z');
      check('Ctrl+Z 로 되살린다', !!(await until(async () => (await page.$$('.pin')).length === 2, 2000)));
      // 박스 보이기
      await f.click('#tabC');
      await page.waitForTimeout(300);
      await ctrlPick(page, await pagePoint(page, f, '#tabB'));
      await typeIn(page, '.composer .cm-content', '박스');
      await page.keyboard.press('Control+Enter');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.mouse.move(5, 300);
      const allShown = () => page.$$eval('.box-layer .hl-all', (bs) => bs.filter((b) => (b as HTMLElement).style.display === 'block').length);
      check('박스는 기본으로 숨어 있다', (await allShown()) === 0);
      await page.click('button[aria-label="박스 보이기"]');
      check('박스 보이기 — 대상 박스가 실선으로 늘 보인다', !!(await until(async () => (await allShown()) === 1, 2000)) && (await page.$eval('.hl-all', (el) => getComputedStyle(el).borderTopStyle)) === 'solid');
      // 저장하고 다시 열면 핀이 남는다
      await page.waitForTimeout(1300);
      const dl = page.waitForEvent('download');
      await page.click('.toolbar .split-main');
      const saved = join(OUT, 'smoke-pins.terr.html');
      await (await dl).saveAs(saved);
      const re = await openDoc(saved, '다른사람');
      check('저장하고 다시 열어도 핀과 이름이 남는다', (await re.page.$$('.pin')).length === 2 && ((await re.page.textContent('.pin .pin-name')) ?? '') === '입구');
      // 원본 파일 내려받기 (zip)
      await re.page.click('button[aria-label="저장 방식"]');
      const dz = re.page.waitForEvent('download');
      await re.page.click('.save-menu button[aria-label="원본 파일 내려받기"]');
      const z = await dz;
      const zp = join(OUT, 'smoke-source.zip');
      await z.saveAs(zp);
      const list = execSync(`python -c "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(chr(10).join(z.namelist()))" "${zp}"`, { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
      check('원본 파일 내려받기 — 원래 폴더 모양 그대로 zip (풀리고 CRC 가 맞는다)', /원본\.zip$/.test(z.suggestedFilename()) && list.includes('index.html') && list.some((n) => n.startsWith('data/')), `${list.length}개: ${list.slice(0, 4).join(', ')}`);
    },
  },
  {
    name: 'doc-record',
    kind: 'doc',
    files: [/^packages\/manna\/src\/stage\/(record|longrec|webm)\.ts$/, /^packages\/manna\/src\/ui\/RecEditor\.tsx$/, /^packages\/manna\/src\/actions\.ts$/],
    async run() {
      const { page } = await openDoc();
      await page.click('button[aria-label="화면 녹화"]');
      await page.waitForSelector('.btn-icon.is-rec');
      await page.waitForTimeout(1200);
      await page.click('button[aria-label="녹화 멈추기"]');
      // 멈추면 편집기 — 1분이 안 되면 통째로 한 구간이 잡혀 있어 바로 넣는다
      check('멈추면 녹화 편집기 (브라우저에서도)', !!(await until(() => page.$('.rec-edit'), 10000)));
      await page.click('.rec-apply');
      const v = await until(() => page.$('.popover-card .clip video'), 10000);
      const w = v ? await v.evaluate(async (el) => {
        const x = el as HTMLVideoElement;
        if (x.readyState < 1) await new Promise((r) => x.addEventListener('loadedmetadata', r, { once: true }));
        return x.videoWidth;
      }) : 0;
      check('녹화한 클립이 붙고 재생된다', w > 0, `폭 ${w}px`);
    },
  },
  {
    name: 'doc-nested-frame',
    kind: 'doc',
    files: [/^packages\/manna\/src\/stage\/(shim\.js|loader\.ts)$/, /^packages\/core\/src\/(pack|urls?)\.ts$/, /^tests\/smoke\/fixtures\/nested\//],
    async run() {
      // 패키지 안 다른 HTML 을 iframe 으로 띄우는 화면 — 정적 src · JS 로 넣는 한글 경로 src
      const file = join(OUT, 'nested.terr.html');
      execSync(`npx tsx scripts/bake.ts tests/smoke/fixtures/nested "${file}"`, { stdio: 'ignore' });
      const { page, f } = await openDoc(file);
      const inner = async (sel: string) => (await (await f.$(sel))?.contentFrame()) ?? null;
      const val = (fr: Awaited<ReturnType<typeof inner>>, expr: string) => (fr ? fr.evaluate(expr).catch(() => undefined) : undefined);
      const a = await until(async () => ((await val(await inner('#static'), 'window.A_OK')) ? true : null), 8000);
      check('정적 <iframe src="sub/a.html"> — 하위 페이지와 그 스크립트가 뜬다', !!a);
      await f.evaluate('openEam()');
      const eam = await until(async () => {
        const fr = await inner('#eam');
        const v = await val(fr, '({ db: window.EAM_DB && EAM_DB.rows, sync: window.EAM_SYNC, data: window.DATA && DATA.rows, ls: window.LS_OK, bg: getComputedStyle(document.body).backgroundColor, img: document.getElementById("logo") && document.getElementById("logo").naturalWidth })');
        const o = v as { db?: number; sync?: boolean; data?: number; ls?: unknown; bg?: string; img?: number } | undefined;
        return o && o.db === 3 && o.sync && o.data === 3 && o.img ? o : null;
      }, 10000);
      check('JS 로 넣은 iframe.src (한글 경로) — 하위 문서의 스크립트 · 동적 스크립트 · fetch 가 풀린다', !!eam, JSON.stringify(eam));
      check('하위 문서의 CSS · 상위 폴더 이미지(../assets)도 풀린다', eam?.bg === 'rgb(1, 2, 3)' && (eam?.img ?? 0) > 0, `${eam?.bg} · ${eam?.img}px`);
      check('하위 문서도 엔트리와 같은 origin — localStorage 가 된다', eam?.ls === true, String(eam?.ls));
      check('하위 → 엔트리 postMessage 가 닿는다', !!(await until(async () => ((await f.evaluate('window.got')) as string[]).includes('eam-ready') || null, 5000)));
      const src = await f.evaluate('document.getElementById("eam").src');
      check('iframe.src 를 읽으면 넣은 주소 그대로 (패키지 주소)', String(src).endsWith('/%EA%B8%B0%EC%A4%80%EC%A0%95%EB%B3%B4%EA%B4%80%EB%A6%AC/index.html'), String(src));
      // 하위 페이지 안의 링크 — 그 iframe 안에서 다음 페이지로
      await (await inner('#static'))!.click('#to-b');
      check('하위 페이지 안 링크는 그 iframe 안에서 넘어간다', !!(await until(async () => ((await val(await inner('#static'), 'window.B_OK')) ? true : null), 8000)));
      await f.evaluate('openMiss()');
      const miss = await until(async () => {
        const m = (await f.evaluate('window.__manna.misses.map(function (x) { return x.url; })')) as string[];
        return m.includes('없는/페이지.html') ? m : null;
      }, 5000);
      check('패키지에 없는 주소를 iframe 에 넣으면 misses 에 남는다', !!miss, (miss ?? []).join(', '));
      check('srcdoc 안 replaceState(주소 포함) 가 예외 없이 지나간다', (await f.evaluate('window.replaceOk')) === true, String(await f.evaluate('window.replaceOk')));
      const diag = await until(() => page.$('.stage-diag .diag-head'), 5000);
      if (diag) await diag.click();
      check('없는 파일 알림이 테라리움에도 뜬다 (자세히 → 파일 이름)', !!diag && ((await page.textContent('.stage-diag').catch(() => '')) ?? '').includes('없는/페이지.html'));
    },
  },
  {
    name: 'doc-nested-pick',
    kind: 'doc',
    files: [new RegExp(`^${M}agent/`), /^packages\/manna\/src\/stage\/shim\.js$/, /^packages\/core\/src\/(fingerprint|types)\.ts$/, /^tests\/smoke\/fixtures\/nested\//],
    async run() {
      // 하위 페이지(iframe) 안의 요소도 엔트리 요소처럼 — 고르기 · 마커 · 되돌아가기 · Ctrl · 일시정지
      const file = join(OUT, 'nested-pick.terr.html');
      execSync(`npx tsx scripts/bake.ts tests/smoke/fixtures/nested "${file}"`, { stdio: 'ignore' });
      const { page } = await openDoc(file);
      const f = await screenFrame(page);
      const eam = async () => (await (await (await screenFrame(page)).$('#eam'))?.contentFrame()) ?? null;
      /** iframe 안 요소 가운데의 창 좌표 */
      const nestedPoint = async (sel: string) => {
        const top = await screenFrame(page);
        const r = await (await eam())!.$eval(sel, (el) => {
          const b = el.getBoundingClientRect();
          return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        });
        const box = await top.$eval('#eam', (el) => {
          const b = el.getBoundingClientRect();
          return { w: b.width, h: b.height, cl: el.clientLeft, ct: el.clientTop };
        });
        return pagePoint(page, top, '#eam', (r.x + box.cl) / box.w, (r.y + box.ct) / box.h);
      };
      // 사람처럼 — 엔트리의 탭, 하위 문서의 하위 탭
      await f.click('#tabEam');
      await until(async () => ((await (await eam())?.evaluate('!!window.EAM_DB').catch(() => false)) ? true : null), 8000);
      await (await eam())!.click('#subDetail');
      await ctrlPick(page, await nestedPoint('#deep'));
      await page.fill('.composer .title-input', '하위 문서 버튼');
      await page.keyboard.press('Control+Enter');
      check('Comment 가 달리고 마커가 그 요소에 붙는다', !!(await until(async () => (await cardCount(page)) === 1 && (await visibleMarkers(page)).length === 1, 5000)));
      // 저장된 대상 — 자동 저장(브라우저 저장소)에서 읽는다
      const fp = await until(() => page.evaluate(() => new Promise<{ id?: string; frames?: { id?: string }[] } | null>((ok) => {
        const r = indexedDB.open('terrarium');
        r.onerror = () => ok(null);
        r.onsuccess = () => {
          const q = r.result.transaction('drafts').objectStore('drafts').getAll();
          q.onsuccess = () => {
            const a = (q.result as { doc: { screens: { annotations: { anchor?: { fp: { id?: string; frames?: { id?: string }[] } } }[] }[] } }[])
              .flatMap((d) => d.doc.screens.flatMap((x) => x.annotations)).find((x) => x.anchor);
            ok(a?.anchor?.fp ?? null);
            r.result.close();
          };
          q.onerror = () => ok(null);
        };
      })), 6000);
      check('iframe 안 요소를 고른다 — 대상은 그 요소, 거쳐 간 iframe 이 함께 적힌다', fp?.id === 'deep' && fp?.frames?.length === 1 && fp.frames[0].id === 'eam', JSON.stringify({ id: fp?.id, frames: fp?.frames?.map((x) => x.id) }));
      const mk = await page.$eval('.marker', (m) => {
        const b = m.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      });
      const at = await nestedPoint('#deep');
      check('마커 자리 — iframe 위치만큼 옮겨진 그 요소 곁', Math.abs(mk.x - at.x) < 120 && Math.abs(mk.y - at.y) < 60, `마커 ${Math.round(mk.x)},${Math.round(mk.y)} · 요소 ${Math.round(at.x)},${Math.round(at.y)}`);
      await page.keyboard.press('Escape');
      // 다른 탭으로 — 마커가 숨고, 카드를 누르면 탭 · 하위 탭을 다시 눌러 돌아온다
      await (await screenFrame(page)).click('#tabMon');
      check('다른 탭이면 마커가 숨는다', !!(await until(async () => (await visibleMarkers(page)).length === 0 || null, 3000)));
      await page.click('.cards > .card:first-child .card-title');
      check('카드를 누르면 기준정보 탭 → 상세 하위 탭까지 눌러 그 요소로 돌아간다', !!(await until(async () => (await visibleMarkers(page)).length === 1 || null, 20000)));
      await page.keyboard.press('Escape');
      // iframe 안에 포커스가 있어도 Ctrl 로 피커
      await (await eam())!.click('#tagInput');
      await page.keyboard.down('Control');
      const on = await until(() => page.$('.pick-layer'), 3000);
      await page.keyboard.up('Control');
      check('iframe 안 입력 칸에 포커스가 있어도 Ctrl 로 피커가 켜진다', !!on);
      // 일시정지 — iframe 안의 움직임도 멈춘다
      await page.click('button[aria-label="화면 일시정지"]');
      const fr = (await eam())!;
      const t1 = (await fr.evaluate('window.ticks')) as number;
      await page.waitForTimeout(400);
      const t2 = (await fr.evaluate('window.ticks')) as number;
      await page.click('button[aria-label="화면 재생"]');
      await page.waitForTimeout(300);
      const t3 = (await fr.evaluate('window.ticks')) as number;
      check('일시정지하면 iframe 안 움직임도 멈추고, 재생하면 다시 돈다', t1 === t2 && t3 > t2, `${t1} → ${t2} → ${t3}`);
    },
  },
  {
    name: 'doc-dynamic-assets',
    kind: 'doc',
    files: [/^packages\/manna\/src\/stage\/(shim\.js|loader\.ts)$/, /^tests\/smoke\/fixtures\/spa\//],
    async run() {
      // 화면 스크립트가 HTML 문자열(innerHTML · insertAdjacentHTML)로 넣은 그림도 패키지 파일로 뜬다
      const file = join(OUT, 'dynamic-assets.terr.html');
      execSync(`npx tsx scripts/bake.ts tests/smoke/fixtures/spa "${file}"`, { stdio: 'ignore' });
      const { f } = await openDoc(file);
      // 그 요소들의 상태 — 판정은 이쪽에서 (evaluate 안에 함수를 두면 번들된 이름 도우미 때문에 깨진다)
      const read = () => f.evaluate(() => Object.fromEntries([...document.querySelectorAll('#dyn [id]')].map((e) => [e.id, {
        w: (e as HTMLImageElement).complete ? (e as HTMLImageElement).naturalWidth : 0,
        bg: getComputedStyle(e).backgroundImage,
        href: e.getAttribute('href') ?? '',
      }])));
      type St = Awaited<ReturnType<typeof read>>;
      const imgsOk = (r: St) => ['dPng', 'dIco', 'dSet', 'dAdj'].every((id) => r[id]?.w > 0);
      const restOk = (r: St) => r.dBg?.bg.startsWith('url("blob:') && r.dCss?.bg.startsWith('url("blob:') && r.dSvg?.href.startsWith('blob:');
      const r = (await until(async () => {
        const x = await read();
        return imgsOk(x) && restOk(x) ? x : null;
      }, 6000)) ?? (await read());
      const misses = await f.evaluate(() => (window as unknown as { __manna: { misses: { url: string }[] } }).__manna.misses.map((m) => m.url));
      const brief = (ids: string[]) => ids.map((id) => `${id}:${r[id]?.w || r[id]?.bg.slice(0, 14) || r[id]?.href.slice(0, 8)}`).join(' ');
      check('innerHTML · insertAdjacentHTML 로 넣은 PNG · ICO · srcset 그림이 뜬다', imgsOk(r), brief(['dPng', 'dIco', 'dSet', 'dAdj']));
      check('나중에 바꾼 인라인 style · 넣은 <style> 의 url() · SVG image 도', !!restOk(r), brief(['dBg', 'dCss', 'dSvg']));
      check('못 찾은 파일 없음', misses.length === 0, misses.join(', '));
    },
  },
  {
    name: 'doc-same-slot',
    kind: 'doc',
    files: [new RegExp(`^${M}agent/`), /^packages\/core\/src\/(fingerprint|types)\.ts$/, /^tests\/smoke\/fixtures\/spa\//],
    async run() {
      // 메뉴마다 같은 자리에 다른 내용을 그리는 화면 — 마커는 고른 그 내용에만 붙는다
      const file = join(OUT, 'same-slot.terr.html');
      execSync(`npx tsx scripts/bake.ts tests/smoke/fixtures/spa "${file}"`, { stdio: 'ignore' });
      const { page } = await openDoc(file);
      const f = await screenFrame(page);
      await f.click('#goB');
      await f.click('#goA');
      await ctrlPick(page, await pagePoint(page, f, '.panel', 0.98, 0.5));
      await page.fill('.composer .title-input', '도면 상자');
      await page.keyboard.press('Control+Enter');
      check('Comment 가 달리고 마커가 보인다', !!(await until(async () => (await cardCount(page)) === 1 && (await visibleMarkers(page)).length === 1, 5000)));
      const fp = await until(() => page.evaluate(() => new Promise<{ tag?: string; text?: string; inner?: string } | null>((ok) => {
        const r = indexedDB.open('terrarium');
        r.onerror = () => ok(null);
        r.onsuccess = () => {
          const q = r.result.transaction('drafts').objectStore('drafts').getAll();
          q.onsuccess = () => {
            const a = (q.result as { doc: { screens: { annotations: { anchor?: { fp: { tag?: string; inner?: string } } }[] }[] } }[])
              .flatMap((d) => d.doc.screens.flatMap((x) => x.annotations)).find((x) => x.anchor);
            ok(a?.anchor?.fp ?? null);
            r.result.close();
          };
          q.onerror = () => ok(null);
        };
      })), 6000);
      check('글 없는 상자를 고르면 안쪽 글이 함께 적힌다', fp?.tag === 'div' && !fp.text && !!fp.inner?.startsWith('도면 파일'), JSON.stringify(fp && { tag: fp.tag, inner: fp.inner }));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(800);
      check('상자 안 숫자만 바뀌면 그대로 붙어 있다', (await visibleMarkers(page)).length === 1);
      await f.click('#goB');
      check('다른 메뉴(같은 자리 · 같은 클래스, 다른 내용)면 마커가 숨는다', !!(await until(async () => (await visibleMarkers(page)).length === 0 || null, 3000)));
      await f.click('#goC');
      await page.waitForTimeout(1200);
      check('상자는 그대로 두고 안쪽만 바꾼 메뉴에서도 숨는다', (await visibleMarkers(page)).length === 0);
      await page.click('.cards > .card:first-child .card-title');
      const back = await until(async () => ((await f.evaluate(() => document.querySelector('#goA')!.getAttribute('aria-current'))) === 'page' && (await visibleMarkers(page)).length === 1) || null, 15000);
      check('카드를 누르면 그 메뉴로 돌아가 마커가 다시 붙는다', !!back);
    },
  },
];
