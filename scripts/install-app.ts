/* 실행본 만들기 — 빌드 결과(out/)를 run/ 으로 옮겨 그 자리에서 테라리움을 띄운다.
 * 쓰는 프로그램(run/)과 고치는 코드(out/ · 소스)를 떼어 둔다. 코드를 고치거나 테스트로 다시 빌드해도
 * 켜 둔 프로그램은 그대로이고, 다음에 npm start 로 다시 켤 때 바뀐 것이 들어온다.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve('.');
const OUT = join(ROOT, 'out');
const RUN = join(ROOT, 'run');

for (const d of ['main', 'preload', 'renderer', 'manna']) {
  if (!existsSync(join(OUT, d))) throw new Error(`빌드 결과가 없습니다: out/${d}`);
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };

// 켜 둔 창이 읽는 중일 수 있다 — 지우지 않고 덮어쓴다
mkdirSync(RUN, { recursive: true });
for (const d of ['main', 'preload', 'renderer', 'manna']) {
  rmSync(join(RUN, d), { recursive: true, force: true });
  cpSync(join(OUT, d), join(RUN, d), { recursive: true });
}
rmSync(join(RUN, 'docs'), { recursive: true, force: true }); // 예전 실행본의 가이드 파일 — 이제 프로그램 안에 들어 있다
mkdirSync(join(RUN, 'resources'), { recursive: true });
cpSync(join(ROOT, 'apps/bethlehem/resources/icon-256.png'), join(RUN, 'resources/icon-256.png'));
cpSync(join(ROOT, 'docs/WORKSPACE_FORMAT.md'), join(RUN, 'resources/WORKSPACE_FORMAT.md'));
writeFileSync(
  join(RUN, 'package.json'),
  JSON.stringify({ name: 'terrarium', productName: 'Terrarium', version: pkg.version, private: true, type: 'module', main: 'main/index.js' }, null, 2),
);
