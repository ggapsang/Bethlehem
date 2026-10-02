/* 터미널 — 창 아래 (VS Code 처럼). 기본은 접혀 있고, 펴면 작업 폴더에서 셸이 뜬다.
 * "Claude Code" 를 누르면 작업 폴더 형식 문서를 알려 주며 claude 를 띄운다. 그것이 파일을 고치면 테라리움이 바로 다시 불러온다.
 */
import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { ChevronDown, ChevronUp, FolderInput, RotateCcw, Sparkles, SquareTerminal, X } from 'lucide-preact';
import { theme } from '@manna/store';
import { mode, reloadWorkspace } from './session';

const api = window.bethlehem;
const ICON = { size: 16, strokeWidth: 1.5 };
const KEY = 'terr.termH';

export const termOpen = signal(false);
const termH = signal((() => {
  try {
    return Math.min(800, Math.max(140, Number(localStorage.getItem(KEY)) || 280));
  } catch {
    return 280;
  }
})());

const THEMES = {
  dark: { background: '#0c0a09', foreground: '#e7e5e4', cursor: '#f86517', selectionBackground: '#44403c' },
  light: { background: '#fafaf9', foreground: '#1c1917', cursor: '#f14d0d', selectionBackground: '#d6d3d1' },
};

/** PowerShell · bash 둘 다 작은따옴표 안은 그대로다 — 작은따옴표만 피한다 */
const quote = (s: string) => `'${s.replace(/'/g, '')}'`;

export function TerminalPanel() {
  const open = termOpen.value;
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<XTerm | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const [alive, setAlive] = useState(false);
  const [startedIn, setStartedIn] = useState<string | null>(null);
  const dir = mode.value.kind === 'workspace' ? mode.value.dir : null;

  const start = async () => {
    const t = term.current;
    if (!t) return;
    fit.current?.fit();
    await api.termStart({ cols: t.cols, rows: t.rows });
    setAlive(true);
    setStartedIn(dir);
  };

  // 한 번 만든 xterm 은 접어도 살려 둔다 (셸도 그대로)
  useEffect(() => {
    if (!open || term.current || !host.current) return;
    const t = new XTerm({
      fontFamily: '"Cascadia Mono", Consolas, ui-monospace, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: THEMES[theme.peek()],
      allowProposedApi: true,
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(host.current);
    term.current = t;
    fit.current = f;
    t.onData((d) => api.termWrite(d));
    t.onResize(({ cols, rows }) => api.termResize({ cols, rows }));
    api.onTermData((d) => t.write(d));
    api.onTermExit(() => {
      setAlive(false);
      t.write('\r\n\x1b[90m[셸이 끝났습니다 — 다시 시작을 누르세요]\x1b[0m\r\n');
    });
    // xterm 이 Ctrl 키를 먹으면 테라리움의 Ctrl 피커가 켜지지 않게 막는다
    t.attachCustomKeyEventHandler(() => true);
    requestAnimationFrame(() => {
      f.fit();
      start();
      t.focus();
    });
    const ro = new ResizeObserver(() => fit.current?.fit());
    ro.observe(host.current);
    return () => ro.disconnect();
  }, [open]);

  useEffect(() => {
    if (term.current) term.current.options.theme = THEMES[theme.value];
  }, [theme.value]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      fit.current?.fit();
      term.current?.focus();
    });
  }, [open, termH.value]);

  /* 위쪽 가장자리를 끌어 높이를 바꾼다 */
  const onGrip = (e: PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    document.body.classList.add('is-resizing-v');
    const y0 = e.clientY;
    const h0 = termH.peek();
    const move = (ev: PointerEvent) => (termH.value = Math.min(window.innerHeight - 240, Math.max(140, h0 + y0 - ev.clientY)));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      document.body.classList.remove('is-resizing-v');
      try {
        localStorage.setItem(KEY, String(Math.round(termH.peek())));
      } catch {
        /* 기억하지 못해도 된다 */
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const runClaude = async () => {
    if (!alive) await start();
    const doc = await api.formatDoc();
    const prompt = `이 폴더는 테라리움 작업 폴더다. 파일을 고치기 전에 ${doc} 를 읽고 그 형식을 지켜라. 고친 것은 테라리움이 바로 다시 불러온다.`;
    api.termWrite(`claude --append-system-prompt ${quote(prompt)}\r`);
    term.current?.focus();
  };

  const cdHere = () => {
    if (!dir) return;
    api.termWrite(navigator.userAgent.includes('Windows') ? `Set-Location -LiteralPath ${quote(dir)}\r` : `cd ${quote(dir)}\r`);
    setStartedIn(dir);
    term.current?.focus();
  };

  return (
    <section class={`term ${open ? 'is-open' : ''}`} aria-label="터미널">
      {open && <div class="term-grip" role="separator" aria-orientation="horizontal" aria-label="터미널 높이 조절" onPointerDown={onGrip} />}
      <div class="term-bar">
        <button type="button" class="term-toggle" aria-expanded={open} onClick={() => (termOpen.value = !open)} title="터미널 (Ctrl+`)">
          <SquareTerminal {...ICON} /> 터미널 {open ? <ChevronDown {...ICON} size={14} /> : <ChevronUp {...ICON} size={14} />}
        </button>
        {open && (
          <>
            <span class="term-cwd muted small ellipsis" title={startedIn ?? ''}>{startedIn ?? ''}</span>
            <span class="grow" />
            {dir && startedIn && dir.toLowerCase() !== startedIn.toLowerCase() && (
              <button type="button" class="btn btn-ghost btn-bar" onClick={cdHere} title="지금 작업 폴더로 이동"><FolderInput {...ICON} /> 작업 폴더로</button>
            )}
            <button type="button" class="btn btn-ghost btn-bar" onClick={runClaude} title="이 작업 폴더에서 Claude Code 를 띄운다"><Sparkles {...ICON} /> Claude Code</button>
            <button type="button" class="btn btn-ghost btn-bar" onClick={() => reloadWorkspace(true)} title="작업 폴더를 다시 불러온다 (바깥에서 고친 것은 저절로도 불러온다)"><RotateCcw {...ICON} /> 다시 불러오기</button>
            <button
              type="button"
              class="btn-icon btn-xs"
              aria-label="셸 다시 시작"
              title="셸 다시 시작"
              onClick={() => {
                api.termKill();
                term.current?.clear();
                setTimeout(start, 150);
              }}
            >
              <RotateCcw {...ICON} size={14} />
            </button>
            <button type="button" class="btn-icon btn-xs" aria-label="터미널 접기" onClick={() => (termOpen.value = false)}><X {...ICON} /></button>
          </>
        )}
      </div>
      <div class="term-body" style={{ height: open ? `${termH.value}px` : '0px' }}>
        <div class="term-host" ref={host} />
      </div>
    </section>
  );
}
