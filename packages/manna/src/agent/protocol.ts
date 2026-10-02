/* 스테이지(부모) ↔ 에이전트(품은 화면 안) 메시지 — docs/ARCHITECTURE.md §6
 * 폴더 화면(srcdoc iframe)과 URL 화면(Electron webview)이 같은 메시지를 쓴다.
 *   iframe  : parent.postMessage / contentWindow.postMessage
 *   webview : 에이전트 → window.postMessage → preload → sendToHost, 반대로 webview.send → preload → window.postMessage
 * 봉투: 부모가 보내는 것은 { __terrHost: msg }, 에이전트가 보내는 것은 { __terrAgent: msg }
 */
import type { Fingerprint, Region, Step } from '@core';

export interface AnchorIn {
  id: string;
  fp: Fingerprint;
  region?: Region;
}

/** [x, y, w, h, 보임(0/1), 배경(0 밝음 · 1 어두움)] — 화면 뷰포트 좌표 */
export type RectTuple = [number, number, number, number, number, number];

export interface Picked {
  fp: Fingerprint;
  region?: Region;
  rect: [number, number, number, number];
  label: string;
  trail: string[];
  props: Record<string, string>;
  path: Step[];
}

export type HostMsg =
  | { type: 'anchors'; list: AnchorIn[] }
  | { type: 'picking'; on: boolean }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'hover'; x: number; y: number; rid: number }
  | { type: 'pick'; x: number; y: number; rid: number }
  | { type: 'pickRect'; x: number; y: number; w: number; h: number; rid: number }
  | { type: 'pickUp'; rid: number }
  | { type: 'pickDown'; rid: number }
  | { type: 'reveal'; fp: Fingerprint; region?: Region; steps: Step[]; quick: boolean; rid: number }
  | { type: 'setPath'; steps: Step[] };

export type AgentMsg =
  | { type: 'ready'; url: string; title: string }
  | { type: 'frame'; rects: Record<string, RectTuple> }
  | { type: 'key'; phase: 'down' | 'up'; key: string; ctrl: boolean; shift: boolean; meta: boolean; alt: boolean; repeat: boolean; typing: boolean }
  | { type: 'reply'; rid: number; data: unknown };
