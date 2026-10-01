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
  entry: string;
  viewport: Viewport;
  files: Record<string, FileEntry>;
  external: ExternalEntry[];
}

export interface Screen {
  id: string;
  title: string;
  description?: { sha: string; name: string };
  versions: ScreenVersion[];
  annotations: Annotation[];
}

export const KINDS = ['설명', '요청', '질문', '이슈'] as const;
export type Kind = (typeof KINDS)[number];

export const STATUSES = ['열림', '진행 중', '완료', '보류'] as const;
export type Status = (typeof STATUSES)[number];

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
}

export interface Reply {
  id: string;
  author: string;
  at: string;
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
  /** 표시 번호. 수신자가 새로 단 항목은 null — 병합 때 번호를 받는다 */
  no: number | null;
  version: number;
  anchor: Anchor;
  kind: Kind;
  status: Status;
  assignee?: string;
  body: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  replies: Reply[];
  history: Change[];
}

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
  };
  changelog: { version: string; date: string; author: string; note: string }[];
  participants: Participant[];
  screens: Screen[];
  /** 수신자가 저장한 회신본이면 누가 언제 저장했는지 */
  origin?: { by: string; at: string; baseUpdatedAt: string };
}
