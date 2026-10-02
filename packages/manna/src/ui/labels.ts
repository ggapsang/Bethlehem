export function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}

export function anchorLabel(fp: { tag: string; id?: string; classes: string[] }, region: boolean): string {
  const base = fp.id ? `${fp.tag}#${fp.id}` : fp.classes[0] ? `${fp.tag}.${fp.classes[0]}` : fp.tag;
  return region ? `${base} 안의 영역` : base;
}

/** Comment 가 지금 화면에서 어떤 상태인가 — 마커 줄과 패널 카드가 같은 구분을 쓴다 */
export type MarkState = 'live' | 'other' | 'capture' | 'screen';
/** site — URL 화면이면 화면 위 대상이 있는 Comment 는 모두 캡처다 (사이트는 언제 어떻게 바뀔지 모른다) */
export function markState(a: { anchor?: unknown; kind?: string; id: string }, visible: ReadonlySet<string>, site = false): MarkState {
  if (!a.anchor) return 'screen';
  if (a.kind === 'capture' || site) return 'capture';
  return visible.has(a.id) ? 'live' : 'other';
}
export const MARK_LABEL: Record<MarkState, string> = { live: '화면에 있음', other: '다른 상태', capture: '캡처', screen: '화면 전체' };
