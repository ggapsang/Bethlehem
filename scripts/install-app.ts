/* 실행본 만들기 — 빌드 결과(out/)를 run/ 으로 옮겨 그 자리에서 테라리움을 띄운다.
 * 쓰는 프로그램(run/)과 고치는 코드(out/ · 소스)를 떼어 둔다. 코드를 고치거나 테스트로 다시 빌드해도
 * 켜 둔 프로그램은 그대로이고, 다음에 npm start 로 다시 켤 때 바뀐 것이 들어온다.
 */
import { join } from 'node:path';
import { ROOT, stageApp } from './stage';

stageApp(join(ROOT, 'run'));
