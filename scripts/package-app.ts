/* 설치 파일 만들기 — build/app/ 에 실행본을 차리고 electron-builder 로 Windows 설치 파일(NSIS)을 release/ 에 굽는다.
 * 메인 프로세스가 번들 밖에서 부르는 것은 터미널(@lydell/node-pty)뿐이다 — 그것만 node_modules 에 넣는다.
 */
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Arch, build, Platform } from 'electron-builder';
import { ROOT, pkg, stageApp } from './stage';

const APP = join(ROOT, 'build/app');
const NATIVE = ['@lydell/node-pty', '@lydell/node-pty-win32-x64'];

rmSync(APP, { recursive: true, force: true });
const deps: Record<string, string> = {};
for (const m of NATIVE) {
  const from = join(ROOT, 'node_modules', m);
  if (!existsSync(from)) throw new Error(`없습니다: node_modules/${m}`);
  deps[m] = (JSON.parse(readFileSync(join(from, 'package.json'), 'utf8')) as { version: string }).version;
}
stageApp(APP, { description: pkg.description, license: pkg.license, author: 'DAIM Research', dependencies: deps });
for (const m of NATIVE) cpSync(join(ROOT, 'node_modules', m), join(APP, 'node_modules', m), { recursive: true });

await build({
  targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
  config: {
    appId: 'com.daimresearch.terrarium',
    productName: 'Terrarium',
    copyright: 'DAIM Research',
    directories: { app: 'build/app', output: 'release', buildResources: 'apps/bethlehem/resources' },
    // 미리 빌드된 conpty 를 그대로 쓴다 — 다시 빌드하지 않는다
    npmRebuild: false,
    // 받아 둔 Electron 을 그대로 쓴다
    electronDist: 'node_modules/electron/dist',
    asarUnpack: ['node_modules/@lydell/**'],
    win: { icon: 'apps/bethlehem/resources/icon-256.png', target: 'nsis', signAndEditExecutable: true },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: 'Terrarium',
      installerLanguages: ['ko_KR'],
      language: '1042',
      artifactName: 'Terrarium-Setup-${version}.${ext}',
    },
  },
});
