/* 가상 파일 시스템 — 경로 해석 규칙 (docs/ARCHITECTURE.md §5)
 *
 * 패키지 파일은 가상 출처 https://pkg.manna/ 아래에 있는 것으로 본다.
 * 외부 리소스는 원래 URL 그대로가 키다. 따라서 모든 참조는 `new URL(ref, base)` 한 번으로 풀린다.
 *   index.html 안의 'data/ad7.js'      → https://pkg.manna/data/ad7.js
 *   외부 CSS 안의 '../woff2/x.woff2'   → https://cdn.jsdelivr.net/.../woff2/x.woff2
 */
import type { ScreenVersion } from './types';

export const PKG = 'https://pkg.manna/';

export function pkgUrl(path: string): string {
  return new URL(path.replace(/^\/+/, ''), PKG).href;
}

export function isPkgUrl(url: string): boolean {
  return url.startsWith(PKG);
}

/** 가상 URL → 패키지 내 상대 경로 (진단 표시용) */
export function pkgPath(url: string): string {
  return isPkgUrl(url) ? decodeURIComponent(url.slice(PKG.length)) : url;
}

const PASS = /^(blob:|data:|javascript:|about:|mailto:|tel:|#)/i;

export function absolutize(ref: string, base: string): string | null {
  const r = ref.trim();
  if (!r || PASS.test(r)) return null;
  try {
    return new URL(r, base).href;
  } catch {
    return null;
  }
}

/** 버전 하나의 가상 URL → sha 표 */
export function buildIndex(version: ScreenVersion): Map<string, string> {
  const index = new Map<string, string>();
  for (const [path, f] of Object.entries(version.files)) index.set(pkgUrl(path), f.sha);
  for (const e of version.external) if (e.sha && !e.excluded) index.set(e.url, e.sha);
  return index;
}

/** 쿼리·해시를 떼어 가며 찾는다 ('x.js?v=2' → 'x.js') */
export function lookup<T>(map: Map<string, T> | Record<string, T>, abs: string): T | undefined {
  const get = (k: string) => (map instanceof Map ? map.get(k) : map[k]);
  const noHash = abs.split('#')[0];
  return get(abs) ?? get(noHash) ?? get(noHash.split('?')[0]);
}

const CSS_URL = /url\(\s*(['"]?)([^'")]+?)\1\s*\)/g;
const CSS_IMPORT = /@import\s+(['"])([^'"]+)\1/g;

/** CSS 텍스트 안의 url()·@import 를 base 기준으로 풀어 map 이 주는 값으로 바꾼다 */
export function rewriteCss(css: string, base: string, map: (abs: string) => string | undefined): string {
  const sub = (ref: string) => {
    const abs = absolutize(ref, base);
    return (abs && map(abs)) ?? ref;
  };
  return css
    .replace(CSS_URL, (m, q, ref) => {
      const to = sub(ref);
      return to === ref ? m : `url(${q}${to}${q})`;
    })
    .replace(CSS_IMPORT, (m, q, ref) => {
      const to = sub(ref);
      return to === ref ? m : `@import ${q}${to}${q}`;
    });
}

/** CSS 안의 참조를 절대 URL 목록으로 (패키징 시 외부 폰트 따라가기용) */
export function cssRefs(css: string, base: string): string[] {
  const out: string[] = [];
  for (const re of [CSS_URL, CSS_IMPORT]) {
    for (const m of css.matchAll(re)) {
      const abs = absolutize(m[2], base);
      if (abs) out.push(abs);
    }
  }
  return out;
}

export function rewriteSrcset(srcset: string, base: string, map: (abs: string) => string | undefined): string {
  return srcset
    .split(',')
    .map((part) => {
      const [ref, ...rest] = part.trim().split(/\s+/);
      const abs = ref ? absolutize(ref, base) : null;
      const to = (abs && map(abs)) ?? ref;
      return [to, ...rest].join(' ');
    })
    .join(', ');
}
