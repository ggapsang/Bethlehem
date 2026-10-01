/* 화면 등록 — 폴더를 훑어 엔트리·포함 파일·외부 리소스를 고르고 굽는다 (docs/ARCHITECTURE.md §5.3) */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { FolderOpen, Globe, Loader2 } from 'lucide-preact';
import { formatBytes } from '@core';
import type { ScanResult } from '@core/node/pack';
import { doc } from '@manna/store';
import { applyImport, importing, type ImportTarget } from './session';

const ICON = { size: 16, strokeWidth: 1.5 };
const api = window.bethlehem;

export function ImportDialog({ target }: { target: ImportTarget }) {
  const existing = target.screenId ? doc.value.screens.find((s) => s.id === target.screenId) : undefined;
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [entry, setEntry] = useState<string | undefined>(undefined);
  const [include, setInclude] = useState<Set<string>>(new Set());
  const [desc, setDesc] = useState<string>('');
  const [ext, setExt] = useState<Record<string, boolean>>({});
  const [title, setTitle] = useState(existing?.title ?? '');
  const [label, setLabel] = useState('');
  const [w, setW] = useState(1920);
  const [h, setH] = useState(1080);
  const [move, setMove] = useState(true);
  const [busy, setBusy] = useState<string | null>('폴더를 살펴보는 중…');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setBusy('폴더를 살펴보는 중…');
    api
      .scanFolder(target.dir, entry)
      .then((s) => {
        if (!alive) return;
        setScan(s);
        setInclude(new Set(s.files.filter((f) => f.referenced).map((f) => f.path)));
        setDesc(s.description ?? '');
        setExt(Object.fromEntries(s.external.map((u) => [u, true])));
        if (!existing) setTitle((t) => t || s.title || s.name);
        if (s.htmls.length > 1) setLabel(s.entry);
        setBusy(null);
        setError(null);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setBusy(null);
        setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      });
    return () => {
      alive = false;
    };
  }, [target.dir, entry]);

  const size = useMemo(() => scan?.files.filter((f) => include.has(f.path)).reduce((n, f) => n + f.size, 0) ?? 0, [scan, include]);

  const toggle = (p: string) => {
    const next = new Set(include);
    next.has(p) ? next.delete(p) : next.add(p);
    setInclude(next);
  };

  const close = () => !busy?.startsWith('굽는') && (importing.value = null);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!scan) return;
    setBusy(Object.values(ext).some(Boolean) ? '굽는 중… 외부 리소스를 내려받고 있습니다' : '굽는 중…');
    try {
      const r = await api.packFolder({
        dir: scan.dir,
        entry: scan.entry,
        include: [...include].filter((p) => p !== desc),
        description: desc || undefined,
        external: scan.external.map((url) => ({ url, excluded: !ext[url] })),
        viewport: { w, h, fit: 'contain' },
      });
      applyImport(target, r, { title: title.trim() || scan.name, label: label.trim() || undefined, viewport: { w, h, fit: 'contain' }, moveAnnotations: move });
      importing.value = null;
    } catch (err) {
      setBusy(null);
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };

  return (
    <div class="modal-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
      <form class="modal modal-wide" onSubmit={submit} aria-labelledby="imp-title">
        <h2 id="imp-title">{existing ? `${existing.id} 새 버전 등록` : '화면 등록'}</h2>
        <p class="muted row"><FolderOpen {...ICON} /> <span class="mono ellipsis">{target.dir}</span></p>

        {error && (
          <div class="callout callout-error" role="alert">
            <strong>폴더를 읽지 못했습니다.</strong> {error}
          </div>
        )}

        {scan && (
          <>
            <div class="form-grid">
              <label class="field">
                <span>화면 이름</span>
                <input class="input" value={title} onInput={(e) => setTitle(e.currentTarget.value)} />
              </label>
              <label class="field">
                <span>시작 파일 (엔트리)</span>
                <select class="input" value={scan.entry} onChange={(e) => setEntry(e.currentTarget.value)}>
                  {scan.htmls.map((h) => <option key={h}>{h}</option>)}
                </select>
              </label>
              <label class="field">
                <span>버전 메모</span>
                <input class="input" value={label} placeholder="예: 시안 2, 고객 피드백 반영" onInput={(e) => setLabel(e.currentTarget.value)} />
              </label>
              <div class="field">
                <span>기준 화면 크기</span>
                <div class="row">
                  <input class="input" type="number" min={320} step={4} value={w} onInput={(e) => setW(Number(e.currentTarget.value) || 1920)} aria-label="너비" />
                  <span class="muted">×</span>
                  <input class="input" type="number" min={240} step={4} value={h} onInput={(e) => setH(Number(e.currentTarget.value) || 1080)} aria-label="높이" />
                </div>
              </div>
            </div>

            <section>
              <h3 class="section-title">
                포함할 파일 <span class="muted">{include.size}개 · {formatBytes(size)}</span>
              </h3>
              <ul class="file-list">
                {scan.files.map((f) => {
                  const isEntry = f.path === scan.entry;
                  const isDesc = f.path === desc;
                  return (
                    <li key={f.path} class={!include.has(f.path) && !isEntry ? 'is-off' : ''}>
                      <label class="row">
                        <input type="checkbox" checked={isEntry || isDesc || include.has(f.path)} disabled={isEntry || isDesc} onChange={() => toggle(f.path)} />
                        <span class="mono grow ellipsis">{f.path}</span>
                        {isEntry && <span class="chip st-doing">엔트리</span>}
                        {isDesc && <span class="chip st-done">설명</span>}
                        {!f.referenced && !isEntry && !isDesc && <span class="chip st-hold" title="다른 파일에서 이름이 언급되지 않습니다. 화면이 실제로 쓰는지 확인 후 포함하세요.">미참조 추정</span>}
                        <span class="muted small">{formatBytes(f.size)}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              {scan.files.some((f) => /\.md$/i.test(f.path)) && (
                <label class="field">
                  <span>화면 설명 문서 (Manna 의 설명 탭)</span>
                  <select class="input" value={desc} onChange={(e) => setDesc(e.currentTarget.value)}>
                    <option value="">없음</option>
                    {scan.files.filter((f) => /\.md$/i.test(f.path)).map((f) => <option key={f.path}>{f.path}</option>)}
                  </select>
                </label>
              )}
            </section>

            {scan.external.length > 0 && (
              <section>
                <h3 class="section-title">외부 리소스 <span class="muted">굽을 때 내려받아 문서에 담습니다</span></h3>
                <ul class="file-list">
                  {scan.external.map((u) => (
                    <li key={u} class={ext[u] ? '' : 'is-off'}>
                      <label class="row">
                        <input type="checkbox" checked={!!ext[u]} onChange={() => setExt({ ...ext, [u]: !ext[u] })} />
                        <Globe {...ICON} />
                        <span class="mono grow ellipsis" title={u}>{u}</span>
                        {!ext[u] && <span class="chip st-hold">링크 유지 · 오프라인에서 달라질 수 있음</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {existing && existing.annotations.some((a) => a.version === existing.versions[existing.versions.length - 1].v) && (
              <label class="row">
                <input type="checkbox" checked={move} onChange={() => setMove(!move)} />
                <span>기존 어노테이션을 새 버전으로 옮기기 <span class="muted">— 요소 지문으로 새 화면에서 다시 찾습니다</span></span>
              </label>
            )}
          </>
        )}

        <div class="row">
          {busy && <span class="muted row"><Loader2 {...ICON} class="spin" /> {busy}</span>}
          <span class="grow" />
          <button type="button" class="btn btn-ghost" onClick={close} disabled={!!busy?.startsWith('굽는')}>취소</button>
          <button type="submit" class="btn btn-primary" disabled={!scan || !!busy}>{existing ? '버전 추가' : '등록'}</button>
        </div>
      </form>
    </div>
  );
}
