/* 스모크 테스트 공용 — 문서(브라우저)와 작성 프로그램(Electron)을 띄우고 화면을 다루는 도구 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron, chromium, type Browser, type ElectronApplication, type Frame, type Page } from 'playwright-core';

export const ROOT = resolve('.');
export const OUT = resolve('out/smoke');
export const DOC = resolve('out/e2e/proto.terr.html');
export const SITE = 'http://semicon-xms.xdt.com/monitor';
export const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => p && existsSync(p))!;

/* ── 결과 ─────────────────────────────────────────────────────────── */
export const results: { spec: string; name: string; ok: boolean; detail: string }[] = [];
let current = '';
export function setSpec(name: string): void {
  current = name;
}
export function check(name: string, ok: boolean, detail = ''): void {
  results.push({ spec: current, name, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function until<T>(fn: () => T | Promise<T>, ms = 15000): Promise<T | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    await wait(150);
  }
  return null;
}

/* ── 스테이지 ─────────────────────────────────────────────────────── */
export async function screenFrame(page: Page): Promise<Frame> {
  for (let i = 0; i < 300; i++) {
    const h = await page.$('iframe.stage-iframe:not(.is-hidden)');
    const f = h && (await h.contentFrame());
    if (f && (await f.evaluate(() => !!(window as unknown as { __manna?: unknown }).__manna).catch(() => false))) return f;
    await page.waitForTimeout(100);
  }
  throw new Error('품은 화면이 뜨지 않았습니다');
}
export const splashDone = (f: Frame) =>
  f.waitForFunction(() => document.querySelector('#splash')?.classList.contains('done'), null, { timeout: 30000 }).then(() => true, () => false);

/** iframe 안 요소의 창 좌표 (스테이지 축소 반영) */
export async function pagePoint(page: Page, f: Frame, sel: string, fx = 0.5, fy = 0.5) {
  const box = (await (await page.$('.stage-frame'))!.boundingBox())!;
  const vw = await f.evaluate(() => innerWidth);
  const r = await f.evaluate((s) => {
    const b = document.querySelector(s)!.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }, sel);
  const scale = box.width / vw;
  return { x: box.x + (r.x + r.w * fx) * scale, y: box.y + (r.y + r.h * fy) * scale };
}
/** 화면 뷰포트 좌표 → 창 좌표 */
export async function stagePoint(page: Page, x: number, y: number) {
  const box = (await (await page.$('.stage-frame'))!.boundingBox())!;
  const s = box.width / 1920;
  return { x: box.x + x * s, y: box.y + y * s };
}

export const visibleMarkers = (page: Page) => page.$$eval('.marker', (ms) => ms.filter((m) => (m as HTMLElement).style.display === 'flex').map((m) => m.textContent));
export const cardCount = (page: Page) => page.$$eval('.cards > .card', (cs) => cs.length);

/** Ctrl 누른 채 클릭 — to 를 주면 드래그. 작성 창이 안 뜨면 한 번 더 */
export async function ctrlPick(page: Page, p: { x: number; y: number }, to?: { x: number; y: number }) {
  const once = async () => {
    await page.mouse.move(p.x, p.y);
    await page.keyboard.down('Control');
    await page.waitForTimeout(350);
    if (to) {
      await page.mouse.down();
      await page.mouse.move((p.x + to.x) / 2, (p.y + to.y) / 2, { steps: 4 });
      await page.mouse.move(to.x, to.y, { steps: 4 });
      await page.mouse.up();
    } else await page.mouse.click(p.x, p.y);
    await page.keyboard.up('Control');
  };
  await once();
  if (!(await until(() => page.$('.popover-card .composer'), 5000))) await once();
  await page.waitForSelector('.popover-card .composer');
}

export async function typeIn(page: Page, sel: string, text: string) {
  await page.click(sel);
  await page.keyboard.type(text);
}

/** 펼침 메뉴가 잘리지 않고 실제로 보이는가 */
export async function menuVisible(page: Page, label: string): Promise<boolean> {
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
  await page.click(`button[aria-label="${label}"]`);
  return ok;
}

/** 그 요소가 다른 것에 가리지 않고 창 안에 보이는가 */
export const onTop = (page: Page, sel: string) =>
  page.evaluate((q) => {
    const el = document.querySelector(q) as HTMLElement | null;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return r.bottom <= innerHeight && r.right <= innerWidth && !!t && el.contains(t);
  }, sel);

/* ── 문서(브라우저) ───────────────────────────────────────────────── */
let browser: Browser | null = null;
/** 새 브라우저 맥락(저장소 비움)으로 문서를 연다 */
export async function openDoc(file = DOC, name = '검증봇'): Promise<{ page: Page; f: Frame; errors: string[] }> {
  browser ??= await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 960 }, acceptDownloads: true });
  await ctx.addInitScript(() => {
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
  await page.goto(pathToFileURL(file).href);
  if (await page.waitForSelector('.modal input', { timeout: 5000 }).catch(() => null)) {
    await page.fill('.modal input', name);
    await page.click('.modal button[type=submit]');
  }
  const f = await screenFrame(page);
  await splashDone(f);
  return { page, f, errors };
}
export async function closeBrowser(): Promise<void> {
  await browser?.close();
  browser = null;
}

/* ── 작성 프로그램(Electron) ─────────────────────────────────────── */
export interface AppCtx {
  app: ElectronApplication;
  page: Page;
  ud: string;
  ws: string;
  src: string;
}
export function tempDir(prefix: string): string {
  mkdirSync(OUT, { recursive: true });
  return mkdtempSync(join(tmpdir(), `terr-${prefix}-`));
}
export async function launchApp(ud: string, grant: string[]): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: [ROOT], cwd: ROOT, env: { ...process.env, BETHLEHEM_E2E_GRANT: [...grant, OUT].join(';'), BETHLEHEM_USER_DATA: ud } });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}
export const nextOpen = (app: ElectronApplication, ps: string | string[]) =>
  app.evaluate(({ dialog }, d) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: d })) as typeof dialog.showOpenDialog;
  }, Array.isArray(ps) ? ps : [ps]);

/** 새 작업 폴더 + proto 화면 하나 — 대부분의 작성 프로그램 스모크의 출발점 */
export async function appWithScreen(opts: { screen?: boolean } = {}): Promise<AppCtx> {
  const ud = tempDir('ud');
  const ws = tempDir('ws');
  const src = tempDir('src');
  cpSync(resolve('example/proto'), src, { recursive: true, filter: (p) => !/[\\/](screens|blobs|dist|returned)([\\/]|$)|terrarium\.json$/.test(p.slice(resolve('example/proto').length)) });
  const { app, page } = await launchApp(ud, [ws, src]);
  await page.waitForSelector('.modal input');
  await page.fill('.modal input', '기획자');
  await page.click('.modal button[type=submit]');
  await nextOpen(app, ws);
  await page.click('.welcome button:has-text("폴더 열기")');
  await until(() => existsSync(join(ws, 'terrarium.json')), 10000);
  if (opts.screen !== false) {
    await nextOpen(app, src);
    await page.click('.welcome button:has-text("화면 폴더 추가")');
    await page.waitForSelector('.file-list');
    await page.click('.modal button[type=submit]');
    const f = await screenFrame(page);
    await splashDone(f);
  }
  return { app, page, ud, ws, src };
}

export const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
export const comments = (ws: string, id: string) => (existsSync(join(ws, 'screens', id, 'comments.json')) ? readJson(join(ws, 'screens', id, 'comments.json')) : []);

/** 화면을 연다 — 탭이 있으면 그 탭, 없으면 화면 목록에서 */
export async function openScreen(p: Page, id: string) {
  if (await p.$(`.tab[data-id="${id}"]`)) await p.click(`.tab[data-id="${id}"] .tab-main`);
  else {
    await p.click('button[aria-label="화면 목록"]');
    await p.click(`.popover-item[data-id="${id}"]`);
  }
  await p.waitForTimeout(300);
}

/* ── 스펙 ─────────────────────────────────────────────────────────── */
export interface Spec {
  name: string;
  /** 'doc' 은 구운 문서를 브라우저로, 'app' 은 작성 프로그램 */
  kind: 'doc' | 'app';
  /** 이 파일들이 바뀌면 돈다 (저장소 기준 경로) */
  files: RegExp[];
  /** 네트워크(테스트 사이트)가 필요한가 */
  net?: boolean;
  run(): Promise<void>;
}
