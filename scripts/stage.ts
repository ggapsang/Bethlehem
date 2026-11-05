/* 실행본 차리기 — 빌드 결과(out/)와 프로그램이 쓰는 파일을 한 폴더에 main · preload · renderer · manna · resources 로 놓는다.
 * npm start 의 run/ 과 설치 파일(package-app.ts)의 build/app/ 이 같이 쓴다.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const ROOT = resolve('.');
const OUT = join(ROOT, 'out');

export const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string; description: string; license: string };

export function stageApp(dest: string, extra: Record<string, unknown> = {}): void {
  for (const d of ['main', 'preload', 'renderer', 'manna']) {
    if (!existsSync(join(OUT, d))) throw new Error(`빌드 결과가 없습니다: out/${d}`);
  }
  // 켜 둔 창이 읽는 중일 수 있다 — 폴더째 지우지 않고 덮어쓴다
  mkdirSync(dest, { recursive: true });
  for (const d of ['main', 'preload', 'renderer', 'manna']) {
    rmSync(join(dest, d), { recursive: true, force: true });
    cpSync(join(OUT, d), join(dest, d), { recursive: true });
  }
  rmSync(join(dest, 'docs'), { recursive: true, force: true }); // 예전 실행본의 가이드 파일 — 이제 프로그램 안에 들어 있다
  rmSync(join(dest, 'resources'), { recursive: true, force: true });
  mkdirSync(join(dest, 'resources'), { recursive: true });
  cpSync(join(ROOT, 'apps/bethlehem/resources/icon-256.png'), join(dest, 'resources/icon-256.png'));
  cpSync(join(ROOT, 'apps/bethlehem/resources/examples'), join(dest, 'resources/examples'), { recursive: true });
  cpSync(join(ROOT, 'docs/WORKSPACE_FORMAT.md'), join(dest, 'resources/WORKSPACE_FORMAT.md'));
  writeFileSync(
    join(dest, 'package.json'),
    JSON.stringify({ name: 'terrarium', productName: 'Terrarium', version: pkg.version, private: true, type: 'module', main: 'main/index.js', ...extra }, null, 2),
  );
}
