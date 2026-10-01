import type { Kind, Status } from '@core';

export const STATUS_CLASS: Record<Status, string> = { 열림: 'open', '진행 중': 'doing', 완료: 'done', 보류: 'hold' };
export const KIND_CLASS: Record<Kind, string> = { 설명: 'spec', 요청: 'req', 질문: 'ask', 이슈: 'issue' };

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
