/* 화면 설명 — 화면 패키지의 README.md 를 화면정의서 본문으로 보여 준다 */
import { useEffect, useState } from 'preact/hooks';
import { Marked } from 'marked';
import { decodeBlob } from '@core';
import { blobs } from '../store';

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/* 원문 HTML 은 실행하지 않고 글자로 보인다 */
const md = new Marked({
  gfm: true,
  renderer: {
    html: ({ text }) => escape(text),
    link: ({ href, text }) => (/^(https?:|mailto:)/i.test(href) ? `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${text}</a>` : `<span class="link">${text}</span>`),
    image: ({ text }) => `<span class="muted">[이미지: ${escape(text)}]</span>`,
  },
});

const cache = new Map<string, string>();

export function Description({ sha }: { sha: string }) {
  const [html, setHtml] = useState<string | null>(cache.get(sha) ?? null);
  useEffect(() => {
    if (cache.has(sha)) return setHtml(cache.get(sha)!);
    const b = blobs.get(sha);
    if (!b) return setHtml('<p>설명 문서를 찾지 못했습니다.</p>');
    decodeBlob(b).then((bytes) => {
      const out = md.parse(new TextDecoder().decode(bytes)) as string;
      cache.set(sha, out);
      setHtml(out);
    });
  }, [sha]);
  return <div class="panel-body markdown" dangerouslySetInnerHTML={{ __html: html ?? '<p class="muted">불러오는 중…</p>' }} />;
}
