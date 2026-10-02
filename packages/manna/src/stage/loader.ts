/* 화면 버전 하나를 iframe srcdoc 으로 — docs/ARCHITECTURE.md §5.1 */
import type { BlobStore, ScreenVersion } from '@core';
import { absolutize, buildIndex, decodeBlob, entryUrlOf, lookup, pkgUrl, rewriteCss, rewriteSrcset } from '@core';
import shimSource from './shim.js?raw';
// 에이전트는 먼저 단독으로 빌드된다 (npm run build:agent) — 화면 안에 문자열로 넣는다
import agentSource from '../../../../out/agent/agent.js?raw';

export interface Prepared {
  srcdoc: string;
  warnings: string[];
  dispose(): void;
}

/* 디코딩 결과는 버전을 바꿔도 재사용한다 (같은 sha = 같은 내용) */
const decoded = new Map<string, Uint8Array>();

async function bytesOf(sha: string, blobs: BlobStore): Promise<Uint8Array> {
  let b = decoded.get(sha);
  if (!b) {
    const enc = blobs.get(sha);
    if (!enc) throw new Error(`문서에 파일 내용이 없습니다 (sha ${sha.slice(0, 12)}…)`);
    b = await decodeBlob(enc);
    decoded.set(sha, b);
  }
  return b;
}

const utf8 = new TextDecoder();

const URL_ATTRS: [string, string][] = [
  ['script[src]', 'src'],
  ['link[href]', 'href'],
  ['img[src]', 'src'],
  ['source[src]', 'src'],
  ['video[src]', 'src'],
  ['video[poster]', 'poster'],
  ['audio[src]', 'src'],
  ['track[src]', 'src'],
  ['embed[src]', 'src'],
  ['iframe[src]', 'src'],
  ['object[data]', 'data'],
  ['input[type=image][src]', 'src'],
  ['image[href]', 'href'],
  ['use[href]', 'href'],
];

export async function prepareScreen(version: ScreenVersion, blobs: BlobStore): Promise<Prepared> {
  const index = buildIndex(version);
  const types = new Map<string, string>();
  for (const [p, f] of Object.entries(version.files)) types.set(pkgUrl(p), f.type);
  for (const e of version.external) if (e.sha) types.set(e.url, e.type ?? '');

  // 모든 파일을 먼저 풀어 둔다 — shim 의 경로 치환은 동기여야 한다
  const bytes = new Map<string, Uint8Array>();
  await Promise.all([...index].map(async ([url, sha]) => bytes.set(url, await bytesOf(sha, blobs))));

  const urls = new Map<string, string>();
  const made: string[] = [];
  const entryUrl = entryUrlOf(version);

  const urlFor = (abs: string): string | undefined => {
    const key = [abs, abs.split('#')[0], abs.split('#')[0].split('?')[0]].find((k) => bytes.has(k));
    if (!key) return undefined;
    const hit = urls.get(key);
    if (hit) return hit;
    const type = types.get(key) || 'application/octet-stream';
    let body: BlobPart = bytes.get(key)! as BlobPart;
    if (type === 'text/css') {
      urls.set(key, 'about:blank'); // 순환 @import 방지
      body = rewriteCss(utf8.decode(bytes.get(key)!), key, urlFor);
    }
    const u = URL.createObjectURL(new Blob([body], { type }));
    made.push(u);
    urls.set(key, u);
    return u;
  };
  for (const url of bytes.keys()) if (url !== entryUrl) urlFor(url);

  const entry = bytes.get(entryUrl);
  if (!entry) throw new Error(`엔트리 파일 '${version.entry}' 이 문서에 없습니다.`);
  const dom = new DOMParser().parseFromString(utf8.decode(entry), 'text/html');
  const warnings: string[] = [];
  // <base href> 가 있으면 문서 안 상대 경로의 기준이 바뀐다. 해석에 반영하고, 태그는 지운다(srcdoc 에서는 엉뚱한 곳을 가리킨다)
  const baseEl = dom.querySelector('base[href]');
  const docBase = (baseEl && absolutize(baseEl.getAttribute('href')!, entryUrl)) || entryUrl;
  baseEl?.remove();

  for (const [sel, attr] of URL_ATTRS) {
    for (const el of Array.from(dom.querySelectorAll(sel))) {
      const ref = el.getAttribute(attr)!;
      const abs = absolutize(ref, docBase);
      const to = abs && lookup(urls, abs);
      if (to) el.setAttribute(attr, to);
    }
  }
  for (const el of Array.from(dom.querySelectorAll('img[srcset],source[srcset]'))) {
    el.setAttribute('srcset', rewriteSrcset(el.getAttribute('srcset')!, docBase, (a) => lookup(urls, a)));
  }
  for (const el of Array.from(dom.querySelectorAll('style'))) {
    el.textContent = rewriteCss(el.textContent ?? '', docBase, (a) => lookup(urls, a));
  }
  for (const el of Array.from(dom.querySelectorAll('[style*="url("]'))) {
    el.setAttribute('style', rewriteCss(el.getAttribute('style')!, docBase, (a) => lookup(urls, a)));
  }
  if (dom.querySelector('script[type=module]')) {
    warnings.push('모듈 스크립트(type="module")가 있습니다. 파일로 연 문서에서는 브라우저가 막으므로 번들된 결과물을 넣어야 합니다.');
  }

  const map: Record<string, string> = {};
  for (const [k, v] of urls) map[k] = v;
  const shim = dom.createElement('script');
  shim.textContent = `(${shimSource.trim().replace(/;?\s*$/, '')})(${JSON.stringify(map)}, ${JSON.stringify(docBase)});`;
  const agent = dom.createElement('script');
  agent.textContent = agentSource;
  dom.head.prepend(shim, agent);

  const doctype = dom.doctype ? `<!DOCTYPE ${dom.doctype.name}>` : '';
  return {
    srcdoc: doctype + dom.documentElement.outerHTML,
    warnings,
    dispose: () => made.forEach((u) => URL.revokeObjectURL(u)),
  };
}
