<p align="center"><img src="docs/key_art.png" alt="Terrarium" width="720"></p>

# Terrarium (테라리움)

동작하는 화면을 그대로 품은 화면정의서. HTML 화면 위에 바로 Comment 를 달고, 받는 사람이 더블클릭만으로 여는 HTML 한 장(`.terr.html`)으로 주고받는다.

사용자에게 보이는 이름은 **테라리움** 하나다. 코드 안에서는 작성 프로그램을 **Bethlehem**, 내보낸 문서를 **Manna** 라고 부른다.

컨셉은 [docs/CONCEPT.md](docs/CONCEPT.md), 구조와 결정 사항은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 실행

Node.js 20 이상.

```sh
npm install
npm start          # 문서 런타임을 빌드하고 테라리움 작성 프로그램을 개발 모드로 띄운다
```

- **화면 추가** — 툴바의 화면 추가(또는 첫 화면)에서 폴더(`example/proto`)를 고르거나 창에 끌어다 놓는다. **URL 로 담기**도 된다.
- **Comment** — `Ctrl` 을 누른 채 요소를 클릭하거나 드래그해 영역을 잡는다. 본문과 답글은 마크다운, 할 일은 `- [ ]`.
- **저장** — `Ctrl+S`. `.terr.html` 한 장이 된다. 받은 사람은 브라우저로 열어 Comment·답글을 달고 저장해 돌려보낸다.

명령줄로 굽기:

```sh
npm run bake -- example/proto out/proto.terr.html --entry "index - old.html,index.html"
```

## 확인

```sh
npm run typecheck
npm test               # 코어 단위 테스트
npm run test:e2e       # 구운 문서를 설치된 Chrome 에서 file:// 로 열어 확인
npm run test:e2e:app   # 작성 프로그램(Electron) — 등록 · Comment · 녹화 · 새 버전 · URL 담기 · 저장
```

E2E 는 설치된 Chrome(없으면 Edge)을 쓴다. 다른 위치라면 `CHROME_PATH` 로 지정한다. 스크린샷은 `out/e2e/` 에 남는다.

## 구조

```
apps/bethlehem/     작성 프로그램(Electron) — main · preload · renderer
packages/core/      문서 형식, 블롭 코덱, 가상 FS, 요소 지문 — node/ 는 폴더 패키징
packages/manna/     문서 런타임 — 내보낸 HTML 에 인라인되는 화면 틀 (작성 프로그램도 같은 틀을 쓴다)
example/proto/      첫 빵 (OHT 모니터링 화면)
scripts/bake.ts     명령줄 굽기
tests/              E2E
```

## 라이선스

Apache-2.0
