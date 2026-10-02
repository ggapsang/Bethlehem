/* 스모크 — 바뀐 코드에 걸린 기능만 확인한다
 *
 *   npm run test:smoke                 바뀐 파일(git 기준: 커밋 안 한 것 + 마지막 커밋)에 걸린 것만
 *   npm run test:smoke -- doc-panel    이름으로 고르기 (여러 개 가능)
 *   npm run test:smoke -- --all        전부
 *   npm run test:smoke -- --list       무엇이 있는지만
 *   npm run test:smoke -- --dry        무엇이 걸리는지만 (돌리지 않는다)
 *
 * 처음부터 끝까지 이어지는 회귀 테스트는 npm run test:e2e(문서) · test:e2e:app(작성 프로그램) — 내보내기 전에.
 */
import { execSync } from 'node:child_process';
import { appSpecs } from './app.spec';
import { docSpecs } from './doc.spec';
import { closeBrowser, results, setSpec, type Spec } from './lib';

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
    for (const s of all) console.log(`${s.name.padEnd(16)} ${s.kind}${s.net ? ' · 네트워크' : ''}`);
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

  // 필요한 것만 빌드 — 문서 스모크는 구운 문서, 프로그램 스모크는 앱 빌드
  const needApp = specs.some((s) => s.kind === 'app');
  const needDoc = specs.some((s) => s.kind === 'doc');
  const sh = (c: string) => execSync(c, { stdio: 'inherit' });
  if (needApp) sh('npm run build --silent');
  else sh('npm run build:manna --silent');
  if (needDoc) sh('npx tsx scripts/bake.ts example/proto out/e2e/proto.terr.html --entry "index - old.html,index.html" > ' + (process.platform === 'win32' ? 'NUL' : '/dev/null'));

  const t0 = Date.now();
  for (const s of specs) {
    console.log(`\n[${s.name}]`);
    setSpec(s.name);
    const t = Date.now();
    try {
      await s.run();
    } catch (e) {
      results.push({ spec: s.name, name: '실행 중 오류', ok: false, detail: (e as Error).message.split('\n')[0] });
      console.log(`  ✗ 실행 중 오류 — ${(e as Error).message.split('\n')[0]}`);
    }
    console.log(`  (${((Date.now() - t) / 1000).toFixed(1)}초)`);
  }
  await closeBrowser();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} 통과 · ${((Date.now() - t0) / 1000).toFixed(0)}초`);
  for (const r of bad) console.log(`  ✗ [${r.spec}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
