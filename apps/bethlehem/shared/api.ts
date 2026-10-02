/* 렌더러에 노출하는 Bethlehem API — preload 와 렌더러가 같이 쓰는 타입 */
import type { EncodedBlob, MannaDoc, Runtime } from '@core';
import type { PackOptions, PackResult, ScanResult } from '@core/node/pack';
import type { SiteSnapshot } from '../main/site';
import type { Returned, SourceLink, WorkspaceData } from '../main/workspace';

export type { Returned, SiteSnapshot, SourceLink };

export interface OpenedFile {
  path: string;
  name: string;
  html: string;
}

export interface Granted {
  path: string;
  name: string;
  isDir: boolean;
  isWorkspace: boolean;
}

export interface RecentItem {
  path: string;
  name: string;
  at: string;
}

export interface BethlehemApi {
  runtime(): Promise<Runtime>;
  recent(): Promise<{ files: RecentItem[]; folders: RecentItem[]; workspaces: RecentItem[] }>;
  /* 단일 문서 */
  openFile(): Promise<OpenedFile | null>;
  openPath(path: string): Promise<OpenedFile>;
  saveFile(o: { html: string; path: string | null; suggestedName: string; saveAs: boolean }): Promise<string | null>;
  exportAs(o: { html: string; suggestedName: string }): Promise<string | null>;
  /* 화면 폴더 */
  pickFolder(): Promise<string | null>;
  useFolder(path: string): Promise<string>;
  grantDropped(file: File): Promise<Granted | null>;
  scanFolder(dir: string, entry?: string): Promise<ScanResult>;
  packFolder(opts: PackOptions): Promise<PackResult>;
  /* 그림 화면 */
  pickImage(): Promise<string[]>;
  packImage(path: string): Promise<{ title: string; version: PackResult['version']; blobs: [string, EncodedBlob][] }>;
  /* 작업 폴더 */
  wsPick(o?: { title?: string; defaultPath?: string }): Promise<string | null>;
  wsInspect(dir: string): Promise<{ isWorkspace: boolean; docs: { path: string; name: string; at: string; title?: string }[]; prototype: boolean; empty: boolean }>;
  wsOpen(dir: string): Promise<WorkspaceData & { last: { screen: string; version: number } | null }>;
  wsLast(): Promise<string | null>;
  wsSave(o: { dir: string; doc: MannaDoc; blobs: [string, EncodedBlob][]; links: Record<string, SourceLink> }): Promise<boolean>;
  wsBake(o: { dir: string; title: string; html: string }): Promise<string>;
  wsReturned(): Promise<Returned[]>;
  wsReadReturned(name: string): Promise<string | null>;
  wsMarkMerged(name: string): Promise<void>;
  wsReveal(what: 'dist' | 'returned' | 'root'): Promise<void>;
  wsRememberScreen(o: { dir: string; screen: string; version: number }): void;
  wsClose(): void;
  onReturnedChanged(cb: () => void): void;
  onSourceChanged(cb: (o: { screenId: string; file: string }) => void): void;
  /* 화면 */
  capture(rect: { x: number; y: number; width: number; height: number }): Promise<{ bytes: Uint8Array; w: number; h: number } | null>;
  siteSnapshot(guestId: number): Promise<SiteSnapshot>;
  /* 창 */
  toggleDevTools(): void;
  setState(s: { title: string; dirty: boolean }): void;
  onRequestSave(cb: () => void): void;
  closeNow(): void;
}

declare global {
  interface Window {
    bethlehem: BethlehemApi;
  }
}
