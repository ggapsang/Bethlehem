/* URL 화면 — 편집기 안의 webview 로 실제 사이트를 띄운다 (docs/ARCHITECTURE.md §5.5)
 *
 * 편집기에서는 실시간 사이트가 돌고, 보낸 파일에는 사본이 들어간다. 사본은 이렇게 만든다.
 *   - 지금 DOM 을 직렬화한다. 스크립트·on* 속성은 뺀다.
 *   - shadow DOM 을 가진 요소, canvas·video·iframe 은 직렬화로 담을 수 없으므로(WebGL 도 마찬가지)
 *     화면 픽셀을 잘라 그 요소의 배경 그림으로 넣는다. 요소 자체(태그·id·class)는 남겨 Comment 지문이 그대로 맞는다.
 *   - 직렬화한 HTML 이 가리키는 CSS·글꼴·그림은 사이트 세션(쿠키 포함)으로 내려받는다.
 */
import { session, webContents, type WebContents } from 'electron';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { absolutize, cssRefs, encFor, typeFor } from '@core';
import type { EncodedBlob, ExternalEntry, ScreenVersion } from '@core';
import { toUtf8 } from '@core/node/charset';

export const SITE_PARTITION = 'persist:terrarium-sites';

const MAX_FILES = 300;
const MAX_TOTAL = 80 * 1024 * 1024;
const SHOT_HOST = 'https://terr.shot/';

function blobOf(bytes: Uint8Array, type: string): { sha: string; blob: EncodedBlob } {
  const sha = createHash('sha256').update(bytes).digest('hex');
  const enc = encFor(type);
  return { sha, blob: { enc, data: Buffer.from(enc === 'gz64' ? gzipSync(bytes, { level: 9 }) : bytes).toString('base64') } };
}

/** webview 가 붙을 때 — 새 창은 같은 화면 안에서 연다 */
export function watchSite(guest: WebContents): void {
  guest.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) guest.loadURL(url);
    return { action: 'deny' };
  });
}

/* 사이트 안에서 돌아가는 직렬화 — 지금 보이는 DOM 을 HTML 로. 픽셀로 대신할 요소의 자리를 함께 돌려준다 */
const SERIALIZE = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const marks = [];
  const special = (el) => !!el.shadowRoot || /^(CANVAS|VIDEO|IFRAME|EMBED|OBJECT)$/.test(el.tagName);
  const walk = (el) => {
    for (const c of Array.from(el.children)) {
      if (special(c)) {
        const r = c.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh) {
          c.setAttribute('data-terr-shot', String(marks.length));
          const cs = getComputedStyle(c);
          marks.push({ x: r.left, y: r.top, w: r.width, h: r.height, display: cs.display === 'inline' ? 'inline-block' : cs.display });
        }
        continue;
      }
      walk(c);
    }
  };
  if (document.body) walk(document.body);
  const inputs = Array.from(document.querySelectorAll('input, textarea, select'));
  const liveStyles = Array.from(document.querySelectorAll('style'));
  const clone = document.documentElement.cloneNode(true);
  document.querySelectorAll('[data-terr-shot]').forEach((el) => el.removeAttribute('data-terr-shot'));
  Array.from(clone.querySelectorAll('[data-terr-shot]')).forEach((el) => {
    const n = Number(el.getAttribute('data-terr-shot'));
    const m = marks[n];
    el.removeAttribute('data-terr-shot');
    el.innerHTML = '';
    el.removeAttribute('src');
    el.removeAttribute('srcdoc');
    el.setAttribute('style', (el.getAttribute('style') || '') + ';display:' + m.display + ';width:' + m.w + 'px;height:' + m.h + 'px;' +
      'background:url("${SHOT_HOST}' + n + '.jpg") 0 0/100% 100% no-repeat;');
    el.setAttribute('data-terr-pixels', '');
  });
  Array.from(clone.querySelectorAll('input, textarea, select')).forEach((el, i) => {
    const src = inputs[i];
    if (!src) return;
    if (el.tagName === 'TEXTAREA') el.textContent = src.value;
    else if (el.tagName === 'SELECT') Array.from(el.options).forEach((o, k) => o.toggleAttribute('selected', !!(src.options[k] && src.options[k].selected)));
    else if (src.type === 'checkbox' || src.type === 'radio') el.toggleAttribute('checked', src.checked);
    else el.setAttribute('value', src.value);
  });
  Array.from(clone.querySelectorAll('style')).forEach((s, i) => {
    const sheet = liveStyles[i] && liveStyles[i].sheet;
    if (!sheet) return;
    try { const rules = Array.from(sheet.cssRules).map((r) => r.cssText).join('\\n'); if (rules.length > (s.textContent || '').length) s.textContent = rules; } catch (e) {}
  });
  if (document.adoptedStyleSheets && document.adoptedStyleSheets.length) {
    const st = document.createElement('style');
    st.textContent = document.adoptedStyleSheets.map((sh) => Array.from(sh.cssRules).map((r) => r.cssText).join('\\n')).join('\\n');
    clone.querySelector('head').appendChild(st);
  }
  clone.querySelectorAll('script, noscript, link[rel=modulepreload], link[rel=preload][as=script]').forEach((s) => s.remove());
  clone.querySelectorAll('*').forEach((el) => Array.from(el.attributes).forEach((a) => { if (/^on/i.test(a.name)) el.removeAttribute(a.name); }));
  const base = document.querySelector('base[href]');
  return { html: '<!DOCTYPE html>' + clone.outerHTML, marks, vw, vh, url: location.href, base: base ? base.href : location.href, title: document.title };
})()`;

/** 직렬화한 HTML 이 가리키는 리소스 (스타일시트·그림·인라인 스타일의 url()) */
function htmlRefs(html: string, base: string): string[] {
  const out = new Set<string>();
  const attr = (tag: string, name: string) => new RegExp(`<${tag}\\b[^>]*?\\s${name}\\s*=\\s*["']([^"']+)["']`, 'gi');
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/rel\s*=\s*["']?[^"'>]*(stylesheet|icon)/i.test(m[0])) continue;
    const h = /\shref\s*=\s*["']([^"']+)["']/i.exec(m[0]);
    const abs = h && absolutize(h[1], base);
    if (abs) out.add(abs);
  }
  for (const re of [attr('img', 'src'), attr('source', 'src'), attr('video', 'poster'), attr('input', 'src')]) {
    for (const m of html.matchAll(re)) {
      const abs = absolutize(m[1], base);
      if (abs) out.add(abs);
    }
  }
  for (const m of html.matchAll(/\ssrcset\s*=\s*["']([^"']+)["']/gi)) {
    for (const part of m[1].split(',')) {
      const abs = absolutize(part.trim().split(/\s+/)[0] ?? '', base);
      if (abs) out.add(abs);
    }
  }
  for (const u of cssRefs(html, base)) out.add(u);
  return [...out].filter((u) => /^https?:/.test(u) && !u.startsWith(SHOT_HOST));
}

export interface SiteSnapshot {
  title: string;
  url: string;
  version: Pick<ScreenVersion, 'entry' | 'external'>;
  blobs: [string, EncodedBlob][];
}

export async function snapshotSite(guestId: number): Promise<SiteSnapshot> {
  const guest = webContents.fromId(guestId);
  if (!guest || guest.isDestroyed()) throw new Error('사이트 화면이 닫혀 있습니다.');
  const r = (await guest.executeJavaScript(SERIALIZE, true)) as {
    html: string; marks: { x: number; y: number; w: number; h: number }[]; vw: number; vh: number; url: string; base: string; title: string;
  };
  const img = await guest.capturePage();
  const size = img.getSize();
  const k = size.width / r.vw;
  const blobs = new Map<string, EncodedBlob>();
  const external: ExternalEntry[] = [];
  const add = (url: string, bytes: Uint8Array, type: string) => {
    const { sha, blob } = blobOf(bytes, type);
    blobs.set(sha, blob);
    external.push({ url, sha, type, size: bytes.length });
  };
  add(r.url, new TextEncoder().encode(r.html), 'text/html');
  r.marks.forEach((m, n) => {
    const x = Math.max(0, Math.round(m.x * k));
    const y = Math.max(0, Math.round(m.y * k));
    const w = Math.min(size.width - x, Math.round(m.w * k));
    const h = Math.min(size.height - y, Math.round(m.h * k));
    if (w > 0 && h > 0) add(`${SHOT_HOST}${n}.jpg`, new Uint8Array(img.crop({ x, y, width: w, height: h }).toJPEG(85)), 'image/jpeg');
  });

  // 가리키는 리소스 — CSS 는 그 안의 url() 까지 따라간다
  const ses = session.fromPartition(SITE_PARTITION);
  const queue = htmlRefs(r.html, r.base);
  const seen = new Set<string>();
  let total = 0;
  while (queue.length && seen.size < MAX_FILES && total < MAX_TOTAL) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const res = await ses.fetch(url);
      if (!res.ok) continue;
      const head = res.headers.get('content-type') ?? '';
      const type = head.split(';')[0].trim() || typeFor(url);
      const charset = /charset=([\w-]+)/i.exec(head)?.[1];
      const bytes = toUtf8(new Uint8Array(await res.arrayBuffer()), type, charset);
      total += bytes.length;
      add(url, bytes, type);
      if (type === 'text/css') for (const c of cssRefs(new TextDecoder().decode(bytes), url)) if (/^https?:/.test(c)) queue.push(c);
    } catch {
      /* 못 받은 리소스는 링크로 남는다 */
    }
  }
  return { title: r.title, url: r.url, version: { entry: r.url, external }, blobs: [...blobs] };
}
