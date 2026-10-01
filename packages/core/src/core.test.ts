import { describe, expect, it } from 'vitest';
import { decodeBlob, encFor, encodeBlob, sha256, typeFor } from './codec';
import { displayNo, newDoc, nextAnnotationNo, nextScreenId, setField } from './doc';
import { isManna, parseManna, referencedShas, scriptSafeJs, serializeManna } from './manna-file';
import type { Annotation, BlobStore, Screen } from './types';
import { absolutize, buildIndex, cssRefs, lookup, pkgPath, pkgUrl, rewriteCss, rewriteSrcset } from './vfs';

const enc = new TextEncoder();
const dec = new TextDecoder();

describe('vfs', () => {
  it('패키지 경로와 외부 URL 을 같은 규칙으로 푼다', () => {
    const base = pkgUrl('index.html');
    expect(absolutize('data/ad7.js', base)).toBe('https://pkg.manna/data/ad7.js');
    expect(absolutize('./data/ad7.js?v=2', base)).toBe('https://pkg.manna/data/ad7.js?v=2');
    expect(absolutize('/img/a.png', pkgUrl('pages/sub.html'))).toBe('https://pkg.manna/img/a.png');
    expect(absolutize('../woff2/x.woff2', 'https://cdn.example.com/a/css/x.css')).toBe('https://cdn.example.com/a/woff2/x.woff2');
    expect(absolutize('data:image/png;base64,AAA', base)).toBeNull();
    expect(absolutize('#top', base)).toBeNull();
  });

  it('공백·한글 파일 이름도 같은 키가 된다', () => {
    const key = pkgUrl('index - old.html');
    expect(absolutize('index - old.html', pkgUrl('index.html'))).toBe(key);
    expect(pkgPath(pkgUrl('자료/설비 목록.json'))).toBe('자료/설비 목록.json');
  });

  it('쿼리·해시를 떼어 가며 찾는다', () => {
    const m = new Map([['https://pkg.manna/a.js', 'A']]);
    expect(lookup(m, 'https://pkg.manna/a.js?v=3#x')).toBe('A');
    expect(lookup(m, 'https://pkg.manna/b.js')).toBeUndefined();
  });

  it('CSS 의 url() · @import 를 그 CSS 위치 기준으로 바꾼다', () => {
    const css = `@import "theme.css"; .a{background:url('../img/a.png')} .b{background:url(data:x)} @font-face{src:url(fonts/f.woff2)}`;
    const base = pkgUrl('css/main.css');
    const map = (abs: string) => ({ 'https://pkg.manna/css/theme.css': 'blob:1', 'https://pkg.manna/img/a.png': 'blob:2', 'https://pkg.manna/css/fonts/f.woff2': 'blob:3' })[abs];
    const out = rewriteCss(css, base, map);
    expect(out).toContain('@import "blob:1"');
    expect(out).toContain("url('blob:2')");
    expect(out).toContain('url(fonts/f.woff2)'.replace('fonts/f.woff2', 'blob:3'));
    expect(out).toContain('url(data:x)');
    expect(cssRefs(css, base)).toEqual(['https://pkg.manna/img/a.png', 'https://pkg.manna/css/fonts/f.woff2', 'https://pkg.manna/css/theme.css']);
  });

  it('srcset 을 바꾼다', () => {
    const out = rewriteSrcset('a.png 1x, b.png 2x', pkgUrl('index.html'), (abs) => (abs.endsWith('b.png') ? 'blob:b' : undefined));
    expect(out).toBe('a.png 1x, blob:b 2x');
  });

  it('제외한 외부 리소스는 색인에 넣지 않는다', () => {
    const idx = buildIndex({
      v: 1, createdAt: '', entry: 'index.html', viewport: { w: 1, h: 1, fit: 'contain' },
      files: { 'index.html': { sha: 'h', size: 1, type: 'text/html' } },
      external: [{ url: 'https://x/a.css', sha: 'a' }, { url: 'https://x/b.css', sha: 'b', excluded: true }],
    });
    expect([...idx.keys()]).toEqual(['https://pkg.manna/index.html', 'https://x/a.css']);
  });
});

describe('codec', () => {
  it('gzip+base64 와 base64 가 원래 바이트로 돌아온다', async () => {
    const text = enc.encode('Time,Tag\n'.repeat(2000) + '한글 ✓');
    const gz = await encodeBlob(text, 'gz64');
    expect(gz.data.length).toBeLessThan(text.length / 10);
    expect(dec.decode(await decodeBlob(gz))).toBe(dec.decode(text));
    const bin = new Uint8Array(70000).map((_, i) => i % 251);
    expect(await decodeBlob(await encodeBlob(bin, 'b64'))).toEqual(bin);
  });

  it('형식별 인코딩', () => {
    expect(encFor(typeFor('a.woff2'))).toBe('b64');
    expect(encFor(typeFor('a.png'))).toBe('b64');
    expect(encFor(typeFor('data/ad7.js'))).toBe('gz64');
    expect(typeFor('x.JSON?v=1')).toBe('application/json');
  });

  it('sha256', async () => {
    expect(await sha256(enc.encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

function annotation(no: number | null, extra: Partial<Annotation> = {}): Annotation {
  return {
    id: crypto.randomUUID(), no, version: 1, kind: '설명', status: '열림', body: 'b', author: 'a',
    createdAt: new Date().toISOString(), updatedAt: '', replies: [], history: [],
    anchor: { fp: { selector: 'div', tag: 'div', classes: [], attrs: {}, ancestry: [] }, trail: [] },
    ...extra,
  };
}

describe('manna-file', () => {
  it('직렬화한 문서를 다시 읽으면 같다', async () => {
    const doc = newDoc('테스트 </script> 문서');
    const blobs: BlobStore = new Map();
    const html = enc.encode('<!doctype html><script>alert("</script>")</script>');
    const sha = await sha256(html);
    blobs.set(sha, await encodeBlob(html, 'gz64'));
    blobs.set('f'.repeat(64), { enc: 'b64', data: 'AAAA' }); // 쓰이지 않는 블롭은 저장하지 않는다
    const screen: Screen = {
      id: 'SCR-001', title: '화면', annotations: [annotation(1, { body: '줄 바꿈 </script><b>' })],
      versions: [{ v: 1, createdAt: '', entry: 'index.html', viewport: { w: 1920, h: 1080, fit: 'contain' }, files: { 'index.html': { sha, size: html.length, type: 'text/html' } }, external: [] }],
    };
    doc.screens.push(screen);
    const out = serializeManna(doc, blobs, { js: 'console.log("</script>")', css: 'a{}' });

    expect(out.match(/<\/script>/g)!.length).toBe(1 + 1 + 1); // doc · blob 하나 · 런타임 — 나머지는 이스케이프
    expect(out).not.toContain('f'.repeat(64));
    expect(isManna(out)).toBe(true);
    const back = parseManna(out);
    expect(back.doc).toEqual(doc);
    expect(back.blobs.size).toBe(1);
    expect(dec.decode(await decodeBlob(back.blobs.get(sha)!))).toBe(dec.decode(html));
    expect([...referencedShas(doc)]).toEqual([sha]);
  });

  it('없는 블롭을 참조하면 저장을 멈춘다', () => {
    const doc = newDoc();
    doc.screens.push({ id: 'S', title: 's', annotations: [], versions: [{ v: 1, createdAt: '', entry: 'i.html', viewport: { w: 1, h: 1, fit: 'contain' }, files: { 'i.html': { sha: 'nope', size: 1, type: 'text/html' } }, external: [] }] });
    expect(() => serializeManna(doc, new Map(), { js: '', css: '' })).toThrow(/블롭이 없습니다/);
  });

  it('런타임 안의 닫는 태그를 이스케이프한다', () => {
    expect(scriptSafeJs('a="</script>";b="</SCRIPT>"')).toBe('a="<\\/script>";b="<\\/SCRIPT>"');
  });

  it('Manna 가 아닌 HTML', () => {
    expect(isManna('<html></html>')).toBe(false);
    expect(() => parseManna('<html></html>')).toThrow(/Manna 문서가 아닙니다/);
  });
});

describe('doc', () => {
  it('화면 ID 와 어노테이션 번호', () => {
    const d = newDoc();
    expect(nextScreenId(d)).toBe('SCR-001');
    d.screens.push({ id: 'SCR-007', title: '', versions: [], annotations: [] });
    expect(nextScreenId(d)).toBe('SCR-008');
    const s = d.screens[0];
    s.annotations.push(annotation(3), annotation(null), annotation(null));
    expect(nextAnnotationNo(s)).toBe(4);
    expect(displayNo(s, s.annotations[0])).toBe('3');
    expect(displayNo(s, s.annotations[2])).toBe('새 2');
  });

  it('필드 변경을 기록한다', () => {
    const a = annotation(1);
    setField(a, 'status', '완료', '홍길동');
    setField(a, 'status', '완료', '홍길동'); // 같은 값은 기록하지 않는다
    expect(a.status).toBe('완료');
    expect(a.history).toHaveLength(1);
    expect(a.history[0]).toMatchObject({ by: '홍길동', field: 'status', from: '열림', to: '완료' });
  });
});
