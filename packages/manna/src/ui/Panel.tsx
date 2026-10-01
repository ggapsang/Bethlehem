/* 오른쪽 패널 — TODO(어노테이션) 와 화면 설명 (docs/ARCHITECTURE.md §4.1) */
import { useEffect, useRef, useState } from 'preact/hooks';
import { MessageSquare, Trash2, X } from 'lucide-preact';
import type { Annotation, Kind, Screen, Status } from '@core';
import {
  KINDS, STATUSES, displayNo, fingerprint, nextAnnotationNo, now, setField, styleProps, touchParticipant, trailOf, uid,
} from '@core';
import type { Host } from '../host';
import {
  annotations, askName, draft, hovered, mode, mutate, screen, selected, tab, user, version, visible,
} from '../store';
import { Description } from './Description';
import { KIND_CLASS, STATUS_CLASS, ago, anchorLabel } from './labels';

const ICON = { size: 16, strokeWidth: 1.5 };

function needName(): boolean {
  if (user.value) return false;
  askName.value = true;
  return true;
}

export function Panel({ host }: { host: Host }) {
  const scr = screen.value;
  const list = annotations.value;
  const vis = visible.value;
  const hasDesc = !!scr?.description;
  const current = tab.value === 'desc' && hasDesc ? 'desc' : 'todo';
  const shown = list.filter((a) => vis.has(a.id));
  const hidden = list.filter((a) => !vis.has(a.id));
  const open = list.filter((a) => a.status !== '완료').length;

  return (
    <aside class="panel" aria-label="TODO 와 설명">
      <div class="panel-tabs" role="tablist">
        <button role="tab" aria-selected={current === 'todo'} class="ptab" onClick={() => (tab.value = 'todo')}>
          TODO <span class="count">{open}/{list.length}</span>
        </button>
        {hasDesc && (
          <button role="tab" aria-selected={current === 'desc'} class="ptab" onClick={() => (tab.value = 'desc')}>
            설명
          </button>
        )}
      </div>
      {current === 'desc' && scr?.description ? (
        <Description sha={scr.description.sha} />
      ) : (
        <div class="panel-body">
          {draft.value && scr && <Composer host={host} scr={scr} />}
          {!list.length && !draft.value && (
            <div class="panel-empty">
              <p>아직 어노테이션이 없습니다.</p>
              <p class="muted">
                툴바의 <strong>어노테이션</strong> 모드에서 요소를 클릭하거나, 드래그해 영역을 잡으세요. 캔버스 위 특정 지점은 드래그로 잡습니다.
              </p>
            </div>
          )}
          {shown.length > 0 && <Group title="지금 화면에 보이는 항목" items={shown} scr={scr!} host={host} />}
          {hidden.length > 0 && <Group title="다른 화면 상태에 있는 항목" items={hidden} scr={scr!} host={host} dim />}
        </div>
      )}
    </aside>
  );
}

function Group({ title, items, scr, host, dim }: { title: string; items: Annotation[]; scr: Screen; host: Host; dim?: boolean }) {
  const sorted = [...items].sort((a, b) => (a.no ?? 1e9) - (b.no ?? 1e9) || a.createdAt.localeCompare(b.createdAt));
  return (
    <section class="group">
      <h3 class="group-title">{title}</h3>
      <ul class="cards">
        {sorted.map((a) => <Card key={a.id} a={a} scr={scr} host={host} dim={dim} />)}
      </ul>
    </section>
  );
}

function Card({ a, scr, host, dim }: { a: Annotation; scr: Screen; host: Host; dim?: boolean }) {
  const sel = selected.value === a.id;
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (sel) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [sel]);
  return (
    <li
      ref={ref}
      class={`card ${sel ? 'is-sel' : ''} ${dim ? 'is-dim' : ''}`}
      onPointerEnter={() => (hovered.value = a.id)}
      onPointerLeave={() => (hovered.value = null)}
    >
      <button type="button" class="card-head" aria-expanded={sel} onClick={() => (selected.value = sel ? null : a.id)}>
        <span class={`no st-${STATUS_CLASS[a.status]}`}>{displayNo(scr, a)}</span>
        <span class={`chip kind-${KIND_CLASS[a.kind]}`}>{a.kind}</span>
        <span class={`chip status st-${STATUS_CLASS[a.status]}`}>{a.status}</span>
        <span class="card-meta">{a.author} · {ago(a.createdAt)}</span>
      </button>
      {!sel && (
        <button type="button" class="card-preview" onClick={() => (selected.value = a.id)}>
          <span class="clamp">{a.body}</span>
          {dim && a.anchor.trail.length > 0 && <span class="hint">{a.anchor.trail.join(' · ')} 상태에서 작성</span>}
          {a.replies.length > 0 && (
            <span class="replies-count"><MessageSquare {...ICON} size={14} /> {a.replies.length}</span>
          )}
        </button>
      )}
      {sel && <Detail a={a} host={host} dim={dim} />}
    </li>
  );
}

function Detail({ a, host, dim }: { a: Annotation; host: Host; dim?: boolean }) {
  const me = user.value ?? '';
  const mine = a.author === me || host.author;
  const [body, setBody] = useState(a.body);
  const [reply, setReply] = useState('');
  useEffect(() => setBody(a.body), [a.id]);

  const set = <K extends keyof Annotation>(field: K, value: Annotation[K]) => {
    if (needName()) return;
    mutate(() => setField(a, field, value, user.value!));
  };

  const sendReply = () => {
    const text = reply.trim();
    if (!text || needName()) return;
    mutate((d) => {
      a.replies.push({ id: uid(), author: user.value!, at: now(), body: text });
      a.updatedAt = now();
      touchParticipant(d, user.value!);
    });
    setReply('');
  };

  const remove = () => {
    if (!confirm(`${a.no ?? '새'}번 어노테이션을 지울까요? 답글도 함께 지워집니다.`)) return;
    mutate(() => {
      const s = screen.peek()!;
      s.annotations = s.annotations.filter((x) => x.id !== a.id);
    });
    selected.value = null;
  };

  return (
    <div class="detail">
      {dim && (
        <p class="hint-box">
          이 항목의 대상은 지금 화면에 보이지 않습니다.
          {a.anchor.trail.length > 0 ? ` 작성 당시 선택 상태: ${a.anchor.trail.join(' · ')}.` : ''} 화면에서 해당 탭이나 상태로 이동하면 마커가 나타납니다.
        </p>
      )}
      {mine ? (
        <textarea
          class="input body-edit"
          value={body}
          rows={Math.min(10, Math.max(3, body.split('\n').length + 1))}
          onInput={(e) => setBody(e.currentTarget.value)}
          onBlur={() => body !== a.body && set('body', body)}
        />
      ) : (
        <p class="body">{a.body}</p>
      )}
      <div class="fields">
        <label class="field">
          <span>유형</span>
          <select class="input" value={a.kind} disabled={!mine} onChange={(e) => set('kind', e.currentTarget.value as Kind)}>
            {KINDS.map((k) => <option key={k}>{k}</option>)}
          </select>
        </label>
        <label class="field">
          <span>상태</span>
          <select class="input" value={a.status} onChange={(e) => set('status', e.currentTarget.value as Status)}>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label class="field field-wide">
          <span>담당</span>
          <input
            class="input"
            value={a.assignee ?? ''}
            placeholder="이름"
            onBlur={(e) => e.currentTarget.value !== (a.assignee ?? '') && set('assignee', e.currentTarget.value || undefined)}
          />
        </label>
      </div>
      <details class="props">
        <summary>요소 속성 · {anchorLabel(a.anchor.fp, !!a.anchor.region)}</summary>
        <dl>
          {Object.entries(a.anchor.props ?? {}).map(([k, v]) => (
            <div key={k} class="prop"><dt>{k}</dt><dd>{v}</dd></div>
          ))}
          <div class="prop"><dt>선택자</dt><dd><code>{a.anchor.fp.selector}</code></dd></div>
        </dl>
      </details>
      {a.replies.length > 0 && (
        <ol class="replies">
          {a.replies.map((r) => (
            <li key={r.id} class="reply">
              <span class="reply-meta">{r.author} · {ago(r.at)}</span>
              <p>{r.body}</p>
            </li>
          ))}
        </ol>
      )}
      <div class="reply-box">
        <textarea
          class="input"
          rows={2}
          placeholder="답글 (Ctrl+Enter)"
          value={reply}
          onInput={(e) => setReply(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && sendReply()}
        />
        <div class="row">
          {mine && (
            <button type="button" class="btn btn-ghost btn-danger" onClick={remove}>
              <Trash2 {...ICON} /> 삭제
            </button>
          )}
          <span class="grow" />
          <button type="button" class="btn btn-secondary" disabled={!reply.trim()} onClick={sendReply}>답글</button>
        </div>
      </div>
    </div>
  );
}

function Composer({ host, scr }: { host: Host; scr: Screen }) {
  const d = draft.value!;
  const [kind, setKind] = useState<Kind>(host.author ? '설명' : '요청');
  const [body, setBody] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => area.current?.focus(), [d]);

  const add = () => {
    const text = body.trim();
    if (!text || needName()) return;
    const v = version.peek()!;
    const t = now();
    const a: Annotation = {
      id: uid(),
      no: host.author ? nextAnnotationNo(scr) : null,
      version: v.v,
      anchor: {
        fp: fingerprint(d.el),
        ...(d.region ? { region: d.region } : {}),
        trail: trailOf(d.el.ownerDocument),
        props: styleProps(d.el),
      },
      kind,
      status: '열림',
      body: text,
      author: user.value!,
      createdAt: t,
      updatedAt: t,
      replies: [],
      history: [],
    };
    mutate((doc) => {
      scr.annotations.push(a);
      touchParticipant(doc, user.value!);
    });
    draft.value = null;
    selected.value = a.id;
  };

  const fp = fingerprint(d.el);
  return (
    <div class="composer" role="form" aria-label="새 어노테이션">
      <div class="row">
        <strong>새 어노테이션</strong>
        <span class="muted mono">{anchorLabel(fp, !!d.region)}</span>
        <span class="grow" />
        <button type="button" class="btn-icon" aria-label="취소" onClick={() => (draft.value = null)}><X {...ICON} /></button>
      </div>
      <div class="seg" role="radiogroup" aria-label="유형">
        {KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} class={`seg-btn kind-${KIND_CLASS[k]}`} onClick={() => setKind(k)}>{k}</button>
        ))}
      </div>
      <textarea
        ref={area}
        class="input"
        rows={4}
        placeholder="이 요소에 대한 설명이나 요청 (Ctrl+Enter 로 추가)"
        value={body}
        onInput={(e) => setBody(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add();
          if (e.key === 'Escape') draft.value = null;
        }}
      />
      <p class="muted small">Alt+↑/↓ 로 부모·자식 요소로 옮깁니다. 화면을 다시 클릭하면 대상이 바뀝니다.</p>
      <div class="row">
        <span class="grow" />
        <button type="button" class="btn btn-ghost" onClick={() => { draft.value = null; mode.value = 'view'; }}>그만 달기</button>
        <button type="button" class="btn btn-primary" disabled={!body.trim()} onClick={add}>추가</button>
      </div>
    </div>
  );
}
