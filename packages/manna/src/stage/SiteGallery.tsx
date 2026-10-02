/* URL 화면을 받은 사람 쪽에서 — 사이트는 실시간으로 띄울 수 없으니 Comment 를 달 때 찍은 그림과 녹화한 클립의 모음으로 보인다.
 * 하나를 누르면 그 자리에서 크게 펼쳐 본문 · 답글을 본다. 사본(마지막 모습)이 있으면 그것으로 바꿔 볼 수도 있다.
 */
import { useEffect, useRef } from 'preact/hooks';
import { ExternalLink, Film, Image as ImageIcon } from 'lucide-preact';
import type { Annotation, Screen, ScreenVersion } from '@core';
import { displayNo } from '@core';
import type { Host } from '../host';
import { popHidden, rev, selected, shownAnnotations } from '../store';
import { Detail } from '../ui/Popover';
import { Who } from '../ui/Who';
import { useBlobUrl } from './media';

const ICON = { size: 16, strokeWidth: 1.5 };

function Shot({ a }: { a: Annotation }) {
  const src = useBlobUrl(a.shot?.sha, 'image/jpeg');
  const sh = a.shot;
  if (!sh) return null;
  const b = sh.box;
  return (
    <div class="gal-shot" style={{ aspectRatio: `${sh.w} / ${sh.h}` }}>
      {src && <img src={src} alt={`${a.title ?? 'Comment'} — 달 때 찍은 화면`} draggable={false} />}
      {b && <div class="gal-box" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }} />}
    </div>
  );
}

function ClipVideo({ sha, type }: { sha: string; type: string }) {
  const src = useBlobUrl(sha, type);
  return src ? <video class="gal-clip" src={src} controls loop muted playsInline autoPlay /> : null;
}

export function SiteGallery({ host, scr, v, hasCopy, copyLabel = '마지막 사본 보기', onCopy }: { host: Host; scr: Screen; v: ScreenVersion; hasCopy: boolean; copyLabel?: string; onCopy: () => void }) {
  rev.value;
  const list = shownAnnotations.value.filter((a) => a.shot || (a.clips?.length ?? 0) > 0);
  const rest = shownAnnotations.value.length - list.length;
  const selRef = useRef<HTMLElement>(null);
  useEffect(() => {
    selRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected.value]);
  const url = v.source?.url ?? '';
  return (
    <div class="gallery">
      <div class="gal-head">
        <a class="gal-url mono" href={url} target="_blank" rel="noreferrer" title="사이트를 브라우저로 열기">{url} <ExternalLink {...ICON} size={13} /></a>
        <span class="grow" />
        <span class="muted small"><ImageIcon {...ICON} size={13} /> 캡처 {list.length}{rest > 0 ? ` · 그 밖의 Comment ${rest}` : ''}</span>
        {hasCopy && <button type="button" class="btn btn-ghost btn-bar" onClick={onCopy}>{copyLabel}</button>}
      </div>
      {list.length === 0 ? (
        <p class="gal-empty muted">캡처가 없습니다.</p>
      ) : (
        <div class="gal-grid">
          {list.map((a) => {
            const on = selected.value === a.id && !popHidden.value;
            return (
              <article key={a.id} ref={on ? selRef : undefined} class={`gal-item ${on ? 'is-sel' : ''}`} data-id={a.id}>
                <button
                  type="button"
                  class="gal-main"
                  aria-expanded={on}
                  onClick={() => {
                    if (on) selected.value = null;
                    else {
                      selected.value = a.id;
                      popHidden.value = false;
                    }
                  }}
                >
                  <div class="gal-cap">
                    <span class="no">{displayNo(scr, a)}</span>
                    <span class="gal-title ellipsis">{a.title || a.body.split('\n').find((l) => l.trim())?.replace(/^[#>\-*\s[\]x]+/, '') || '제목 없음'}</span>
                    <span class="grow" />
                    {(a.clips?.length ?? 0) > 0 && <span class="badge-icon"><Film {...ICON} size={14} /> {a.clips!.length}</span>}
                  </div>
                  <Who a={a} />
                  <Shot a={a} />
                </button>
                {(a.clips ?? []).length > 0 && (
                  <div class="gal-clips">
                    {a.clips!.map((c) => <ClipVideo key={c.id} sha={c.sha} type={c.type} />)}
                  </div>
                )}
                {on && (
                  <div class="gal-detail">
                    <Detail a={a} host={host} />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
