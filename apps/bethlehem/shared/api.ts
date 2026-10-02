/* 렌더러에 노출하는 Bethlehem API — preload 와 렌더러가 같이 쓰는 타입 */
import type { EncodedBlob, MannaDoc, Runtime } from '@core';
import type { PackOptions, PackResult, ScanResult } from '@core/node/pack';
import type { SiteSnapshot } from '../main/site';
import type { Returned, SourceLink, WorkspaceData } from '../main/workspace';
import type { MenuCommand } from '../main/menu';

export type { MenuCommand, Returned, SiteSnapshot, SourceLink };

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

export interface RecentUrl {
  url: string;
  dir: string;
  at: string;
}

export interface BethlehemApi {
  runtime(): Promise<Runtime>;
  recent(): Promise<{ files: RecentItem[]; folders: RecentItem[]; workspaces: RecentItem[]; urls: RecentUrl[] }>;
  /** URL 로 연 문서의 작업 폴더 (프로그램 안) */
  wsForUrl(url: string): Promise<{ dir: string; exists: boolean }>;
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
  /** 화면으로 가져올 파일들 — 테라리움 문서 · 그림 */
  pickScreenFiles(): Promise<string[]>;
  readDoc(path: string): Promise<string>;
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
  /* 터미널 */
  termStart(o: { cols: number; rows: number }): Promise<{ pid: number; reused: boolean }>;
  termWrite(data: string): void;
  termResize(o: { cols: number; rows: number }): void;
  termKill(): void;
  onTermData(cb: (data: string) => void): void;
  onTermExit(cb: (code: number) => void): void;
  formatDoc(): Promise<string>;
  /** 바깥에서 작업 폴더 파일을 고쳤다 */
  onWorkspaceChanged(cb: (file: string) => void): void;
  /* 창 */
  toggleDevTools(): void;
  onMenu(cb: (cmd: MenuCommand) => void): void;
  setState(s: { title: string; dirty: boolean }): void;
  onRequestSave(cb: () => void): void;
  closeNow(): void;
}

declare global {
  interface Window {
    bethlehem: BethlehemApi;
  }
}
