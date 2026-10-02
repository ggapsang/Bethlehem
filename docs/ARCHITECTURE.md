# Terrarium 아키텍처

> CONCEPT.md를 구현 단위로 옮긴 문서다. 첫 빵은 `example/proto`(OHT 모니터링 화면)이며, 이 문서의 모든 결정은 그 화면을 실제로 구워낼 수 있는지를 기준으로 했다.
> 사용자에게 보이는 이름은 **테라리움(Terrarium)** 하나다. Bethlehem(작성 프로그램)·Manna(내보낸 문서)는 코드와 이 문서 안에서만 쓰는 코드명이다.

---

## 1. 결정 사항

| # | 항목 | 결정 |
|---|---|---|
| D-1 | Bethlehem 형태 | 처음부터 Electron. 개발 중에는 `npm start`(개발 모드)로 실행하고 배포 빌드는 나중에 한다 |
| D-2 | 기술 스택 | TypeScript + Vite + Preact (electron-vite) |
| D-3 | 자체 UI 테마 | 라이트 기본 + 다크 토글. 다임리서치 디자인 가이드 v1.0 토큰 |
| D-4 | 외부 리소스 | 굽을 때 내려받아 포함. 리소스별로 제외 가능 |
| D-5 | 작업 파일 | 테라리움 문서 HTML 하나. 작업 파일이 곧 보내는 파일이다 (별도 프로젝트 포맷 없음) |
| D-6 | 파일 이름 | 이중 확장자 `.terr.html` — 브라우저는 HTML 로 바로 열고, 사람은 테라리움 문서인지 알아본다 |
| D-7 | 보이는 이름 | UI 의 모든 문자열은 "테라리움". Bethlehem·Manna 는 노출하지 않는다 |
| D-8 | Comment | 유형·상태·담당 없이 **마크다운 본문 하나 + 마크다운 답글**. 할 일은 `- [ ]` 체크박스로 |
| D-9 | 개요 | 화면마다 마크다운 개요. README 는 한 번 가져와 복사될 뿐, 그 뒤로는 문서의 텍스트다 |
| D-10 | 오른쪽 패널 | 위에 개요, 아래에 Comment 목록이 한 스크롤로 이어진다. 탭 없음 |
| D-11 | 녹화 | Bethlehem 과 수신자 브라우저 양쪽에서 |
| D-12 | 검증 범위 | Chrome·Edge·Electron. Firefox 검증은 하지 않는다 |

**D-2 근거.** Manna 런타임은 품은 화면과 한 파일에 같이 실린다. Preact는 React 문법을 그대로 쓰면서 작고, 같은 컴포넌트를 Bethlehem 렌더러에서도 쓴다.

**D-5 근거.** 빵이 곧 반죽이다. 기획자는 테라리움 문서를 열고 저장한다. 수신자에게 보내는 것도, 돌려받는 것도 같은 형식이다. "원본 따로, 보낸 것 따로"가 없으므로 최신본이 어느 것인지 헷갈리지 않는다.

**D-8 근거.** 유형·상태 같은 정형 필드는 기획자마다 쓰는 법이 달라 결국 본문에 다시 적게 된다. 옵시디언처럼 마크다운 하나로 두고, 확인이 필요한 일은 체크박스로 적는다. 수신자는 남의 Comment 본문은 고칠 수 없지만 체크박스는 누를 수 있다.

---

## 2. 첫 빵 분석 — `example/proto`

| 관찰 | 실제 | 대응 |
|---|---|---|
| 구성 | `index.html` 470KB + `data/*.js` 2.9MB + `assets/` 2.7MB | `assets/` 이미지 3개는 `index.html`이 참조하지 않는다 → 등록 때 "참조 없음 · 제외"로 제안 |
| 데이터 로딩 | `createElement('script')` 후 `s.src = 'data/${key}.js'` 동적 삽입 | 가상 파일 시스템 shim (§5) |
| 화면 본체 | `<canvas>` 16개 (3D 맵, FAB 조망, 레이더, 미니맵) | **요소 + 요소 내 상대 영역** 앵커 (§6) |
| 화면 상태 | FAB 조망 → BAY-4 상세, 설비정보 탭, LIVE/REC, 보조 창 | 앵커가 보일 때만 마커 표시, 클릭 경로를 남겨 그 상태로 돌아간다 (§6.4) |
| 움직임 | rAF 루프, 13.4초 순환 | 마커는 매 프레임 위치 추적. 일시정지(§5.4), 녹화(§7) |
| 해상도 | `#app`에 CSS `zoom`, 1440×900 이상 권장 | 화면별 기준 뷰포트(기본 1920×1080)로 띄우고 축소 표시 (§4.2) |
| 버전 | `index - old.html`(v1)과 `index.html`(v2)이 같은 `data/`를 씀 | 내용 해시 저장으로 데이터 중복 제거 (§3.3) |
| 외부 의존 | Pretendard CDN (dynamic-subset, woff2 92개 ≈ 3MB) | 동일 폰트의 단일 variable woff2(2.0MB)로 대체해 포함 (§5.3) |
| 기획 문서 | `README.md` 60KB | 화면 개요로 한 번 가져온다 (D-9) |

### 2.1 용량

| 내용 | 문서 내(base64) |
|---|---|
| v2 화면 + data | 1.3MB |
| v1 추가 (data 공유) | +0.12MB |
| Pretendard variable | 2.7MB |
| 런타임 (JS 412KB + CSS 20KB) | 0.43MB |
| **합계 (실측)** | **4.4MB** |

런타임은 CodeMirror(마크다운 편집기) 때문에 128KB → 412KB 로 커졌다. 그중 `@codemirror/view`가 149KB 다. `@codemirror/lang-markdown`은 HTML·CSS·JS 언어 지원을 끌고 와 0.6MB 가 되므로 쓰지 않고, 같은 파서(`@lezer/markdown` + GFM)로 언어를 직접 만든다(`ui/editor/markdownLang.ts`). 녹화 클립은 10초에 1~3MB 가 더해진다.

---

## 3. 문서 형식

### 3.1 구조

```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>OHT 모니터링 화면정의서</title>
<script type="application/json" id="manna-doc">{ ...문서 데이터... }</script>
<script type="application/octet-stream" id="manna-blob-3f9a…" data-enc="gz64">H4sIA…</script>
<script type="application/octet-stream" id="manna-blob-81c2…" data-enc="b64">d09GMg…</script>
<style id="manna-style">/* 런타임 CSS */</style>
</head>
<body>
<script id="manna-runtime">/* 런타임 JS (IIFE) */</script>
</body>
</html>
```

- **문서 데이터**는 JSON 하나다. 블롭과 분리되어 있으므로 따로 꺼내 읽거나 주고받을 수 있다.
- **블롭**은 화면 파일·외부 리소스·녹화 클립 하나하나다. 이름은 내용의 SHA-256이다. 텍스트는 `gz64`(gzip 후 base64), 이미 압축된 것(woff2, png, webm)은 `b64`로 담는다.
- **저장**은 런타임이 자기 자신을 다시 직렬화하는 것이다. 바뀌는 것은 문서 데이터 JSON 과 새 블롭(클립)뿐이다. 문서가 더는 참조하지 않는 블롭은 저장할 때 빠진다.
- JSON 안의 `<` 와 줄 구분 문자(U+2028·U+2029)는 유니코드 이스케이프로 바꿔 `</script>` 조기 종료를 막는다.

### 3.2 문서 데이터

```ts
interface MannaDoc {
  format: 'manna/1';
  id: string;                  // 문서 UUID. 병합 시 같은 문서인지 판별
  meta: { title; project?; version; createdAt; updatedAt; marker?: MarkerColor };
  changelog: { version; date; author; note }[];
  participants: { name: string; role?: string }[];
  screens: Screen[];
  origin?: { by; at; baseUpdatedAt };   // 수신자가 저장한 회신본이면 기록
}

interface Screen {
  id: string;                  // 'SCR-003'
  title: string;
  notes: string;               // 개요 — 마크다운
  versions: ScreenVersion[];
  annotations: Annotation[];   // 배열 순서가 곧 번호 (§6.1)
}

interface ScreenVersion {
  v: number;
  label?: string;
  entry: string;               // 'index.html' 또는 URL 스냅샷이면 원래 페이지 URL
  source?: { url; mode: 'live' | 'static'; at };   // URL 로 담았을 때
  viewport: { w; h; fit: 'contain' | 'width' };
  files: Record<string, { sha; size; type }>;     // 가상 경로 → 블롭
  external: { url; sha?; type?; excluded?; via?; note?; error? }[];  // 원래 URL → 블롭
}
```

### 3.3 내용 해시와 중복 제거

같은 내용의 파일은 버전이 달라도 블롭 하나다. proto의 v1과 v2는 `data/` 2.9MB를 공유하므로 v1 추가 비용은 HTML 하나뿐이다.

---

## 4. 화면 구성

### 4.1 레이아웃

Manna와 Bethlehem은 같은 틀을 쓴다. 왼쪽 패널은 없다. Bethlehem 의 작성 기능(새 문서·열기·화면 추가·새 버전·삭제)은 모두 툴바에 있다.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 🌱 [새 문서][열기▾] 제목 v0.1 │ 화면▾ 버전▾ [화면 추가▾][새 버전▾][🗑] │ 보기·피커 ⏸ ● ◐ │ ↶ ↷ │ ▣ ⤢ ☾ 이름 [저장] │
├──────────────────────────────────────────────────────┬─┬─────────────────────┤
│                                                      │┃│ ▾ 개요              │
│              품은 화면 (실제 동작)                    │┃│   마크다운 편집기   │
│              ① ② ③ 마커                              │┃│ ─────────────────── │
│                                                      │┃│ Comment 3       ＋  │
│                                                      │┃│ ⠿ ① 이름 · 방금     │
│                                                      │┃│ ⠿ ② … 다른 상태     │
└──────────────────────────────────────────────────────┴─┴─────────────────────┘
                                          끌어서 폭 조절 ┘
```

- **열기 ▾** 는 대화상자와 최근 문서 10개, **화면 추가 ▾ / 새 버전 ▾** 는 폴더 선택·URL 로 담기·최근 폴더 10개. 대화상자는 마지막으로 쓴 위치에서 열린다 (`userData/settings.json`).
- 패널과 스테이지 사이 손잡이를 끌어 패널 폭을 바꾼다(300px ~ 창의 70%, 브라우저에 기억). 더블클릭하면 400px.
- **전체화면**(⤢)은 Fullscreen API 로 창 전체를 쓰고 툴바를 숨긴다. 위쪽 가운데에 작은 막대(보기·피커·일시정지·녹화·마커 색·패널·나가기)만 뜬다. Esc 로 나간다.
- 패널(▣)은 숨길 수 있다.

### 4.2 스테이지

품은 화면은 기준 뷰포트(기본 1920×1080) 크기의 iframe으로 띄우고 `transform: scale()`로 남는 영역에 맞춘다. 화면 자신은 늘 같은 크기에서 돌기 때문에 레이아웃이 작성자가 본 그대로 유지된다.

### 4.3 디자인 토큰

디자인 가이드 §8.1 원시 토큰을 그대로 쓰고, §8.2 시맨틱 매핑으로 라이트/다크를 전환한다. 자체 UI는 Pretendard를 쓴다. 문서에 Pretendard 블롭이 있으면 그것을 같이 쓰고, 없으면 시스템 폰트로 폴백한다.

**마커 색.** 마커는 화면 위에 뜨므로 아래 배경이 무엇일지 모른다. 기본(자동)은 마커 자리의 배경 밝기를 0.5초마다 재서(캔버스는 픽셀을, DOM 은 불투명한 배경색을) 어두운 배경이면 흰 바탕·검은 숫자, 밝은 배경이면 그 반대로 고른다. 어느 쪽이든 바깥 고리와 그림자를 둘러 어떤 배경에서도 테두리가 보인다. 툴바의 마커 색(◐)에서 주황·검정·흰색·파랑·노랑·빨강으로 고정할 수 있고, 이 설정은 문서에 저장된다.

**브랜드 자산.** `docs/icon.png`는 창·앱 아이콘과 문서 파비콘(64px)으로, `docs/key_art.png`는 Bethlehem 첫 화면에 쓴다(소개 문구 없이 키 아트와 버튼만). 키 아트는 용량 때문에 문서에 넣지 않는다. 툴바 로고는 키 아트의 잎 마크를 SVG 로 옮긴 것이고, 그 녹색은 로고에만 쓴다.

---

## 5. 화면 품기

### 5.1 iframe 로딩

1. 엔트리 HTML 블롭을 풀어 `DOMParser`로 읽는다. 원본은 건드리지 않는다.
2. 정적 참조(`script[src]`, `link[href]`, `img[src]`, `srcset`, `source`, `video`, `audio`, 인라인 `style`의 `url()`)를 Blob URL로 바꾼다. CSS 파일은 내부 `url()`을 그 CSS 의 경로 기준으로 풀어 바꾼다. `<base href>` 가 있으면 해석에 반영하고 태그는 지운다.
3. `<head>` 맨 앞에 shim 스크립트를 넣는다.
4. `iframe.srcdoc`으로 띄운다. srcdoc 문서는 부모와 같은 출처이므로 부모가 내부 DOM에 접근할 수 있고, 이것이 Comment 의 전제다.

### 5.2 shim — 실행 중 요청 가로채기

품은 화면의 스크립트보다 먼저 실행되어 `script.src`·`img.src`·`link.href` 세터, `setAttribute`, `fetch`, `XMLHttpRequest.open`, `Worker` 를 패치한다. 받은 경로를 문서 기준으로 풀어 담겨 있으면 Blob URL로 바꾸고, 없으면 그대로 통과시킨다. 풀리지 않은 요청은 스테이지 아래 진단에 원인·위치·조치와 함께 쌓인다.

### 5.3 외부 리소스

Bethlehem(메인 프로세스, CORS 제약 없음)이 등록 시점에 외부 URL을 내려받는다. CSS면 그 안의 `url()`까지 재귀로 받는다. Pretendard dynamic-subset(woff2 92개)은 같은 폰트의 단일 variable woff2로 바꿔 담는다. 리소스별로 체크를 끄면 링크를 그대로 둔다.

### 5.4 일시정지

shim이 `requestAnimationFrame`, `performance.now`, `Date.now`, CSS 애니메이션을 감싼다. 일시정지 중에는 rAF 콜백을 보류하고, 재개하면 멈춰 있던 시간만큼 시계를 빼서 넘긴다.

### 5.5 URL 로 담기

폴더가 아니라 주소로 화면을 담는다 (CONCEPT §4 스냅샷). Bethlehem 이 별도 창을 띄운다 — 위는 테라리움 막대(주소·뒤로·새로고침·화면 크기·담기 버튼), 아래는 실제 페이지(`WebContentsView`, 별도 세션 `persist:terrarium-snapshot`). 사용자는 그 창에서 로그인하거나 원하는 상태까지 이동한 뒤 담는다.

- 창이 받은 응답은 CDP `Network` 로 모두 적어 둔다(GET, 2xx, 하나 40MB·합계 150MB 까지). 새 문서로 이동하면 지난 페이지의 응답은 버린다.
- **동작 포함(live)**: 원래 HTML + 받은 응답 전부를 외부 리소스로 담는다. 화면에서 스크립트가 다시 돌고, `fetch`·XHR 은 shim 이 그때 받은 응답으로 돌려준다. 서버가 없어도 그 순간의 데이터로 동작한다.
- **보이는 그대로(static)**: 지금 DOM 을 직렬화해 담는다. 스크립트와 `on*` 속성은 빼고, 캔버스는 이미지로, 입력값은 속성으로, `insertRule` 로만 들어간 CSS 규칙은 `<style>` 글로 옮긴다. 정지 화면이지만 사용자가 이동해 둔 상태가 그대로 남는다.
- EUC-KR 처럼 UTF-8 이 아닌 텍스트 응답은 담을 때 UTF-8 로 바꾸고 `meta charset` 을 고친다.
- 화면 크기는 막대에서 고른다(1920×1080 등). 페이지 뷰를 그 CSS 크기로 확대·축소해 보여 주고, 그 크기가 버전의 기준 뷰포트가 된다.
- **한계**: srcdoc 안에서는 `location` 이 원래 주소가 아니므로 주소로 화면을 고르는 SPA 라우터는 다른 화면을 띄울 수 있다. POST 응답(GraphQL 등)은 다시 낼 수 없다. WebSocket 은 담지 않는다.

---

## 6. Comment — Leaven

### 6.1 데이터

```ts
interface Annotation {          // UI 이름은 Comment
  id: string;
  version: number;              // 붙어 있는 화면 버전
  anchor?: Anchor;              // 없으면 화면 전체에 단 Comment (녹화 클립 등)
  body: string;                 // 마크다운
  clips?: Clip[];               // 녹화한 움직임 (§7)
  author; createdAt; updatedAt;
  replies: { id; author; at; body /* 마크다운 */ }[];
  history: { at; by; field; from; to }[];   // 병합용
}

interface Anchor {
  fp: Fingerprint;
  region?: { x; y; w; h };      // 요소 박스 기준 0~1
  trail: string[];              // 달 때 선택되어 있던 탭·토글 레이블
  path?: { fp: Fingerprint; x; y }[];   // 화면을 연 뒤 달기 전까지의 클릭 (§6.4)
  props?: Record<string, string>;       // 계산된 스타일 (지금은 화면에 보이지 않는다)
}
```

**번호는 따로 저장하지 않는다.** 같은 화면 버전 안에서 배열 순서가 곧 번호다. 패널에서 카드 왼쪽 손잡이(⠿)를 끌어 순서를 바꾸면 마커 번호도 함께 바뀐다. 다른 버전의 항목 자리는 건드리지 않는다.

### 6.2 피커 — 요소 + 영역

- **Ctrl 을 누르고 있는 동안** 피커가 된다(커서 십자, 스테이지에 주황 테두리, "피커" 배지). 떼면 보기로 돌아가고, 잡아 둔 대상의 작성 창은 남는다. 드래그 중에 떼도 영역은 잡힌다. Ctrl+문자 조합(Ctrl+S 등)을 누르면 피커는 바로 꺼진다. 툴바의 "피커"로 고정할 수도 있다.
- **클릭**은 요소를, **드래그**는 그 영역을 품는 가장 깊은 요소(캔버스면 그 캔버스) 안의 상대 영역을 잡는다. `↑`/`↓`(글을 쓰는 중에는 `Alt+↑`/`↓`)로 부모·자식 요소로 옮긴다.
- 화면 전체에 다는 Comment 는 패널의 ＋ 로 만든다.

### 6.3 마크다운 편집기

Comment 본문·답글·개요가 모두 같은 편집기(CodeMirror 6)를 쓴다. 옵시디언식 라이브 미리보기 — 커서가 있는 줄만 마크다운 기호를 보이고, 나머지 줄은 서식만 보인다(제목, 굵게·기울임·취소선, 코드, 인용, 링크, 구분선, 글머리표). `- [ ]` 는 체크박스로 그려지고 누르면 바로 `[x]` 가 된다. Enter 는 목록·체크박스·인용을 이어 쓰고, 빈 항목에서 누르면 목록을 끝낸다. Ctrl+B / Ctrl+I, Ctrl+Enter 로 추가.

남의 Comment·답글은 읽기 전용이지만 체크박스는 누를 수 있다. 작성자(Bethlehem)는 모두 고칠 수 있다.

### 6.4 표시와 화면 상태 찾아가기

마커 레이어는 iframe 바깥에 있다. 매 프레임 앵커 요소의 위치를 스테이지 스케일로 변환해 옮기고, 요소가 보일 때(`checkVisibility()`, 뷰포트 안)만 띄운다. 안 보이는 Comment 는 패널에서 흐리게, "다른 상태" 표시를 붙인다.

**다른 상태의 Comment 를 누르면 그 화면 상태로 간다.** 화면을 연 뒤 사람이 누른 클릭(요소 지문 + 요소 안의 상대 위치)을 적어 두고, Comment 를 달 때 그 경로를 함께 저장한다(`anchor.path`, 최근 24번).

1. **빠른 길** — 경로 중 탭·토글(`role="tab"`, `aria-selected`·`aria-pressed`·`aria-expanded`)이고 지금 선택되지 않은 것만 다시 누른다. 탭 안의 Comment 는 대개 여기서 끝난다.
2. **처음부터** — 그래도 안 보이면 화면을 다시 불러와 경로 전체를 순서대로 누른다. 각 단계는 그 요소가 나타날 때까지(최대 10초) 기다린다. 캔버스 위 클릭(FAB 조망 → BAY-4)도 같은 상대 위치에 pointer·mouse·click 이벤트를 내서 재현한다.

### 6.5 찾기와 재부착

열 때는 `id` → `selector` → 지문 점수 순으로 요소를 찾는다. 새 버전을 등록할 때 "기존 Comment 를 새 버전으로 옮기기"를 고르면 버전 번호만 옮기고, 화면에서는 지문 점수로 다시 찾는다. **신뢰도 표시와 재지정 UI 는 아직 없다** — proto 의 v1 로 옮겼을 때 `#tabB` 에 단 항목이 옛 화면의 다른 탭에 붙는 것을 확인했다(같은 id 가 다른 탭을 가리킨다).

---

## 7. 녹화

툴바의 ●(전체화면에서는 작은 막대)로 시작·정지한다(최대 60초). 스테이지 영역만 webm(VP9, 2Mbps)으로 담고, 녹화 중에는 마커와 하이라이트를 숨긴다.

- **화면 받기**: `getDisplayMedia`. Bethlehem 은 메인 프로세스가 `setDisplayMediaRequestHandler` 로 요청한 프레임(자기 창)을 바로 건넨다 — 대화상자가 없다. 브라우저는 "이 탭 공유" 대화상자가 뜬다(`preferCurrentTab`). 화면 전체·다른 창을 고르면 거절하고 이 탭을 고르라고 안내한다.
- **자르기**: Region Capture(`cropTo`)가 되면 그것으로, 안 되면 받은 영상을 캔버스에 옮기며 스테이지 자리만 잘라 다시 녹화한다. Bethlehem 실측 1130×636(스테이지와 같은 16:9).
- **붙이기**: 선택한 Comment 가 있으면 그 Comment 에, 없으면 화면 전체 Comment 를 새로 만들어 붙인다. 클립은 `b64` 블롭으로 문서에 들어가고, 카드 안에서 반복 재생된다.

---

## 8. 저장과 병합

### 8.1 저장

| 환경 | 동작 |
|---|---|
| Bethlehem | 처음 저장할 때 대화상자(마지막 위치에서 열림). 이후 같은 파일에 덮어쓰기. 확장자를 빼거나 `.html` 로만 적어도 `.terr.html` 로 맞춘다 |
| Chrome / Edge | 첫 저장 때 `showSaveFilePicker`로 한 번 지정, 이후 같은 파일에 덮어쓰기 |
| 그 밖의 브라우저 | 다운로드 |

수신자가 저장하면 받은 파일 이름 뒤에 자기 이름이 붙는다 (`proto.terr.html` → `proto_홍길동.terr.html`). 수신자는 처음 열 때 이름을 한 번 입력하고, 이름은 그 브라우저에 기억된다.

### 8.2 되돌리기

문서를 고치는 모든 동작(Comment·답글·개요·순서·마커 색·화면 등록·삭제)은 고치기 직전 문서 JSON 을 쌓는다(최대 100단계). 같은 Comment 를 이어 타이핑하면 2초 안의 변경은 한 단계로 묶는다. **Ctrl+Z / Ctrl+Shift+Z(Ctrl+Y)**, 툴바 ↶ ↷. 글을 쓰는 중에는 편집기 자체의 되돌리기가 먼저다. 블롭은 덧붙기만 하므로 되돌리지 않고, 저장할 때 참조되지 않는 것은 빠진다.

### 8.3 병합 (Bethlehem, 다음 단계)

같은 `doc.id`의 회신본들을 원본에 합친다. Comment·답글은 UUID로 식별해 새 것은 추가하고, 같은 것은 필드별 `history` 시각 기준으로 나중 것을 쓴다. 양쪽이 같은 필드를 다르게 바꿨으면 충돌 목록에 올린다. 순서는 원본 순서를 따르고 새 항목은 뒤에 붙인다.

---

## 9. 저장소 구조

```
Bethlehem/
├── package.json             패키지 하나 · npm start = 런타임 빌드 + electron-vite dev
├── electron.vite.config.ts  main · preload(index, snapshot · cjs) · renderer(index, snapshot)
├── apps/bethlehem/
│   ├── main/                창, 파일 입출력, 최근 경로, 화면 패키징, URL 담기(snapshot.ts), 녹화 허용
│   ├── preload/             index(메인 창 API) · snapshot(URL 담기 막대 API)
│   ├── shared/              preload ↔ renderer API 타입
│   ├── renderer/            툴바 도구, 화면 등록·URL 대화상자, 첫 화면, URL 담기 막대
│   └── resources/           앱 아이콘
├── packages/
│   ├── core/src/            문서 스키마, 블롭 코덱, 가상 FS, Leaven(지문·찾기), 문서 읽기·쓰기 — 브라우저/Node 공용
│   ├── core/node/           폴더 훑기·패키징, 문자 인코딩 변환 — Node 전용
│   └── manna/src/           런타임 — 틀(App), 스테이지(shim·로더·경로·녹화), 패널, 마크다운 편집기, 상태·되돌리기
├── scripts/bake.ts          명령줄 굽기
├── tests/                   e2e.ts(문서, Chrome) · e2e-bethlehem.ts(Electron)
├── example/proto/           첫 빵
└── docs/
```

**보안.** Electron 렌더러는 `contextIsolation`, `sandbox` 로 띄운다. 품은 화면은 작성 UI 와 같은 출처(srcdoc)에서 돌기 때문에 `window.parent.bethlehem` 을 부를 수 있다. 그래서 메인 프로세스는 사용자가 대화상자로 고르거나 끌어다 놓은 경로, 그리고 예전에 그렇게 고른 최근 목록만 읽고 쓴다. URL 담기 창의 페이지는 별도 세션·샌드박스에서 돌고 preload 가 없다. 막대의 요청은 보낸 webContents 가 그 막대인지 확인한다.

**구현 메모.** 문서는 제자리에서 고치므로 `@preact/signals` 의 얕은 props 비교에 걸려 다시 그려지지 않는 컴포넌트가 생긴다. 문서 내용을 그리는 컴포넌트(툴바, 개요, 카드, 상세, 마커)는 `rev` 를 읽어 구독한다.

---

## 10. 단계

### Phase 0 — 첫 빵 굽기 (2026-10-01 완료)

proto 를 문서 한 장으로 구워 내고, 가상 FS · 캔버스 영역 앵커 · zoom 위 마커를 검증했다.

### Phase 0.5 — 작성 경험 (2026-10-02)

| 항목 | 근거 (자동 테스트) |
|---|---|
| Ctrl 누르고 있는 동안 피커, 떼면 보기 · 작성 창 유지 · 드래그 중 떼도 영역 | `test:e2e` [2] |
| Comment = 마크다운 + 마크다운 답글, 유형·상태·담당 없음, 체크박스 토글 | [2][6] |
| 개요(README 한 번 복사 → 편집), 개요 아래 Comment 한 스크롤 | [1][10], `test:e2e:app` [2] |
| Ctrl+Z / Ctrl+Shift+Z | [4] |
| 끌어서 순서 변경 = 번호 변경 | [5] |
| 다른 상태 Comment → 탭 전환(빠른 길) · 다시 불러와 경로 재생 | [7] |
| 녹화 — 브라우저(가짜 화면 공유 스트림으로 확인) · Electron(실제 창 캡처, 스테이지만 잘림) | [8], app [4] |
| 패널 폭 조절, 전체화면 | [9] |
| `.terr.html`, 수신자 이름 붙여 저장 | [10], app [8] |
| 마커 자동 대비 · 색 고정 | [3] |
| 왼쪽 패널 제거 → 툴바, 최근 문서·폴더, 마지막 위치에서 대화상자 | app [5][6][8] |
| URL 로 담기 — 보이는 그대로 · 동작 포함(서버 끈 뒤 API 응답 재생) | app [7] |

자동으로 확인하지 못한 것: 브라우저의 실제 "이 탭 공유" 대화상자 흐름(테스트는 가짜 스트림), `showSaveFilePicker` 덮어쓰기(대화상자), 실제 외부 사이트 URL 담기(로컬 서버로만 확인).

### Phase 1 — 협업

병합, 재부착 신뢰도와 재지정 UI(§6.5), 변경 이력 화면, 버전 나란히 비교, Comment 썸네일(`capturePage`), 요소 속성 표시(지금도 `anchor.props` 로 저장은 한다).

### Phase 2 — 빵집 확장

모듈 번들링(esbuild), Worker 변환, URL 담기의 SPA 라우팅 보정, 배포 빌드와 자동 업데이트.
