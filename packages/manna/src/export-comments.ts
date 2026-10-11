/* Comment 내보내기 — 고른 Comment 만 HTML 한 장으로
 *
 * 테라리움 문서(화면 · 런타임 · 원본 파일을 다 담는다)가 아니라, 브라우저 · 메신저 미리보기 · 메일 첨부로 바로 열리는 가벼운 한 장.
 * Comment 마다 번호 · 제목 · 쓴 사람 → 담당 · 완료 · 본문 · 답글 · 달 때 찍은 화면(대상 박스를 그려서) · 녹화 영상 · 대상 요소 · 연결.
 * AI 가 읽을 수 있게 같은 내용을 JSON(script#terr-comments)으로도 넣는다.
 */
import type { Annotation, MannaDoc, Screen } from '@core';
import { decodeBlob, displayNo, toBase64 } from '@core';
import { endLabel, linksOf } from './links';
import { blobs, doc, notify, user } from './store';
import { downloadFile } from './host';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Comment 본문용 마크다운 — 제목 · 목록 · 할 일 · 인용 · 코드 · 굵게 · 기울임 · 링크. 먼저 이스케이프하므로 HTML 은 글자로 남는다 */
export function mdToHtml(src: string): string {
  const inline = (s: string) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
      .replace(/~~([^~]+)~~/g, '<s>$1</s>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  const out: string[] = [];
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^```/.test(l)) {
      flushPara();
      closeList();
      const code: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]!); i++) code.push(lines[i]!);
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    const task = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(l);
    const ul = /^\s*[-*]\s+(.*)$/.exec(l);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(l);
    const quote = /^>\s?(.*)$/.exec(l);
    if (!l.trim()) {
      flushPara();
      closeList();
    } else if (h) {
      flushPara();
      closeList();
      const n = Math.min(6, h[1]!.length + 2);
      out.push(`<h${n}>${inline(h[2]!)}</h${n}>`);
    } else if (task || ul || ol) {
      flushPara();
      const kind = ol && !task && !ul ? 'ol' : 'ul';
      if (list !== kind) {
        closeList();
        out.push(`<${kind}${task ? ' class="tasks"' : ''}>`);
        list = kind;
      }
      if (task) out.push(`<li class="task ${task[1] !== ' ' ? 'is-done' : ''}"><span class="box">${task[1] !== ' ' ? '✔' : ''}</span>${inline(task[2]!)}</li>`);
      else out.push(`<li>${inline((ul ?? ol)![1]!)}</li>`);
    } else if (quote) {
      flushPara();
      closeList();
      out.push(`<blockquote>${inline(quote[1]!)}</blockquote>`);
    } else {
      closeList();
      para.push(l);
    }
  }
  flushPara();
  closeList();
  return out.join('\n');
}

async function dataUrl(sha: string, type: string): Promise<string | null> {
  const b = blobs.get(sha);
  if (!b) return null;
  return `data:${type};base64,${b.enc === 'b64' ? b.data : toBase64(await decodeBlob(b))}`;
}

const when = (iso: string) => new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });

export interface ExportOptions {
  /** 녹화 영상을 넣는가 (크다) */
  clips: boolean;
}

/** 고른 Comment 들의 HTML — 같은 화면 것만 (탭 하나) */
export async function commentsHtml(d: MannaDoc, s: Screen, list: Annotation[], o: ExportOptions): Promise<string> {
  const by = user.peek() ?? '';
  const multiVer = s.versions.length > 1;
  const items: string[] = [];
  const data: unknown[] = [];
  for (const a of list) {
    const no = displayNo(s, a);
    const tag = `${s.id}${multiVer ? ` v${a.version}` : ''} #${no}`;
    const shot = a.shot ? await dataUrl(a.shot.sha, 'image/jpeg') : null;
    const box = a.shot?.box;
    const clips: string[] = [];
    if (o.clips) {
      for (const c of a.clips ?? []) {
        const u = await dataUrl(c.sha, c.type || 'video/webm');
        if (u) clips.push(`<figure class="clip"><video src="${u}" controls loop muted playsinline></video><figcaption>녹화 ${(c.ms / 1000).toFixed(1)}초 · ${esc(c.author)} · ${esc(when(c.at))}</figcaption></figure>`);
      }
    }
    const links = linksOf(d, (e) => e.kind === 'comment' && e.screen === s.id && e.ann === a.id).map(({ other }) => {
      const l = endLabel(d, other);
      return `<li><b>${esc(l.tag)}</b> ${esc(l.text)}</li>`;
    });
    const anchor = a.anchor;
    items.push(`<article class="c ${a.done ? 'is-done' : ''}" id="c-${esc(a.id)}">
  <header>
    <span class="no">${no}</span>
    <div class="head">
      <div class="title">${a.title ? esc(a.title) : '<span class="muted">제목 없음</span>'}</div>
      <div class="meta"><span class="mono">${esc(tag)}</span> · ${esc(a.author)}${a.assignee ? ` → <b>${esc(a.assignee)}</b>` : ''} · ${esc(when(a.createdAt))}${a.done ? ` · <span class="done">완료 (${esc(a.done.by)})</span>` : ''}</div>
    </div>
  </header>
  ${shot ? `<figure class="shot"><div class="frame"><img src="${shot}" alt="${esc(tag)} 를 달 때의 화면">${box ? `<div class="box" style="left:${box.x * 100}%;top:${box.y * 100}%;width:${box.w * 100}%;height:${box.h * 100}%"></div>` : ''}</div><figcaption>${a.kind === 'capture' ? '캡처' : 'Comment 를 달 때의 화면'}${box ? ' — 빨간 박스가 대상' : ''}</figcaption></figure>` : ''}
  ${clips.join('\n')}
  <div class="body">${a.body.trim() ? mdToHtml(a.body) : '<p class="muted">본문 없음</p>'}</div>
  ${a.replies.length ? `<ol class="replies">${a.replies.map((r) => `<li><div class="meta">${esc(r.author)} · ${esc(when(r.at))}</div>${mdToHtml(r.body)}</li>`).join('')}</ol>` : ''}
  ${links.length ? `<div class="links"><div class="label">연결</div><ul>${links.join('')}</ul></div>` : ''}
  ${anchor ? `<details class="anchor"><summary>대상 요소</summary><dl>${anchor.page ? `<dt>페이지</dt><dd class="mono">${esc(anchor.page)}</dd>` : ''}<dt>선택자</dt><dd class="mono">${esc(anchor.fp.selector)}</dd>${anchor.fp.text ? `<dt>글자</dt><dd>${esc(anchor.fp.text)}</dd>` : ''}${anchor.trail?.length ? `<dt>상태</dt><dd>${esc(anchor.trail.join(' › '))}</dd>` : ''}${anchor.html ? `<dt>HTML</dt><dd><pre><code>${esc(anchor.html)}</code></pre></dd>` : ''}</dl></details>` : ''}
</article>`);
    data.push({
      tag, no, version: a.version, title: a.title ?? '', author: a.author, assignee: a.assignee ?? '', done: a.done ?? null, createdAt: a.createdAt,
      body: a.body, replies: a.replies.map((r) => ({ author: r.author, at: r.at, body: r.body })),
      anchor: anchor ? { page: anchor.page, selector: anchor.fp.selector, text: anchor.fp.text, html: anchor.html, trail: anchor.trail } : null,
      shotBox: box ?? null, clips: (a.clips ?? []).length,
      links: linksOf(d, (e) => e.kind === 'comment' && e.screen === s.id && e.ann === a.id).map(({ other }) => endLabel(d, other)),
    });
  }
  const title = `${d.meta.title} · ${s.id} ${s.title} — Comment ${list.length}개`;
  const json = JSON.stringify({ document: d.meta.title, docVersion: d.meta.version, screen: { id: s.id, title: s.title }, exportedAt: new Date().toISOString(), exportedBy: by, comments: data }).replace(/</g, '\\u003c');
  return `<!doctype html>
<!-- 테라리움 Comment 내보내기 — 사람은 아래 카드를, AI 나 도구는 id 가 terr-comments 인 script 의 JSON 을 읽으면 된다.
     tag 는 "화면id #번호", shotBox 는 달 때 찍은 그림 안에서 대상의 자리(0~1 비율), anchor.html 은 대상 요소의 HTML 조각 -->
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(list.map((a) => `#${displayNo(s, a)} ${a.title || a.body.slice(0, 40)}`).join(' · ').slice(0, 200))}">
<style>
:root { color-scheme: light; --t: #1c1917; --m: #78716c; --b: #e7e5e4; --bg: #fafaf9; --acc: #ea580c; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--t); font: 15px/1.6 "Pretendard Variable", Pretendard, "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif; }
main { max-width: 920px; margin: 0 auto; padding: 32px 20px 64px; }
.doc { margin-bottom: 24px; }
.doc h1 { font-size: 22px; margin: 0 0 4px; }
.muted, .doc .meta { color: var(--m); }
.mono { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: .92em; }
.c { background: #fff; border: 1px solid var(--b); border-radius: 12px; padding: 18px 20px; margin: 0 0 18px; break-inside: avoid; }
.c.is-done { opacity: .7; }
.c header { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 12px; }
.no { flex: none; width: 30px; height: 30px; border-radius: 50%; background: var(--acc); color: #fff; display: grid; place-items: center; font-weight: 700; }
.title { font-size: 17px; font-weight: 700; }
.meta { font-size: 13px; color: var(--m); }
.done { color: #15803d; font-weight: 600; }
figure { margin: 0 0 12px; }
.frame { position: relative; line-height: 0; border: 1px solid var(--b); border-radius: 8px; overflow: hidden; }
.frame img { width: 100%; height: auto; display: block; }
.box { position: absolute; border: 3px solid #dc2626; border-radius: 3px; box-shadow: 0 0 0 9999px rgb(0 0 0 / .18); }
figcaption { font-size: 12px; color: var(--m); margin-top: 4px; }
.clip video { width: 100%; border-radius: 8px; background: #000; }
.body p { margin: 0 0 8px; }
.body h3, .body h4 { margin: 12px 0 6px; }
blockquote { margin: 0 0 8px; padding: 2px 12px; border-left: 3px solid var(--b); color: var(--m); }
code { background: #f5f5f4; border-radius: 4px; padding: 0 4px; }
pre { background: #f5f5f4; border-radius: 6px; padding: 10px; overflow: auto; white-space: pre-wrap; word-break: break-all; }
ul.tasks { list-style: none; padding-left: 4px; }
li.task .box { position: static; display: inline-grid; place-items: center; width: 16px; height: 16px; margin-right: 6px; border: 1.5px solid var(--m); border-radius: 4px; font-size: 11px; box-shadow: none; }
li.task.is-done { color: var(--m); text-decoration: line-through; }
.replies { list-style: none; padding: 10px 0 0; margin: 10px 0 0; border-top: 1px solid var(--b); }
.replies li { margin-bottom: 8px; }
.links .label { font-size: 12px; color: var(--m); margin-top: 8px; }
.links ul { margin: 2px 0 0; padding-left: 18px; }
details.anchor { margin-top: 10px; font-size: 13px; }
details.anchor dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 8px 0 0; }
details.anchor dt { color: var(--m); }
details.anchor dd { margin: 0; min-width: 0; }
@media print { body { background: #fff; } .c { border-color: #ccc; } }
</style>
</head>
<body>
<main>
<section class="doc">
  <h1>${esc(s.id)} ${esc(s.title)} — Comment ${list.length}개</h1>
  <div class="meta">${esc(d.meta.title)} v${esc(d.meta.version)} · 내보낸 사람 ${esc(by)} · ${esc(when(new Date().toISOString()))}</div>
</section>
${items.join('\n')}
</main>
<script type="application/json" id="terr-comments">${json}</script>
</body>
</html>
`;
}

const safe = (x: string) => x.replace(/[\\/:*?"<>|]+/g, '_').trim();

/** 고른 Comment 들을 HTML 한 장으로 내려받는다 */
export async function exportComments(s: Screen, list: Annotation[], o: ExportOptions = { clips: true }): Promise<boolean> {
  if (!list.length) return false;
  try {
    const d = doc.peek();
    const html = await commentsHtml(d, s, list, o);
    const nos = list.map((a) => displayNo(s, a));
    const name = `${safe(d.meta.title)}_${s.id}_Comment_${nos.length > 4 ? `${nos.length}개` : nos.map((n) => `${n}`).join('-')}.html`;
    downloadFile(html, name, 'text/html');
    notify(`Comment ${list.length}개를 내보냈습니다 — ${name} (브라우저로 바로 열립니다)`);
    return true;
  } catch (e) {
    notify(`내보내지 못했습니다: ${(e as Error).message}`, 'error');
    return false;
  }
}
