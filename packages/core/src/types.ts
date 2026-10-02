/* Manna 문서 데이터 — docs/ARCHITECTURE.md §3.2, §6.1 */

export const FORMAT = 'manna/1';

/** 블롭 인코딩. gz64 = gzip 후 base64, b64 = base64 그대로(이미 압축된 woff2·png 등) */
export type BlobEnc = 'gz64' | 'b64';

export interface EncodedBlob {
  enc: BlobEnc;
  data: string;
}

/** sha → 인코딩된 블롭. 문서 저장 시 그대로 다시 쓴다 */
export type BlobStore = Map<string, EncodedBlob>;

export interface FileEntry {
  sha: string;
  size: number;
  type: string;
}

export interface ExternalEntry {
  url: string;
  sha?: string;
  type?: string;
  size?: number;
  excluded?: boolean;
  /** 다른 외부 리소스(CSS)가 끌고 온 것이면 그 URL. 부모를 빼면 같이 빠진다 */
  via?: string;
  /** 원래 리소스를 다른 것으로 바꿔 담았을 때의 설명 (예: Pretendard dynamic-subset → 단일 woff2) */
  note?: string;
  /** 내려받지 못했을 때의 사유 */
  error?: string;
}

export interface Viewport {
  w: number;
  h: number;
  fit: 'contain' | 'width';
}

export interface ScreenVersion {
  v: number;
  label?: string;
  createdAt: string;
  /** 시작 파일. 패키지 경로('index.html') 또는 URL 스냅샷이면 원래 페이지 URL */
  entry: string;
  /** URL 로 담은 화면이면 어떻게 담았는지 */
  /** site: URL 화면(편집기에서는 실시간, 보낸 파일에는 사본) · image: 그림 화면(영역 박스만) · live·static: 예전 담기 방식 */
  source?: { url: string; mode: 'site' | 'image' | 'live' | 'static'; at: string };
  viewport: Viewport;
  files: Record<string, FileEntry>;
  external: ExternalEntry[];
}

export interface Screen {
  id: string;
  title: string;
  /** 자유 노트의 첫 탭 — 마크다운. README 를 가져오면 한 번 복사된 뒤로는 문서의 텍스트다 */
  notes: string;
  /** 첫 탭의 제목 (없으면 "개요") */
  notesTitle?: string;
  /** 자유 노트의 나머지 탭 — 화면의 어느 자리에도 묶이지 않는 글 */
  moreNotes?: NoteTab[];
  versions: ScreenVersion[];
  annotations: Annotation[];
}

export interface NoteTab {
  id: string;
  title: string;
  body: string;
}

export interface Fingerprint {
  id?: string;
  selector: string;
  tag: string;
  classes: string[];
  text?: string;
  attrs: Record<string, string>;
  ancestry: string[];
}

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Anchor {
  fp: Fingerprint;
  /** 요소 박스 기준 0~1 상대 영역. 없으면 요소 전체 */
  region?: Region;
  /** 달 때 선택되어 있던 탭·토글 레이블 (예: ['FAB', 'LIVE']) */
  trail: string[];
  /** 계산된 스타일 (개발자용) */
  props?: Record<string, string>;
  /** 화면을 연 뒤 달기 전까지의 클릭 — 다른 화면 상태에 있는 대상으로 돌아갈 때 다시 누른다 */
  path?: Step[];
  /** 단 페이지 — 폴더 화면은 패키지 경로('detail.html'), URL 화면은 주소. 없으면 시작 페이지 */
  page?: string;
  /** 대상 요소의 실제 HTML 조각 — 사람 · AI 가 코드에서 그 자리를 집을 수 있게 (길면 여는 태그 + 글자 일부) */
  html?: string;
}

/** 화면 위 클릭 한 번 — 요소 지문과 요소 안의 상대 위치(0~1). 캔버스 위 클릭도 다시 낼 수 있다 */
export interface Step {
  fp: Fingerprint;
  x: number;
  y: number;
}

/** Comment 를 달던 순간의 스테이지 그림 (JPEG). box 는 그림 안의 대상 위치(0~1) */
export interface Shot {
  sha: string;
  w: number;
  h: number;
  box?: Region;
}

/** 녹화한 움직임 클립 (webm) */
export interface Clip {
  id: string;
  sha: string;
  type: string;
  ms: number;
  w: number;
  h: number;
  author: string;
  at: string;
}

export interface Reply {
  id: string;
  author: string;
  at: string;
  /** 마크다운 */
  body: string;
}

export interface Change {
  at: string;
  by: string;
  field: string;
  from: unknown;
  to: unknown;
}

export interface Annotation {
  id: string;
  /** 번호는 따로 두지 않는다 — 화면 버전 안에서의 순서가 곧 번호다 (끌어서 바꾼다) */
  version: number;
  /** 없으면 화면 전체에 단 Comment (녹화 클립 등) */
  anchor?: Anchor;
  /** 'capture' — 영역을 찍어 둔 Comment. 실시간 화면에는 마커를 붙이지 않고, 열면 찍어 둔 그림(과 클립)을 보인다 */
  kind?: 'capture';
  /** 제목 — 없어도 된다. 카드와 화면의 마커 옆에 보인다 */
  title?: string;
  /** 담당 — 없어도 된다. "쓴 사람 → 담당" 으로 보인다 */
  assignee?: string;
  /** 완료 — 지우지 않고 숨긴다. "완료 보기" 로 다시 본다. 번호는 그대로 */
  done?: { by: string; at: string };
  /** 마크다운. 할 일은 - [ ] 체크박스로 */
  body: string;
  clips?: Clip[];
  /** 달 때의 화면 전체 — 나중에 이 Comment 를 열면 이 그림과 박스가 보인다 */
  shot?: Shot;
  author: string;
  createdAt: string;
  updatedAt: string;
  replies: Reply[];
  history: Change[];
}

export const MARKER_COLORS = ['auto', 'brand', 'black', 'white', 'blue', 'amber', 'red'] as const;
export type MarkerColor = (typeof MARKER_COLORS)[number];

export interface Participant {
  name: string;
  role?: string;
}

export interface MannaDoc {
  format: typeof FORMAT;
  id: string;
  meta: {
    title: string;
    project?: string;
    version: string;
    createdAt: string;
    updatedAt: string;
    /** 마커 색. 기본 auto — 마커 아래 배경 밝기에 따라 어둡게/밝게 */
    marker?: MarkerColor;
  };
  changelog: { version: string; date: string; author: string; note: string }[];
  participants: Participant[];
  screens: Screen[];
  /** 수신자가 저장한 회신본이면 누가 언제 저장했는지 */
  origin?: { by: string; at: string; baseUpdatedAt: string };
}
