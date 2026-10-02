import { describe, expect, it } from 'vitest';
import { decodeBlob, encFor, encodeBlob, sha256, typeFor } from './codec';
import { displayNo, moveAnnotation, newDoc, nextScreenId, setField } from './doc';
import { isManna, parseManna, referencedShas, scriptSafeJs, serializeManna } from './manna-file';
import type { Annotation, BlobStore, MannaDoc, Screen, ScreenVersion } from './types';
import { absolutize, buildIndex, cssRefs, entryUrlOf, lookup, pkgPath, pkgUrl, rewriteCss, rewriteSrcset } from './vfs';

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

function annotation(extra: Partial<Annotation> = {}): Annotation {
  return {
    id: crypto.randomUUID(), version: 1, body: 'b', author: 'a',
    createdAt: new Date().toISOString(), updatedAt: '', replies: [], history: [],
    anchor: { fp: { selector: 'div', tag: 'div', classes: [], attrs: {}, ancestry: [] }, trail: [] },
    ...extra,
  };
}

const V1 = (sha: string, size = 1): ScreenVersion => ({ v: 1, createdAt: '', entry: 'index.html', viewport: { w: 1920, h: 1080, fit: 'contain' }, files: { 'index.html': { sha, size, type: 'text/html' } }, external: [] });

describe('manna-file', () => {
  it('직렬화한 문서를 다시 읽으면 같다', async () => {
    const doc = newDoc('테스트 </script> 문서');
    const blobs: BlobStore = new Map();
    const html = enc.encode('<!doctype html><script>alert("</script>")</script>');
    const sha = await sha256(html);
    const clip = enc.encode('webm');
    const clipSha = await sha256(clip);
    blobs.set(sha, await encodeBlob(html, 'gz64'));
    blobs.set(clipSha, await encodeBlob(clip, 'b64'));
    blobs.set('f'.repeat(64), { enc: 'b64', data: 'AAAA' }); // 쓰이지 않는 블롭은 저장하지 않는다
    const lineSep = String.fromCharCode(0x2028);
    const screen: Screen = {
      id: 'SCR-001', title: '화면', notes: '# 개요\n- [ ] 할 일 </script>',
      annotations: [annotation({ body: `**줄**${lineSep}바꿈 </script><b>`, clips: [{ id: 'c', sha: clipSha, type: 'video/webm', ms: 1000, w: 10, h: 10, author: 'a', at: '' }] })],
      versions: [V1(sha, html.length)],
    };
    doc.screens.push(screen);
    const out = serializeManna(doc, blobs, { js: 'console.log("</script>")', css: 'a{}' });

    expect(out.match(/<\/script>/g)!.length).toBe(1 + 2 + 1); // doc · 블롭 둘 · 런타임 — 나머지는 이스케이프
    expect(out).not.toContain('f'.repeat(64));
    expect(out).not.toContain(lineSep);
    expect(isManna(out)).toBe(true);
    const back = parseManna(out);
    expect(back.doc).toEqual(doc);
    expect(back.blobs.size).toBe(2);
    expect(dec.decode(await decodeBlob(back.blobs.get(sha)!))).toBe(dec.decode(html));
    expect(new Set(referencedShas(doc))).toEqual(new Set([sha, clipSha]));
  });

  it('없는 블롭을 참조하면 저장을 멈춘다', () => {
    const doc = newDoc();
    doc.screens.push({ id: 'S', title: 's', notes: '', annotations: [], versions: [V1('nope')] });
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
  it('화면 ID', () => {
    const d = newDoc();
    expect(nextScreenId(d)).toBe('SCR-001');
    d.screens.push({ id: 'SCR-007', title: '', notes: '', versions: [], annotations: [] });
    expect(nextScreenId(d)).toBe('SCR-008');
  });

  it('번호는 버전 안의 순서이고, 끌어서 옮기면 바뀐다', () => {
    const s: Screen = { id: 'S', title: '', notes: '', versions: [], annotations: [] };
    const [a, b, c] = [annotation({ body: 'a' }), annotation({ body: 'b' }), annotation({ body: 'c' })];
    const old = annotation({ body: 'old', version: 0 });
    s.annotations.push(a, old, b, c);
    expect([a, b, c].map((x) => displayNo(s, x))).toEqual([1, 2, 3]);
    expect(displayNo(s, old)).toBe(1); // 다른 버전은 따로 센다
    moveAnnotation(s, c.id, 0);
    expect(s.annotations.filter((x) => x.version === 1).map((x) => x.body)).toEqual(['c', 'a', 'b']);
    expect(s.annotations[1]).toBe(old); // 다른 버전 항목의 자리는 그대로
    moveAnnotation(s, c.id, 99);
    expect(s.annotations.filter((x) => x.version === 1).map((x) => x.body)).toEqual(['a', 'b', 'c']);
  });

  it('필드 변경을 기록한다', () => {
    const a = annotation();
    setField(a, 'body', '- [x] 완료', '홍길동');
    setField(a, 'body', '- [x] 완료', '홍길동'); // 같은 값은 기록하지 않는다
    expect(a.body).toBe('- [x] 완료');
    expect(a.history).toHaveLength(1);
    expect(a.history[0]).toMatchObject({ by: '홍길동', field: 'body', from: 'b', to: '- [x] 완료' });
  });

  it('URL 스냅샷 엔트리는 원래 주소 그대로', () => {
    expect(entryUrlOf({ entry: 'index.html' })).toBe('https://pkg.manna/index.html');
    expect(entryUrlOf({ entry: 'https://example.com/app?x=1' })).toBe('https://example.com/app?x=1');
  });
});

describe('merge', () => {
  const mk = () => {
    const d = newDoc();
    d.meta.updatedAt = '2026-10-01T00:00:00.000Z';
    const a = annotation({ body: '원본', updatedAt: '2026-10-01T00:00:00.000Z' });
    d.screens.push({ id: 'S', title: '', notes: '개요', versions: [V1('x')], annotations: [a] });
    return d;
  };

  it('회신본의 새 Comment·답글을 덧붙이고, 원본이 그대로면 본문을 바꾼다', async () => {
    const { mergeDoc } = await import('./merge');
    const base = mk();
    const inc: MannaDoc = JSON.parse(JSON.stringify(base));
    inc.origin = { by: '수신자', at: '2026-10-02T00:00:00.000Z', baseUpdatedAt: base.meta.updatedAt };
    const ia = inc.screens[0].annotations[0];
    ia.body = '수신자가 고침';
    ia.updatedAt = '2026-10-02T00:00:00.000Z';
    ia.replies.push({ id: 'r1', author: '수신자', at: '2026-10-02T00:00:00.000Z', body: '확인' });
    inc.screens[0].annotations.push(annotation({ id: 'n1', body: '새 Comment', author: '수신자' }));
    inc.screens[0].notes = '수신자 개요';
    const r = mergeDoc(base, inc, new Map(), new Map());
    expect(r).toMatchObject({ added: 1, updated: 1, replies: 1, notes: 1, conflicts: [] });
    expect(base.screens[0].annotations.map((a) => a.body)).toEqual(['수신자가 고침', '새 Comment']);
    expect(base.screens[0].notes).toBe('수신자 개요');
  });

  it('양쪽이 고쳤으면 원본을 두고 회신본 본문을 답글로 남긴다', async () => {
    const { mergeDoc } = await import('./merge');
    const base = mk();
    const inc: MannaDoc = JSON.parse(JSON.stringify(base));
    inc.origin = { by: '수신자', at: '2026-10-02T00:00:00.000Z', baseUpdatedAt: base.meta.updatedAt };
    inc.screens[0].annotations[0].body = '수신자 본문';
    inc.screens[0].annotations[0].updatedAt = new Date(Date.parse(base.meta.updatedAt) + 1000).toISOString();
    base.screens[0].annotations[0].body = '작성자가 다시 고침';
    base.screens[0].annotations[0].updatedAt = '2026-10-03T00:00:00.000Z';
    base.meta.updatedAt = '2026-10-03T00:00:00.000Z';
    const r = mergeDoc(base, inc, new Map(), new Map());
    expect(r.conflicts).toHaveLength(1);
    expect(base.screens[0].annotations[0].body).toBe('작성자가 다시 고침');
    expect(base.screens[0].annotations[0].replies.at(-1)!.body).toContain('수신자 본문');
  });

  it('예전 판의 초안은 고치지 않은 Comment 로 새 판을 덮지 않는다 — 새 Comment · 답글만 더한다', async () => {
    const { mergeDoc } = await import('./merge');
    const base = mk();
    const old: MannaDoc = JSON.parse(JSON.stringify(base));
    old.origin = { by: '수신자', at: base.meta.updatedAt, baseUpdatedAt: base.meta.updatedAt };
    old.screens[0].annotations[0].replies.push({ id: 'r-new', author: '수신자', at: base.meta.updatedAt, body: '확인했습니다' });
    // 작성자가 그 뒤로 본문을 고치고 화면을 하나 더 넣은 새 판
    base.screens[0].annotations[0].body = '작성자의 새 본문';
    base.screens[0].annotations[0].updatedAt = new Date(Date.parse(base.meta.updatedAt) + 5000).toISOString();
    base.screens.push({ id: 'SCR-009', title: '새 화면', notes: '', versions: base.screens[0].versions, annotations: [] });
    const r = mergeDoc(base, old, new Map(), new Map());
    expect(base.screens[0].annotations[0].body).toBe('작성자의 새 본문');
    expect(base.screens.some((s) => s.id === 'SCR-009')).toBe(true);
    expect(r.replies).toBe(1);
    expect(r.conflicts).toHaveLength(0);
  });

  it('다른 문서는 합치지 않는다', async () => {
    const { mergeDoc } = await import('./merge');
    expect(() => mergeDoc(mk(), mk(), new Map(), new Map())).toThrow(/다른 문서/);
  });
});
