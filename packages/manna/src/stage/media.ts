/* 문서 안 블롭(그림·클립)을 화면에 띄울 Blob URL 로 — 한 번 푼 것은 다시 쓴다 */
import { useEffect, useState } from 'preact/hooks';
import { decodeBlob } from '@core';
import { blobs } from '../store';

const urls = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

export function blobUrlAsync(sha: string, type: string): Promise<string | null> {
  const hit = urls.get(sha);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(sha);
  if (!p) {
    const b = blobs.get(sha);
    p = b
      ? decodeBlob(b).then((bytes) => {
          const u = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
          urls.set(sha, u);
          return u;
        })
      : Promise.resolve(null);
    pending.set(sha, p);
  }
  return p;
}

export function useBlobUrl(sha: string | undefined, type: string): string | null {
  const [url, setUrl] = useState<string | null>(sha ? (urls.get(sha) ?? null) : null);
  useEffect(() => {
    if (!sha) return setUrl(null);
    let alive = true;
    blobUrlAsync(sha, type).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [sha]);
  return url;
}
