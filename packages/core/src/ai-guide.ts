/* 테라리움 문서 맨 앞에 넣는 "AI · 도구가 읽는 법" — 사람이 브라우저로 보는 것과 같은 정보를 글로 찾아가게 한다.
 * HTML 주석이라 화면에는 보이지 않는다. 주석 안에서는 하이픈 두 개를 쓰지 않는다(주석이 끝난 것으로 읽힐 수 있다).
 */
import type { MannaDoc } from './types';

export const AI_GUIDE_MARK = 'TERRARIUM-AI-GUIDE';

/** 사람이 쓴 글(제목 등) — 주석 · 태그로 읽힐 글자를 비슷한 모양으로 바꾼다 */
const plain = (t: string) => t.replace(/</g, '‹').replace(/>/g, '›');

export function aiGuide(doc: MannaDoc): string {
  const n = doc.screens.reduce((k, s) => k + s.annotations.length, 0);
  const screens = doc.screens
    .map((s) => {
      const v = s.versions[s.versions.length - 1];
      const mode = v?.source?.mode === 'site' ? `URL 화면 ${v.source.url}` : v?.source?.mode === 'image' ? '그림 화면' : `폴더 화면, 시작 파일 ${v?.entry ?? ''}`;
      return `   ${s.id} "${plain(s.title)}" · ${plain(mode)} · 버전 ${s.versions.map((x) => x.v).join(',')} · Comment ${s.annotations.length}`;
    })
    .join('\n');
  const body = `
${AI_GUIDE_MARK} (format ${doc.format})
이 파일은 테라리움 문서다. 사람이 브라우저로 열면 화면 · Comment 가 그려져 보이고, 그 내용은 모두 이 파일 안에 글로 들어 있다.
AI 나 도구는 아래 순서로 읽으면 사람이 보는 것과 같은 것을 찾을 수 있다. 화면 코드(런타임)는 읽지 않아도 된다.

[이 문서] "${plain(doc.meta.title)}" v${plain(doc.meta.version)} · 화면 ${doc.screens.length}개 · Comment ${n}개 · 마지막 수정 ${doc.meta.updatedAt}
${screens}

1. 문서 데이터: id 가 manna-doc 인 script 태그(type application/json) 안의 JSON 한 덩어리. 이 주석 바로 아래 head 안의 첫 번째 것이다
   (같은 글자가 맨 아래 화면 코드 안에도 나오지만 그것은 데이터가 아니다).
   screens[] = 화면(탭). 각 화면: id, title, notes(자유 노트 첫 탭, 마크다운), notesTitle, moreNotes[]{title, body}, versions[], annotations[].
   versions[] = 화면의 버전: v, entry(시작 파일), files{"경로": {sha, type}}, source.mode("site" = URL 화면, "image" = 그림 화면, 없으면 폴더 화면).
2. Comment = screens[].annotations[]. 번호는 같은 version 인 Comment 들 사이에서의 순서(1부터)다. 완료로 숨겨도 번호는 그대로.
   title(제목), body(마크다운 본문), author(쓴 사람) → assignee(담당), done{by, at}(있으면 완료), replies[]{author, at, body}(답글),
   kind "capture"(그 순간의 화면을 찍어 둔 Comment), clips[]{sha, type}(녹화 영상), createdAt, updatedAt.
3. Comment 가 가리키는 자리 = anchor. 없으면 화면 전체에 단 Comment.
   anchor.html   대상 요소의 실제 HTML 조각 (가장 먼저 볼 것)
   anchor.fp     요소 지문: id, selector(CSS 선택자), tag, classes, text(요소의 글자), attrs, ancestry(id 가 있는 조상, 가까운 것부터)
   anchor.region 요소 박스 안의 영역 (0~1 비율 x, y, w, h). 있으면 요소 전체가 아니라 그 일부(캔버스 위 한 구역 등)
   anchor.page   단 페이지 (폴더 화면은 패키지 안 파일 경로, URL 화면은 주소). 없으면 시작 파일
   anchor.trail  그때 화면에서 골라져 있던 탭 · 토글의 이름들 (어느 화면 상태였는지)
   anchor.path   그 상태로 가려고 누른 클릭들 (fp + 요소 안 0~1 위치)
4. 달 때 찍은 화면 = shot{sha, w, h, box}. sha 의 블롭이 JPEG 그림이고, box(0~1 비율)가 그림 안에서 대상이 있는 자리다.
   그림에는 박스가 그려져 있지 않다 — box 를 그림 크기에 곱해 직접 그리거나 잘라 보면 된다.
   코드로 집기 어려운 자리(캔버스 위 영역, URL 화면)는 이 그림과 box 로 정확히 보인다.
5. 블롭 = 파일 내용. id 가 manna-blob-{sha} 인 script 태그(type application/octet-stream, data-enc 속성이 gz64 또는 b64) 안의 base64.
   b64 는 base64 를 풀면 원래 바이트, gz64 는 base64 를 푼 뒤 gzip 을 한 번 더 풀면 원래 바이트다.
   화면의 원본 파일: versions[].files["index.html"].sha 의 블롭. Comment 가 단 버전은 annotations[].version.
6. 대상을 원본 코드에서 찾는 순서: anchor.page(없으면 entry) 파일을 풀고, fp.id 의 id="…" 를 찾는다.
   id 가 없거나 스크립트가 만든 요소면 ancestry 의 조상 id, fp.text, anchor.html 의 글자 · 클래스로 찾는다.
   그래도 안 되면(캔버스 안 그림, URL 화면) shot 그림의 box 자리를 본다.
7. 예 (Node.js): 블롭 풀기
   const m = html.match(new RegExp('manna-blob-' + sha + '. data-enc=.(gz64|b64).>([^<]*)'));
   const raw = Buffer.from(m[2], 'base64'); const bytes = m[1] === 'gz64' ? require('zlib').gunzipSync(raw) : raw;
   예 (Python): raw = base64.b64decode(data); bytes = gzip.decompress(raw) if enc == "gz64" else raw
`;
  // 주석 안에서는 하이픈 두 개를 피한다
  return `<!--${body.replace(/-{2,}/g, '‐‐')}-->`;
}
