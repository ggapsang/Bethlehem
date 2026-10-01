import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeBlob } from '../src/codec';
import { externalRefs, packFolder, scanFolder, type Fetcher } from './pack';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'terrarium-'));
  await mkdir(join(dir, 'data'));
  await mkdir(join(dir, 'assets'));
  await mkdir(join(dir, '.git'));
  await writeFile(
    join(dir, 'index.html'),
    `<!doctype html><title>설비 화면</title>
<link rel="preconnect" href="https://cdn.example.com">
<link rel="stylesheet" href="https://cdn.example.com/f/pretendardvariable-dynamic-subset.min.css">
<!-- 옛 화면(old.html)과 비교 -->
<script>const CH=['ops','vib'];CH.forEach(k=>{const s=document.createElement('script');s.src=\`data/\${k}.js\`;document.head.appendChild(s)})</script>`,
  );
  await writeFile(join(dir, 'old.html'), '<!doctype html><p>old</p>');
  await writeFile(join(dir, 'data/ops.js'), 'window.OPS="1,2,3"');
  await writeFile(join(dir, 'data/vib.js'), 'window.VIB="4,5,6"');
  await writeFile(join(dir, 'assets/unused.png'), new Uint8Array([137, 80, 78, 71]));
  await writeFile(join(dir, 'README.md'), '# 설명');
  await writeFile(join(dir, '.git/HEAD'), 'ref');
});

afterAll(() => rm(dir, { recursive: true, force: true }));

describe('scanFolder', () => {
  it('엔트리·설명·외부 리소스·미참조 파일을 고른다', async () => {
    const s = await scanFolder(dir);
    expect(s.entry).toBe('index.html');
    expect(s.title).toBe('설비 화면');
    expect(s.description).toBe('README.md');
    expect(s.htmls).toEqual(['index.html', 'old.html']);
    expect(s.files.map((f) => f.path)).not.toContain('.git/HEAD');
    const ref = Object.fromEntries(s.files.map((f) => [f.path, f.referenced]));
    // 템플릿 문자열로 만든 경로도 확장자 뺀 이름으로 참조로 본다
    expect(ref['data/ops.js']).toBe(true);
    expect(ref['data/vib.js']).toBe(true);
    expect(ref['assets/unused.png']).toBe(false);
    // 주석에서 이름만 언급된 HTML 은 참조가 아니다
    expect(ref['old.html']).toBe(false);
    expect(s.external).toEqual(['https://cdn.example.com/f/pretendardvariable-dynamic-subset.min.css']);
  });

  it('HTML 이 없는 폴더는 이유를 알려 준다', async () => {
    await expect(scanFolder(join(dir, 'data'))).rejects.toThrow(/HTML 파일이 없습니다/);
  });
});

describe('externalRefs', () => {
  it('preconnect 는 빼고 인라인 style 의 url() 은 넣는다', () => {
    const html = `<link rel="preconnect" href="https://a.com"><script src="https://b.com/x.js"></script><style>@import url("https://c.com/y.css");.a{background:url(local.png)}</style>`;
    expect(externalRefs(html).sort()).toEqual(['https://b.com/x.js', 'https://c.com/y.css']);
  });
});

describe('packFolder', () => {
  it('Pretendard dynamic-subset 을 단일 woff2 로 바꿔 담고 내용 해시로 저장한다', async () => {
    const calls: string[] = [];
    const fetcher: Fetcher = async (url) => {
      calls.push(url);
      if (url.endsWith('.css')) {
        return { ok: true, status: 200, type: 'text/css', bytes: new TextEncoder().encode('@font-face{src:url(../../pkg/woff2-dynamic-subset/PretendardVariable.subset.0.woff2)}') };
      }
      return { ok: true, status: 200, type: 'font/woff2', bytes: new Uint8Array([1, 2, 3]) };
    };
    const s = await scanFolder(dir);
    const r = await packFolder(
      { dir, entry: s.entry, include: ['data/ops.js', 'data/vib.js'], description: 'README.md', external: s.external.map((url) => ({ url })), viewport: { w: 1920, h: 1080, fit: 'contain' } },
      fetcher,
    );
    expect(Object.keys(r.version.files).sort()).toEqual(['data/ops.js', 'data/vib.js', 'index.html']);
    expect(r.description?.name).toBe('README.md');
    const [css, font] = r.version.external;
    expect(css.note).toMatch(/단일 variable woff2/);
    expect(font.url).toBe('https://cdn.example.com/pkg/woff2/PretendardVariable.woff2');
    expect(font.via).toBe(css.url);
    expect(calls).toEqual([css.url, font.url]); // 조각 92개가 아니라 파일 하나만 받는다
    const blobs = new Map(r.blobs);
    const cssText = new TextDecoder().decode(await decodeBlob(blobs.get(css.sha!)!));
    expect(cssText).toContain(`url(${font.url})`);
    expect(blobs.get(font.sha!)!.enc).toBe('b64');
  });

  it('내려받지 못한 외부 리소스는 링크로 남기고 사유를 적는다', async () => {
    const r = await packFolder(
      { dir, entry: 'index.html', include: [], external: [{ url: 'https://down.example.com/a.css' }], viewport: { w: 1, h: 1, fit: 'contain' } },
      async () => ({ ok: false, status: 503, bytes: new Uint8Array() }),
    );
    expect(r.version.external[0]).toMatchObject({ excluded: true, error: expect.stringContaining('503') });
  });
});
