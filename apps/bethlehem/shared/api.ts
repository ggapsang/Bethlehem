/* 렌더러에 노출하는 Bethlehem API — preload 와 렌더러가 같이 쓰는 타입 */
import type { Runtime } from '@core';
import type { PackOptions, PackResult, ScanResult } from '@core/node/pack';
import type { SnapshotResult } from '../main/snapshot';

export interface OpenedFile {
  path: string;
  name: string;
  html: string;
}

export interface Granted {
  path: string;
  name: string;
  isDir: boolean;
}

export interface RecentItem {
  path: string;
  name: string;
  at: string;
}

export interface BethlehemApi {
  runtime(): Promise<Runtime>;
  recent(): Promise<{ files: RecentItem[]; folders: RecentItem[] }>;
  openFile(): Promise<OpenedFile | null>;
  openPath(path: string): Promise<OpenedFile>;
  saveFile(o: { html: string; path: string | null; suggestedName: string; saveAs: boolean }): Promise<string | null>;
  pickFolder(): Promise<string | null>;
  /** 최근 폴더를 다시 쓴다 (허용 목록 확인 + 최근 목록 갱신) */
  useFolder(path: string): Promise<string>;
  /** 끌어다 놓은 파일·폴더의 경로. 사용자가 놓은 것만 열 수 있도록 메인 프로세스에 등록한다 */
  grantDropped(file: File): Promise<Granted | null>;
  scanFolder(dir: string, entry?: string): Promise<ScanResult>;
  packFolder(opts: PackOptions): Promise<PackResult>;
  /** URL 담기 창을 연다. 다 담으면 onSnapshot 으로 결과가 온다 */
  openSnapshot(o: { url?: string; screenId?: string }): void;
  onSnapshot(cb: (r: { screenId?: string; result: SnapshotResult | null }) => void): void;
  setState(s: { title: string; dirty: boolean }): void;
  /** 창을 닫으려는데 저장 안 된 변경이 있을 때 — 저장하고 닫기를 요청받는다 */
  onRequestSave(cb: () => void): void;
  closeNow(): void;
}

declare global {
  interface Window {
    bethlehem: BethlehemApi;
  }
}
