/* URL 화면의 DOM 사본 → 파일 하나로 열리는 HTML
 *
 * 사본(version.external)은 스크립트를 뺀 DOM 직렬화 + 그 페이지가 가리키던 CSS · 글꼴 · 그림 + 직렬화로 못 담는
 * 요소(canvas · WebGL · shadow DOM · iframe)를 대신하는 픽셀 그림(https://terr.shot/N.jpg)이다.
 * 여기서 그 참조들을 모두 data: URL 로 넣고, 스타일시트는 <style> 로 바꿔 어디서 열어도 같은 모습이 되게 한다.
 * 사본에 없는 리소스는 원래 주소(절대 URL)로 남는다 — 인터넷이 되면 거기서 받아 온다.
 */
import type { EncodedBlob, ScreenVersion } from '@core';
import { absolutize, decodeBlob, lookup, rewriteCss } from '@core';

const utf8 = new TextDecoder();

function dataUrl(bytes: Uint8Array, type: string): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type || 'application/octet-stream'};base64,${btoa(bin)}`;
}

export async function siteCopyHtml(v: ScreenVersion, blobs: Map<string, EncodedBlob>, title: string): Promise<string> {
  const entries = new Map<string, { bytes: Uint8Array; type: string }>();
  for (const e of v.external) {
    const b = e.sha && !e.excluded ? blobs.get(e.sha) : undefined;
    if (b) entries.set(e.url, { bytes: await decodeBlob(b), type: e.type ?? '' });
  }
  const page = lookup(entries, v.entry);
  if (!page) throw new Error('이 URL 화면에는 아직 담아 둔 사본이 없습니다 — 화면이 다 뜬 뒤 다시 해 보세요.');

  const made = new Map<string, string>();
  /** 절대 URL → data: URL (사본에 있으면). CSS 는 그 안의 url() · @import 까지 */
  const inline = (abs: string): string | undefined => {
    const key = [abs, abs.split('#')[0], abs.split('#')[0].split('?')[0]].find((k) => entries.has(k));
    if (!key) return undefined;
    const hit = made.get(key);
    if (hit) return hit;
    const { bytes, type } = entries.get(key)!;
    if (type === 'text/css') {
      made.set(key, abs); // 순환 @import 방지
      const css = rewriteCss(utf8.decode(bytes), key, (u) => inline(u) ?? u);
      const u = dataUrl(new TextEncoder().encode(css), 'text/css');
      made.set(key, u);
      return u;
    }
    const u = dataUrl(bytes, type);
    made.set(key, u);
    return u;
  };

  const dom = new DOMParser().parseFromString(utf8.decode(page.bytes), 'text/html');
  const baseEl = dom.querySelector('base[href]');
  const base = (baseEl && absolutize(baseEl.getAttribute('href')!, v.entry)) || v.entry;
  baseEl?.remove();
  const to = (ref: string): string => {
    const abs = absolutize(ref, base);
    return abs ? (inline(abs) ?? abs) : ref;
  };
  const css = (text: string) => rewriteCss(text, base, (u) => inline(u) ?? u);

  // 스타일시트 → <style> (CSS 안의 글꼴 · 그림도 함께)
  for (const l of Array.from(dom.querySelectorAll('link[rel~="stylesheet" i][href]'))) {
    const abs = absolutize(l.getAttribute('href')!, base);
    const key = abs && [abs, abs.split('?')[0]].find((k) => entries.has(k));
    if (!abs || !key) {
      if (abs) l.setAttribute('href', abs);
      continue;
    }
    const st = dom.createElement('style');
    const media = l.getAttribute('media');
    if (media) st.setAttribute('media', media);
    st.textContent = rewriteCss(utf8.decode(entries.get(key)!.bytes), key, (u) => inline(u) ?? u);
    l.replaceWith(st);
  }
  dom.querySelectorAll('link[rel~="preload" i], link[rel~="prefetch" i], link[rel~="modulepreload" i]').forEach((l) => l.remove());
  for (const l of Array.from(dom.querySelectorAll('link[href]'))) l.setAttribute('href', to(l.getAttribute('href')!));
  for (const s of Array.from(dom.querySelectorAll('style'))) s.textContent = css(s.textContent ?? '');
  for (const el of Array.from(dom.querySelectorAll('[style]'))) el.setAttribute('style', css(el.getAttribute('style')!));
  for (const [sel, attr] of [['img[src]', 'src'], ['source[src]', 'src'], ['video[poster]', 'poster'], ['input[src]', 'src'], ['image[href]', 'href'], ['audio[src]', 'src'], ['video[src]', 'src']] as const) {
    for (const el of Array.from(dom.querySelectorAll(sel))) el.setAttribute(attr, to(el.getAttribute(attr)!));
  }
  for (const el of Array.from(dom.querySelectorAll('[srcset]'))) {
    el.setAttribute('srcset', el.getAttribute('srcset')!.split(',').map((part) => {
      const [u, ...rest] = part.trim().split(/\s+/);
      return [to(u ?? ''), ...rest].join(' ');
    }).join(', '));
  }
  // 링크 · 폼은 원래 사이트로
  for (const [sel, attr] of [['a[href]', 'href'], ['area[href]', 'href'], ['form[action]', 'action'], ['use[href]', 'href']] as const) {
    for (const el of Array.from(dom.querySelectorAll(sel))) {
      const ref = el.getAttribute(attr)!;
      if (ref.startsWith('#')) continue;
      const abs = absolutize(ref, base);
      if (abs) el.setAttribute(attr, abs);
    }
  }
  if (!dom.querySelector('meta[charset]')) {
    const m = dom.createElement('meta');
    m.setAttribute('charset', 'utf-8');
    dom.head.prepend(m);
  }
  if (!dom.title && title) dom.title = title;
  const note = `<!-- 테라리움 URL 화면의 DOM 사본 — 원래 주소: ${v.entry.replace(/--/g, '%2D%2D')}
     스크립트는 빠져 있다(그 순간의 모습만). canvas · WebGL · shadow DOM · iframe 은 그 자리의 화면 그림으로 들어 있다(data-terr-pixels). -->`;
  return `<!DOCTYPE html>\n${note}\n${dom.documentElement.outerHTML}`;
}
