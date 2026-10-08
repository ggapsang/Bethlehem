/* 스모크 — 바뀐 코드에 걸린 기능만 확인한다
 *
 *   npm run test:smoke                 바뀐 파일(git 기준: 커밋 안 한 것 + 마지막 커밋)에 걸린 것만
 *   npm run test:smoke -- doc-panel    이름으로 고르기 (여러 개 가능)
 *   npm run test:smoke -- --all        전부
 *   npm run test:smoke -- --list       무엇이 있는지만
 *   npm run test:smoke -- --dry        무엇이 걸리는지만 (돌리지 않는다)
 *   npm run test:smoke -- --jobs 2     한 번에 몇 개씩 (기본 4). 기능마다 따로 띄운 프로그램 · 작업 폴더를 쓰므로 함께 돌아도 된다
 *   npm run test:smoke -- --rebuild    코드가 그대로여도 다시 빌드 · 굽기
 *
 * 빠르게 — ① 여러 기능을 함께 돌린다(지난번에 오래 걸린 것부터, serial 인 것은 묶음이 끝난 뒤 혼자)
 *          ② 소스가 지난 빌드와 같으면 빌드 · 문서 굽기를 건너뛴다.
 *
 * 처음부터 끝까지 이어지는 회귀 테스트는 npm run test:e2e(문서) · test:e2e:app(작성 프로그램) — 내보내기 전에.
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appSpecs } from './app.spec';
import { docSpecs } from './doc.spec';
import { OUT, closeBrowser, inSpec, results, type Spec } from './lib';

const all: Spec[] = [...docSpecs, ...appSpecs];
const args = process.argv.slice(2);

function changedFiles(): string[] {
  const run = (c: string) => execSync(c, { encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean);
  const files = new Set<string>([
    ...run('git diff --name-only HEAD'),
    ...run('git ls-files --others --exclude-standard'),
  ]);
  // 아무것도 안 바뀌었으면 마지막 커밋에서 바뀐 것
  if (!files.size) for (const f of run('git diff --name-only HEAD~1 HEAD')) files.add(f);
  return [...files].map((f) => f.replace(/\\/g, '/'));
}

function pick(): { specs: Spec[]; why: Map<string, string[]> } {
  const why = new Map<string, string[]>();
  if (args.includes('--all')) return { specs: all, why };
  const named = args.filter((a) => !a.startsWith('--'));
  if (named.length) {
    const unknown = named.filter((n) => !all.some((s) => s.name === n));
    if (unknown.length) throw new Error(`없는 스모크: ${unknown.join(', ')} — --list 로 보세요`);
    return { specs: all.filter((s) => named.includes(s.name)), why };
  }
  const files = changedFiles().filter((f) => !/^(tests|docs\/(?!USER_GUIDE)|example)\//.test(f) || f.startsWith('tests/smoke/'));
  for (const s of all) {
    const hit = files.filter((f) => s.files.some((r) => r.test(f)));
    if (hit.length) why.set(s.name, hit);
  }
  // 코드가 바뀌었는데 걸린 것이 없으면 — 문서든 프로그램이든 켜지기는 하는지만
  const code = files.filter((f) => /^(packages|apps|scripts)\//.test(f));
  if (!why.size && code.length) {
    if (code.some((f) => f.startsWith('packages/'))) why.set('doc-boot', code);
    if (code.some((f) => f.startsWith('apps/'))) why.set('app-shell', code);
  }
  return { specs: all.filter((s) => why.has(s.name)), why };
}

async function main() {
  if (args.includes('--list')) {
    for (const s of all) console.log(`${s.name.padEnd(16)} ${s.kind}${s.net ? ' · 네트워크' : ''}${s.serial ? ' · 혼자' : ''}`);
    return;
  }
  const { specs, why } = pick();
  if (!specs.length) {
    console.log('바뀐 코드에 걸린 스모크가 없습니다.');
    return;
  }
  console.log(`스모크 ${specs.length}개: ${specs.map((s) => s.name).join(', ')}`);
  for (const [n, f] of why) console.log(`  ${n} ← ${f.slice(0, 4).join(', ')}${f.length > 4 ? ` 외 ${f.length - 4}` : ''}`);
  if (args.includes('--dry')) return;

  // 필요한 것만, 바뀐 게 있을 때만 빌드 — 문서 스모크는 구운 문서, 프로그램 스모크는 앱 빌드
  const needApp = specs.some((s) => s.kind === 'app');
  const needDoc = specs.some((s) => s.kind === 'doc');
  const sh = (c: string) => execSync(c, { stdio: 'inherit' });
  const tb = Date.now();
  const code = stamp(['apps', 'packages', 'scripts', 'package.json', 'electron.vite.config.ts', 'tsconfig.json']);
  // 앱 빌드는 문서 런타임(out/manna)도 함께 만든다
  if (needApp) cached('app', code, existsSync('out/main'), () => sh('npm run build --silent'), ['manna']);
  else cached('manna', code, existsSync('out/manna'), () => sh('npm run build:manna --silent'));
  if (needDoc) {
    cached('bake', code + stamp(['example/proto']), existsSync('out/e2e/proto.terr.html'), () =>
      sh('npx tsx scripts/bake.ts example/proto out/e2e/proto.terr.html --entry "index - old.html,index.html" > ' + (process.platform === 'win32' ? 'NUL' : '/dev/null')));
  }
  console.log(`준비 ${((Date.now() - tb) / 1000).toFixed(1)}초`);

  // 함께 돌린다 — 지난번에 오래 걸린 것부터 (끝이 한 기능에 몰리지 않게)
  const at = args.indexOf('--jobs');
  const jobs = at >= 0 ? Math.max(1, Number(args[at + 1]) || 1) : JOBS;
  const times = readTimes();
  const queue = specs.filter((s) => !s.serial).sort((a, b) => (times[b.name] ?? 20) - (times[a.name] ?? 20));
  const t0 = Date.now();
  const runOne = async (s: Spec) => {
    const log: string[] = [];
    const t = Date.now();
    await inSpec(s.name, log, async () => {
      try {
        await s.run();
      } catch (e) {
        results.push({ spec: s.name, name: '실행 중 오류', ok: false, detail: (e as Error).message.split('\n')[0] });
        log.push(`  ✗ 실행 중 오류 — ${(e as Error).message.split('\n')[0]}`);
      }
    });
    const sec = (Date.now() - t) / 1000;
    times[s.name] = Math.round(sec * 10) / 10;
    console.log(`\n[${s.name}] ${sec.toFixed(1)}초\n${log.join('\n')}`);
  };
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    for (let s = queue.shift(); s; s = queue.shift()) await runOne(s);
  }));
  // 혼자 돌아야 하는 것 — 묶음이 끝난 뒤 하나씩
  for (const s of specs.filter((x) => x.serial)) await runOne(s);
  await closeBrowser();
  writeTimes(times);
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} 통과 · ${((Date.now() - t0) / 1000).toFixed(0)}초`);
  for (const r of bad) console.log(`  ✗ [${r.spec}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}

/* ── 빌드 캐시 · 걸린 시간 ─────────────────────────────────────────── */
const JOBS = 4;
const STAMPS = join(OUT, '.stamps.json');
const TIMES = join(OUT, '.times.json');

/** 소스 지문 — 파일 경로 · 크기 · 고친 시각. 내용까지 읽지 않아 빠르다 */
function stamp(roots: string[]): string {
  const h = createHash('sha1');
  const walk = (p: string) => {
    if (!existsSync(p)) return;
    const st = statSync(p);
    if (st.isDirectory()) {
      for (const n of readdirSync(p).sort()) if (!/^(node_modules|out|run|dist|\.git)$/.test(n)) walk(join(p, n));
    } else h.update(`${p}|${st.size}|${st.mtimeMs}\n`);
  };
  roots.forEach(walk);
  return h.digest('hex');
}

function cached(name: string, key: string, outputExists: boolean, build: () => void, alsoBuilt: string[] = []): void {
  let all: Record<string, string> = {};
  try {
    all = JSON.parse(readFileSync(STAMPS, 'utf8'));
  } catch {
    /* 처음 */
  }
  if (!args.includes('--rebuild') && outputExists && all[name] === key) {
    console.log(`  ${name} — 바뀐 소스가 없어 건너뜀`);
    return;
  }
  build();
  all[name] = key;
  for (const n of alsoBuilt) all[n] = key;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(STAMPS, JSON.stringify(all, null, 2));
}

function readTimes(): Record<string, number> {
  try {
    return JSON.parse(readFileSync(TIMES, 'utf8'));
  } catch {
    return {};
  }
}
function writeTimes(t: Record<string, number>): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(TIMES, JSON.stringify(t, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
