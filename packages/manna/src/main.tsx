/* Manna 런타임 진입점 — 내보낸 HTML 안에서 문서 데이터와 블롭을 읽어 화면을 띄운다 */
import { render } from 'preact';
import type { BlobEnc, BlobStore, MannaDoc } from '@core';
import { decodeBlob } from '@core';
import { App } from './App';
import favicon from './assets/favicon.png';
import { browserHost } from './host';
import { askName, loadDocument, notify, user } from './store';
import './styles.css';

function readDocument(): { doc: MannaDoc; blobs: BlobStore } {
  const raw = document.getElementById('manna-doc')?.textContent;
  if (!raw) throw new Error('문서 데이터(manna-doc)가 없습니다.');
  const blobs: BlobStore = new Map();
  for (const el of Array.from(document.querySelectorAll<HTMLScriptElement>('script[id^="manna-blob-"]'))) {
    blobs.set(el.id.slice('manna-blob-'.length), { enc: el.dataset.enc as BlobEnc, data: el.textContent ?? '' });
    el.textContent = ''; // 문자열은 blobs 가 들고 있으므로 DOM 쪽 사본은 비운다
  }
  return { doc: JSON.parse(raw) as MannaDoc, blobs };
}

/* 화면에 Pretendard 가 담겨 있으면 Manna 자체 UI 도 그것을 쓴다 */
async function adoptPretendard(doc: MannaDoc, blobs: BlobStore): Promise<void> {
  for (const s of doc.screens) {
    for (const v of s.versions) {
      const e = v.external.find((x) => /PretendardVariable\.woff2$/i.test(x.url) && x.sha && !x.excluded);
      const b = e?.sha && blobs.get(e.sha);
      if (!b) continue;
      const bytes = await decodeBlob(b);
      const face = new FontFace('Pretendard Variable', bytes as BufferSource, { weight: '45 920' });
      document.fonts.add(await face.load());
      return;
    }
  }
}

function boot(): void {
  const link = document.createElement('link');
  link.rel = 'icon';
  link.href = favicon;
  document.head.appendChild(link);

  const root = document.createElement('div');
  root.id = 'manna-root';
  document.body.appendChild(root);
  try {
    const { doc, blobs } = readDocument();
    // 받은 파일 이름 — 다시 저장할 때 그 뒤에 내 이름을 붙인다
    const own = location.protocol === 'file:' ? decodeURIComponent(location.pathname.split('/').pop() ?? '') : '';
    loadDocument(doc, blobs, own || null);
    render(<App host={browserHost} />, root);
    if (!user.value) askName.value = true;
    adoptPretendard(doc, blobs).catch(() => {});
  } catch (e) {
    root.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'fatal';
    p.textContent = `문서를 열지 못했습니다: ${(e as Error).message} — 파일이 잘렸거나 다른 프로그램이 내용을 바꿨을 수 있습니다. 보낸 사람에게 원본을 다시 받아 주세요.`;
    root.appendChild(p);
    notify((e as Error).message, 'error');
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
