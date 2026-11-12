/* Comment 그룹의 차례 — 패널 · 내보내기 창 · 내보낸 HTML 이 같은 차례를 쓴다 */
import type { Annotation, CommentGroup } from '@core';

export const NO_GROUP = '그룹 없음';

export interface CommentSection {
  /** null = 그룹 없음 */
  id: string | null;
  name: string;
  collapsed: boolean;
  cards: Annotation[];
}

/** 맨 위에 그룹 없음, 그 아래 그룹들(meta.groups 순서 — 만든 순서 · 끌어서 바꾼 순서). 묶음 안은 받은 list 의 차례(번호 순서) 그대로 */
export function commentSections(list: Annotation[], gs: CommentGroup[]): CommentSection[] {
  return [
    { id: null, name: NO_GROUP, collapsed: false, cards: list.filter((a) => !a.group || !gs.some((g) => g.id === a.group)) },
    ...gs.map((g) => ({ id: g.id, name: g.name, collapsed: !!g.collapsed, cards: list.filter((a) => a.group === g.id) })),
  ];
}

/** 화면에 보이는 차례로 늘어놓기 — 그룹별로 볼 때는 묶음 차례, 아니면 받은 차례 그대로 */
export function inShownOrder(list: Annotation[], gs: CommentGroup[], grouped: boolean): Annotation[] {
  return grouped && gs.length ? commentSections(list, gs).flatMap((s) => s.cards) : list;
}

/** Comment 의 그룹 이름 — 없거나 지워진 그룹이면 undefined */
export const groupName = (a: Annotation, gs: CommentGroup[]): string | undefined => gs.find((g) => g.id === a.group)?.name;
