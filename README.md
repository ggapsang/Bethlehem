<p align="center"><img src="docs/key_art.png" alt="Terrarium" width="720"></p>

# Terrarium

동작하는 화면을 그대로 품은 화면정의서. 바이브 코딩으로 만든 HTML 화면 위에 바로 어노테이션을 달고, 받는 사람이 더블클릭만으로 여는 HTML 한 장으로 주고받는다.

- **Bethlehem** — 작성 프로그램 (Electron). 화면 폴더를 등록하고, 어노테이션을 달고, 저장한다.
- **Manna** — 저장한 문서. HTML 파일 하나에 화면·데이터·폰트·어노테이션이 모두 들어 있다. 받는 사람도 그 안에서 답글·상태 변경·새 어노테이션을 달고 저장해 돌려보낸다.

컨셉은 [docs/CONCEPT.md](docs/CONCEPT.md), 구조와 결정 사항은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 실행

Node.js 20 이상.

```sh
npm install
npm start          # Manna 런타임을 빌드하고 Bethlehem 을 개발 모드로 띄운다
```

Bethlehem 에서 **화면 폴더 추가**로 `example/proto` 를 고르거나 창에 끌어다 놓는다. 어노테이션 모드에서 요소를 클릭하거나 영역을 드래그해 달고, `Ctrl+S` 로 저장하면 Manna 문서(.html)가 된다.

Bethlehem 없이 명령줄로 굽기:

```sh
npm run bake -- example/proto out/proto.manna.html --entry "index - old.html,index.html"
```

## 확인

```sh
npm run typecheck
npm test               # 코어 단위 테스트
npm run test:e2e       # 구운 Manna 를 설치된 Chrome 에서 file:// 로 열어 확인
npm run test:e2e:app   # Bethlehem(Electron)으로 등록 → 어노테이션 → 새 버전 → 저장
```

E2E 는 설치된 Chrome(없으면 Edge)을 쓴다. 다른 위치라면 `CHROME_PATH` 로 지정한다. 스크린샷은 `out/e2e/` 에 남는다.

## 구조

```
apps/bethlehem/     Electron — main(파일·패키징) · preload(API) · renderer(작성 UI)
packages/core/      문서 형식, 블롭 코덱, 가상 FS, 요소 지문(Leaven) — node/ 는 폴더 패키징
packages/manna/     Manna 런타임 — 내보낸 HTML 에 인라인되는 화면 틀 (Bethlehem 도 같은 틀을 쓴다)
example/proto/      첫 빵 (OHT 모니터링 화면)
scripts/bake.ts     명령줄 굽기
tests/              E2E
```

## 라이선스

Apache-2.0
