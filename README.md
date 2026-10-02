<p align="center"><img src="docs/key_art.png" alt="Terrarium" width="720"></p>

# Terrarium (테라리움)

동작하는 화면을 그대로 품은 화면정의서. HTML 화면 위에 바로 Comment 를 달고, 받는 사람이 더블클릭만으로 여는 HTML 한 장(`.terr.html`)으로 주고받는다.

사용자에게 보이는 이름은 **테라리움** 하나다. 코드 안에서는 작성 프로그램을 **Bethlehem**, 내보낸 문서를 **Manna** 라고 부른다.

**쓰는 법과 컨셉은 [docs/USER_GUIDE.md](docs/USER_GUIDE.md)** 에 있다. 처음 구상은 [docs/CONCEPT.md](docs/CONCEPT.md), 구조와 결정 사항은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 실행

Node.js 20 이상.

```sh
npm install
npm start          # 빌드해서 run/ 에 실행본을 만들고 테라리움을 띄운다
```

- **작업 폴더** — 처음에 "폴더 열기" 로 폴더를 하나 고른다. 비어 있지 않아도 된다 — 테라리움 문서가 들어 있으면 풀어서, 프로토타입(HTML)이 들어 있으면 그 화면을 등록하며 시작한다. 다음부터는 켜면 마지막 작업 폴더와 화면이 그대로 열린다. 보낼 파일은 `dist/` 에 늘 최신으로 구워져 있다.
- **화면 추가** — 툴바의 화면 추가에서 폴더(`example/proto`)를 고르거나 창에 끌어다 놓는다. **URL** 을 넣으면 편집기 안에서 실제 사이트가 그대로 돈다. **그림**(png · jpg)도 화면이 된다(Comment 는 영역 박스로).
- **Comment** — `Ctrl` 을 누른 채 요소를 클릭하거나 드래그한다. 화면이 멈춘 그림으로 덮이고, 대상 옆 팝업에 마크다운으로 쓴다. 그 순간의 화면이 Comment 에 함께 남는다. Comment 를 누르면 그 탭·캔버스 속 화면·다른 페이지로 다시 찾아간다. `Delete` 로 지우고 `Ctrl+Z` 로 되돌린다.
- **저장** — 고치면 자동으로 저장된다. 받은 사람은 브라우저로 열어 Comment·답글을 달고 돌려보낸다. 돌아온 파일을 작업 폴더의 `returned/` 에 넣으면 "회신" 이 떠서 병합한다.

명령줄로 굽기:

```sh
npm run bake -- example/proto out/proto.terr.html --entry "index - old.html,index.html"
```

## 확인

```sh
npm run typecheck
npm test               # 코어 단위 테스트
npm run test:e2e       # 구운 문서를 설치된 Chrome 에서 file:// 로 열어 확인
npm run test:e2e:app   # 작성 프로그램(Electron) — 작업 폴더 · Comment · URL 화면 · 병합 · 다시 켜기
```

E2E 는 설치된 Chrome(없으면 Edge)을 쓴다. URL 화면 테스트는 `http://semicon-xms.xdt.com/monitor` 에 접속할 수 있어야 한다. 다른 위치라면 `CHROME_PATH` 로 지정한다. 스크린샷은 `out/e2e/` 에 남는다.

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
