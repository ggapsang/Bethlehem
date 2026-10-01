# Terrarium 아키텍처

> CONCEPT.md를 구현 단위로 옮긴 문서다. 첫 빵은 `example/proto`(OHT 모니터링 화면)이며, 이 문서의 모든 결정은 그 화면을 실제로 구워낼 수 있는지를 기준으로 했다.

---

## 1. 결정 사항

| # | 항목 | 결정 |
|---|---|---|
| D-1 | Bethlehem 형태 | 처음부터 Electron. 개발 중에는 `npm start`(개발 모드)로 실행하고 배포 빌드는 나중에 한다 |
| D-2 | 기술 스택 | TypeScript + Vite + Preact (electron-vite) |
| D-3 | 자체 UI 테마 | 라이트 기본 + 다크 토글. 다임리서치 디자인 가이드 v1.0 토큰 |
| D-4 | 외부 리소스 | 굽을 때 내려받아 포함. 리소스별로 제외 가능 |
| D-5 | 작업 파일 | Manna HTML 하나. 작업 파일이 곧 보내는 파일이다 (별도 프로젝트 포맷 없음) |

**D-2 근거.** Manna 런타임은 품은 화면과 한 파일에 같이 실린다. 작고(Preact 약 4KB), 전역을 더럽히지 않아야 한다. Preact는 React 문법을 그대로 쓰면서 이 조건을 만족하고, 같은 컴포넌트를 Bethlehem 렌더러에서도 쓴다.

**D-5 근거.** 빵이 곧 반죽이다. 기획자는 Manna 파일을 Bethlehem으로 열고 저장한다. 수신자에게 보내는 것도, 돌려받는 것도 같은 형식이다. "원본 따로, 보낸 것 따로"가 없으므로 최신본이 어느 것인지 헷갈리지 않는다. 내보내기는 옵션(이전 버전 제외, 작성자 메모 제거 등)을 적용한 사본 저장이다.

---

## 2. 첫 빵 분석 — `example/proto`

| 관찰 | 실제 | 대응 |
|---|---|---|
| 구성 | `index.html` 470KB + `data/*.js` 2.9MB + `assets/` 2.7MB | `assets/` 이미지 3개는 `index.html`이 참조하지 않는다 → 굽기 시 **미참조 파일**로 표시, 기본 제외 제안 |
| 데이터 로딩 | `createElement('script')` 후 `s.src = 'data/${key}.js'` 동적 삽입 | 가상 파일 시스템 shim (§5) |
| 화면 본체 | `<canvas>` 16개 (3D 맵, FAB 조망, 레이더, 미니맵) | 요소 선택만으로는 `canvas#iso` 하나로 잡힘 → **요소 + 요소 내 상대 영역** 앵커 (§6) |
| 화면 상태 | FAB 조망 → BAY-4 상세, 설비정보 탭, LIVE/REC, 보조 창 | 앵커 요소가 보일 때만 마커 표시, 어느 뷰에서 달았는지 기록 (§6.3) |
| 움직임 | rAF 루프, 13.4초 순환 | 마커는 매 프레임 위치 추적. 품은 화면 **일시정지** (§5.4) |
| 해상도 | `#app`에 CSS `zoom`, 1440×900 이상 권장 | 화면별 기준 뷰포트(기본 1920×1080)로 띄우고 축소 표시 (§4.2) |
| 버전 | `index - old.html`(v1)과 `index.html`(v2)이 같은 `data/`를 씀 | 내용 해시 저장으로 데이터 중복 제거 (§3.3) |
| 외부 의존 | Pretendard CDN (dynamic-subset, woff2 92개 ≈ 3MB) | 동일 폰트의 단일 variable woff2(2.0MB)로 대체해 포함 (§5.3) |
| 기획 문서 | `README.md` 60KB — 화면 의도, 데이터 근거, 결정 기록 | 화면의 **설명** 탭으로 담는다. 화면정의서 본문 |

### 2.1 용량 추정

| 내용 | 원본 | gzip | 문서 내(base64) |
|---|---|---|---|
| v2 화면 + data | 3.4MB | 0.96MB | 1.3MB |
| v1 추가 (data 공유) | +0.29MB | +0.09MB | +0.12MB |
| Pretendard variable | 2.0MB | (압축 불가) | 2.7MB |
| Manna 런타임 | — | — | 약 0.15MB |
| **합계** | | | **약 4.3MB** |

메일 첨부(일반적으로 10~25MB)에 무리가 없다. 미참조 `assets/` 2.7MB는 제외했을 때 기준이다.

---

## 3. Manna 파일 형식

### 3.1 구조

```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>OHT 모니터링 화면정의서 v1.2</title>
<script type="application/json" id="manna-doc">{ ...문서 데이터... }</script>
<script type="application/octet-stream" id="manna-blob-3f9a…" data-enc="gzip+b64">H4sIA…</script>
<script type="application/octet-stream" id="manna-blob-81c2…" data-enc="b64">d09GMg…</script>
<style id="manna-style">/* 런타임 CSS */</style>
</head>
<body>
<script id="manna-runtime">/* 런타임 JS (IIFE) */</script>
</body>
</html>
```

- **문서 데이터**는 JSON 하나다. 블롭과 분리되어 있으므로 따로 꺼내 읽거나 주고받을 수 있다.
- **블롭**은 화면 패키지의 파일 하나하나다. 이름은 내용의 SHA-256이다. 텍스트는 `gzip+b64`, 이미 압축된 것(woff2, png, jpg)은 `b64`로 담는다. 압축은 브라우저 내장 `CompressionStream`/`DecompressionStream`을 쓴다.
- **저장**은 런타임이 자기 자신을 다시 직렬화하는 것이다. 바뀌는 것은 문서 데이터 JSON뿐이고, 블롭과 런타임 문자열은 읽은 그대로 다시 쓴다.
- JSON 안의 `<`는 `<`로 이스케이프해 `</script>` 조기 종료를 막는다.

### 3.2 문서 데이터

```ts
interface MannaDoc {
  format: 'manna/1';
  id: string;                  // 문서 UUID. 병합 시 같은 문서인지 판별
  meta: { title: string; project?: string; version: string; createdAt: string; updatedAt: string };
  changelog: { version: string; date: string; author: string; note: string }[];
  participants: { id: string; name: string; role?: string }[];
  screens: Screen[];
  origin?: { by: string; at: string; baseUpdatedAt: string }; // 수신자가 저장한 회신본이면 기록
}

interface Screen {
  id: string;                  // 'SCR-003'
  title: string;               // '설비정보 확인'
  description?: BlobRef;       // README.md 등 화면 설명 문서
  versions: ScreenVersion[];
  annotations: Annotation[];
}

interface ScreenVersion {
  v: number;
  label?: string;
  createdAt: string;
  entry: string;               // 'index.html'
  viewport: { w: number; h: number; fit: 'contain' | 'width' };
  files: Record<string, { sha: string; size: number; type: string }>;  // 가상 경로 → 블롭
  external: { url: string; sha?: string; excluded?: boolean }[];       // 원래 외부 URL → 포함된 블롭
}
```

### 3.3 내용 해시와 중복 제거

같은 내용의 파일은 버전이 달라도 블롭 하나다. proto의 v1과 v2는 `data/` 2.9MB를 공유하므로 v1 추가 비용은 HTML 하나(gzip 88KB)뿐이다.

---

## 4. 화면 구성

### 4.1 레이아웃

Manna와 Bethlehem은 같은 화면을 쓴다. Bethlehem은 왼쪽 화면 목록과 작성 전용 기능이 더 있을 뿐이다.

```
┌──────────────────────────────────────────────────────────────────────┐
│ 문서 제목 · 화면 ▾ · 버전 ▾ │ 보기 · 어노테이션 │ ⏸ │ ☀/☾ │ 저장     │
├────────────┬────────────────────────────────────────┬────────────────┤
│ 화면 목록  │                                        │ TODO  설명     │
│ SCR-001    │       품은 화면 (실제 동작)             │ ───────────── │
│ SCR-002    │       ① ② ③ 마커                       │ ① 요청 · 열림 │
│ ▸ SCR-003  │                                        │ ② 질문 · 완료 │
│   v1  v2   │                                        │ ③ (다른 화면) │
│ (Bethlehem)│                                        │                │
└────────────┴────────────────────────────────────────┴────────────────┘
```

### 4.2 스테이지

품은 화면은 기준 뷰포트(기본 1920×1080) 크기의 iframe으로 띄우고 `transform: scale()`로 남는 영역에 맞춘다. 화면 자신은 늘 같은 크기에서 돌기 때문에 레이아웃이 작성자가 본 그대로 유지된다. proto처럼 내부에서 `zoom`으로 해상도에 적응하는 화면도 기준 뷰포트 안에서 의도대로 동작한다. 화면별로 기준 뷰포트와 맞춤 방식(전체 맞춤 / 폭 맞춤)을 바꿀 수 있다.

### 4.3 디자인 토큰

디자인 가이드 §8.1 원시 토큰을 그대로 쓰고, §8.2 시맨틱 매핑으로 라이트/다크를 전환한다. 자체 UI는 Pretendard를 쓴다. 문서에 Pretendard 블롭이 있으면 그것을 같이 쓰고, 없으면 시스템 폰트로 폴백한다.

| 요소 | 토큰 |
|---|---|
| 마커 (기본) | `neutral-900` 바탕 + 흰 번호, 상태색 테두리 |
| 마커 (선택·호버) | `primary-500` — Accent 1 비중 안에서만 쓴다 |
| 상태 열림 / 진행 중 / 완료 / 보류 | `neutral` / `primary` / `success` / `warning` (항상 레이블 병기) |
| 유형 이슈 | `error` |

**브랜드 자산.** `docs/icon.png`는 Bethlehem 창·앱 아이콘과 Manna 파비콘(64px, 약 14KB)으로, `docs/key_art.png`는 Bethlehem 첫 화면에 쓴다. 키 아트는 용량(0.8MB) 때문에 Manna 에 넣지 않는다. 툴바 로고는 키 아트의 잎 마크를 SVG 로 옮긴 것이고, 그 녹색은 로고에만 쓴다 — UI 색상은 가이드 팔레트만 쓴다.

---

## 5. 화면 품기 — 가상 파일 시스템

### 5.1 iframe 로딩

1. 엔트리 HTML 블롭을 풀어 `DOMParser`로 읽는다. 원본은 건드리지 않고 메모리에서만 다룬다.
2. 정적 참조(`script[src]`, `link[href]`, `img[src]`, `source`, `video`, `audio`, 인라인 `style`의 `url()`)를 패키지 파일의 Blob URL로 바꾼다. CSS 파일은 내부 `url()`을 그 CSS 파일의 경로 기준으로 풀어 바꾼 뒤 Blob URL로 만든다.
3. `<head>` 맨 앞에 shim 스크립트를 넣는다.
4. `iframe.srcdoc`으로 띄운다. srcdoc 문서는 부모와 같은 출처이므로 부모(Manna)가 내부 DOM에 접근할 수 있고, 이것이 어노테이션의 전제다.

### 5.2 shim — 실행 중 요청 가로채기

품은 화면의 스크립트보다 먼저 실행되어 다음을 패치한다. 받은 경로를 현재 가상 문서 경로 기준으로 풀어 패키지에 있으면 Blob URL로 바꾸고, 없으면 원래대로 통과시킨다.

| 대상 | proto에서의 쓰임 |
|---|---|
| `HTMLScriptElement.prototype.src` setter, `setAttribute('src')` | `data/*.js` 동적 로딩 — **필수** |
| `fetch`, `XMLHttpRequest.open` | (proto 미사용) |
| `HTMLImageElement.src`, `Image`, `HTMLLinkElement.href` | (proto 미사용) |
| `Worker` | 코드를 블롭으로 바꿔 생성 (CONCEPT §8) |

풀리지 않은 요청은 **패키지 진단**에 쌓인다. Bethlehem은 이것을 보고 "이 화면은 X 파일을 찾지 못했다"를 원인·위치·조치와 함께 보여 준다 (가이드 UX-2).

### 5.3 외부 리소스

Bethlehem(Electron 메인 프로세스, CORS 제약 없음)이 굽기 시점에 외부 URL을 내려받는다. CSS면 그 안의 `url()`까지 재귀로 받는다. 원래 URL → 블롭 매핑은 `external`에 기록하고, shim과 정적 치환이 같은 매핑을 쓴다.

- **알려진 대체**: Pretendard dynamic-subset(woff2 92개)은 같은 폰트의 단일 variable woff2로 바꿔 담는다 (3MB → 2MB, 파일 92개 → 1개).
- **제외**: 리소스별로 체크를 끄면 링크를 그대로 둔다. 오프라인에서 달라질 수 있다는 표시를 남긴다.

### 5.4 일시정지

shim이 품은 화면의 `requestAnimationFrame`, `performance.now`, `Date.now`를 감싼다. 일시정지 중에는 rAF 콜백을 보류하고, 재개하면 멈춰 있던 시간만큼 시계를 빼서 넘긴다. 화면 입장에서는 시간이 멈췄다가 이어진다. 움직이는 대상(주행 중 OHT, 경고 펄스)에 어노테이션을 달 때 쓴다. `setTimeout`/`setInterval`은 1차 범위에서 제외한다.

---

## 6. 어노테이션 — Leaven

### 6.1 데이터

```ts
interface Annotation {
  id: string;                  // UUID
  no: number | null;           // 표시 번호. 수신자가 새로 단 항목은 null(병합 시 부여)
  version: number;             // 붙어 있는 화면 버전
  anchor: Anchor;
  kind: '설명' | '요청' | '질문' | '이슈';
  status: '열림' | '진행 중' | '완료' | '보류';
  assignee?: string;
  body: string;
  author: string; createdAt: string; updatedAt: string;
  replies: { id: string; author: string; at: string; body: string }[];
  history: { at: string; by: string; field: string; from: unknown; to: unknown }[]; // 병합용
}

interface Anchor {
  fp: Fingerprint;
  region?: { x: number; y: number; w: number; h: number };  // 요소 박스 기준 0~1
  trail: string[];             // 달 때 선택되어 있던 탭·토글 레이블 (예: ['모니터링', 'LIVE'])
  props?: Record<string, string>;  // 크기, 색상, 폰트 등 계산된 스타일 (개발자용)
}

interface Fingerprint {
  id?: string;
  selector: string;            // nth-of-type 경로
  tag: string;
  classes: string[];
  text?: string;               // 앞 80자
  attrs: Record<string, string>;   // aria-label, role, data-*
  ancestry: string[];          // 가까운 id 조상들
}
```

### 6.2 앵커 — 요소 + 영역

- **클릭**: 요소를 잡는다. 하이라이트 상태에서 `↑`/`↓`로 부모/자식으로 옮긴다. 작성 창에 글을 쓰는 중에는 `Alt+↑`/`Alt+↓`.
- **드래그**: 영역을 잡는다. 시작점 아래 요소(canvas면 그 canvas, 아니면 드래그 박스를 모두 품는 가장 깊은 요소)를 기준으로 상대 좌표 0~1을 저장한다. proto의 3D 맵 위 레일 결함 지점, FAB 조망의 특정 구역이 이 방식으로 달린다.
- 상대 좌표이므로 스케일, `zoom`, 창 크기가 바뀌어도 같은 자리를 가리킨다.

### 6.3 표시

마커 레이어는 iframe 바깥(부모 문서)에 있다. 매 프레임 앵커 요소의 `getBoundingClientRect()`를 스테이지 스케일로 변환해 마커를 옮긴다.

- 앵커 요소가 `checkVisibility()`로 보이고 뷰포트 안에 있을 때만 마커를 띄운다.
- 패널은 "지금 화면에 보이는 항목"과 "다른 화면 상태에 있는 항목"으로 나눠 보여 준다. 안 보이는 항목은 흐리게, 달 때의 `trail`을 붙여 "모니터링 · LIVE 상태에서 작성"처럼 안내한다.
- `trail`은 화면의 `aria-selected` · `aria-pressed` · `aria-current` 요소 레이블에서 자동으로 얻는다. 접근성 속성을 쓰지 않는 화면에서는 비어 있을 수 있다.

### 6.4 찾기와 재부착

열 때는 `id` → `selector` → 지문 점수 순으로 요소를 찾는다. 점수는 태그, 클래스, 텍스트, 속성, 조상 일치를 가중합한다. 새 화면 버전으로 넘어갈 때(재부착) Bethlehem이 모든 어노테이션을 새 버전에서 다시 찾아 신뢰도를 보여 주고, 낮은 것만 작성자가 다시 지정한다.

**Phase 0 현재**: 새 버전 등록 시 "기존 어노테이션을 새 버전으로 옮기기"를 고르면 버전 번호만 옮기고, 화면에서는 지문 점수로 찾는다. 신뢰도 표시와 재지정 UI는 아직 없다. proto의 v1(`index - old.html`)로 옮겼을 때 `#tabB`(설비정보 확인)에 단 항목이 옛 화면의 다른 탭에 붙는 것을 확인했다 — 같은 id가 다른 탭을 가리키기 때문이다. Phase 1에서 신뢰도와 함께 "텍스트가 달라졌음" 같은 차이를 보여 줘야 한다.

---

## 7. 저장과 병합

### 7.1 Manna 안에서 저장

| 환경 | 동작 |
|---|---|
| Chrome / Edge | 첫 저장 때 `showSaveFilePicker`로 파일을 한 번 지정, 이후 같은 파일에 덮어쓰기 |
| Firefox / Safari | `{제목}_v{버전}_{이름}.html`로 다운로드 |
| Bethlehem | Electron `fs`로 바로 쓰기 |

수신자는 처음 열 때 이름을 한 번 입력한다. 이름은 브라우저 `localStorage`에 기억해 다음에 열 때 다시 묻지 않는다 (실패해도 다시 물을 뿐이다).

### 7.2 병합 (Bethlehem)

같은 `doc.id`의 회신본들을 원본에 합친다.

- 어노테이션과 답글은 UUID로 식별한다. 새 것은 추가하고, 같은 것은 필드별 `history` 시각 기준으로 나중 것을 쓴다.
- 같은 필드를 양쪽이 다르게 바꿨으면 충돌 목록에 올려 작성자가 고른다.
- 수신자가 새로 단 항목(`no: null`)은 병합 시 번호를 받는다. 수신자 화면에서는 "새 1", "새 2"로 보인다.

---

## 8. 저장소 구조

```
Bethlehem/
├── package.json             패키지 하나 · npm start = Manna 런타임 빌드 + electron-vite dev
├── electron.vite.config.ts  main · preload(cjs) · renderer
├── apps/
│   └── bethlehem/
│       ├── main/            창, 파일 입출력, 화면 패키징·외부 리소스 다운로드 (net.fetch)
│       ├── preload/         렌더러에 노출할 최소 API (contextBridge)
│       ├── shared/          preload ↔ renderer API 타입
│       ├── renderer/        화면 목록, 화면 등록 대화상자, 첫 화면 — 나머지는 packages/manna 의 틀
│       └── resources/       앱 아이콘 (docs/icon.png 에서 만든 크기별 PNG)
├── packages/
│   ├── core/src/            문서 스키마, 블롭 코덱, 가상 FS, Leaven(지문·찾기), Manna 파일 읽기·쓰기 — 브라우저/Node 공용
│   ├── core/node/           폴더 훑기·패키징 — Node 전용
│   └── manna/               Manna 런타임 — 단일 IIFE + CSS 로 빌드되어 내보낸 HTML 에 인라인 (packages/manna/vite.config.ts)
├── scripts/bake.ts          명령줄 굽기 (Bethlehem 없이 폴더 → Manna)
├── tests/                   E2E — e2e.ts(Manna, Chrome) · e2e-bethlehem.ts(Electron)
├── example/proto/           첫 빵
└── docs/
```

npm workspaces 로 나누지 않고 패키지 하나에 폴더만 나눴다. 세 갈래가 같은 TypeScript 소스를 경로 별칭(`@core`, `@core/node`, `@manna`)으로 직접 가져다 쓰므로, 패키지 사이 빌드 순서를 관리할 일이 없다.

**보안.** Electron 렌더러는 `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`로 띄운다. 품은 화면은 Node 에 닿지 않는다. 다만 품은 화면은 Bethlehem UI 와 같은 출처(srcdoc)에서 돌기 때문에 `window.parent.bethlehem` API 를 부를 수 있다. 그래서 메인 프로세스는 사용자가 대화상자로 고르거나 창에 끌어다 놓은 경로만 읽고 쓴다. 끌어다 놓은 경로는 preload 가 `webUtils.getPathForFile`로 진짜 `File` 에서만 얻으므로 스크립트가 지어낼 수 없다. 렌더러 CSP 는 품은 화면에 그대로 물려지므로 인라인 스크립트·eval·CDN 을 막지 않는다.

---

## 9. 단계

### Phase 0 — 첫 빵 굽기

proto를 Manna 한 장으로 구워 내는 것까지. 가장 위험한 기술(가상 FS, canvas 영역 앵커, zoom 위 마커)을 여기서 검증한다.

**완료 기준**

1. `npm start` → Bethlehem 창 → `example/proto` 폴더를 끌어다 놓으면 화면이 등록된다. 엔트리 자동 감지, 미참조 파일(`assets/` 3개) 제외 제안, Pretendard 포함.
2. Bethlehem 안에서 화면이 원본과 똑같이 동작한다. 데이터 로딩 스플래시 완료, FAB 조망 → BAY-4 상세, 설비정보 탭.
3. DOM 요소 클릭, canvas 영역 드래그, 일시정지 후 달기, 뷰 전환 시 마커 숨김/표시가 된다.
4. 저장하면 HTML 하나가 나온다. Chrome과 Firefox에서 더블클릭으로 열리고, 오프라인에서도 똑같이 보인다.
5. 수신자 흐름: 이름 입력 → 답글, 상태 변경, 새 어노테이션 → 저장 (Chrome 덮어쓰기 / Firefox 다운로드).
6. `index - old.html`을 v1, `index.html`을 v2로 등록하면 데이터가 한 번만 들어가고 버전 전환이 된다.

**검증 항목**: CSS `zoom` 안 요소의 `getBoundingClientRect()` 값 (Chromium 128+ 표준 zoom 동작), srcdoc iframe에서 동적 `<script>` 순차 로딩, 1.9MB 데이터 블롭 해제 속도.

**결과 (2026-10-01)**

| 기준 | 상태 | 근거 |
|---|---|---|
| 1 화면 등록 | 완료 | `test:e2e:app` — 엔트리 자동 감지, `assets/` 3개와 옛 HTML 에 "미참조 추정", README 설명, Pretendard 단일 woff2 로 포함 |
| 2 원본과 같은 동작 | 완료 | 두 E2E 모두 데이터 6채널 로딩 완료, 찾지 못한 파일 0 |
| 3 어노테이션 | 완료 | 요소 클릭, `canvas#fabCv` 영역 드래그, 일시정지(시계 정지 확인), 설비정보 탭 이동 시 FAB 마커 숨김 → 복귀 시 다시 표시 |
| 4 HTML 한 장 · 오프라인 | Chrome 완료 | `test:e2e` — `file://`, 외부 네트워크 없이 Pretendard 적용. **Firefox 는 설치돼 있지 않아 확인하지 못했다** |
| 5 수신자 흐름 | Chrome 완료 | 이름 입력 → 어노테이션 → 다운로드 저장 → 다시 열기, "새 N" 번호. `showSaveFilePicker` 덮어쓰기는 대화상자라 자동 확인하지 못했다 |
| 6 버전 · 중복 제거 | 완료 | v1+v2 = 4.1MB (데이터 블롭 공유, 예상 4.3MB) |

검증 항목은 모두 문제가 없었다: `zoom` 안의 `getBoundingClientRect()`는 확대가 반영된 값을 돌려주고, `file://` 문서가 만든 `blob:null/…` URL 을 srcdoc iframe 이 불러오며, 문서 열기부터 화면 스플래시 종료까지 약 1초다.

### Phase 1 — 협업

병합, 재부착 신뢰도와 재지정 UI(§6.4), 화면 CSS 변수 이름 역추적(`#F86517` → `--brand`), 변경 이력 화면, 버전 나란히 비교, 어노테이션 썸네일(`capturePage`), Firefox·Safari 확인.

### Phase 2 — 빵집 확장

외부 URL 스냅샷, 움직임 클립 녹화, 모듈 번들링(esbuild), Worker 변환, 배포 빌드와 자동 업데이트.
