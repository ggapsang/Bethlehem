/* 터미널 — 창 아래에 붙는 셸 (VS Code 처럼). 프로젝트 창마다 하나, 그 창의 작업 폴더에서 시작한다.
 * node-pty 로 진짜 터미널을 띄우고, 렌더러의 xterm 과 IPC 로 주고받는다.
 */
import { ipcMain, type WebContents } from 'electron';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import type { IPty } from '@lydell/node-pty';

/** 창(webContents id)마다 셸 하나 */
const ptys = new Map<number, IPty>();

function shell(): { file: string; args: string[] } {
  if (process.platform === 'win32') return { file: 'powershell.exe', args: ['-NoLogo'] };
  return { file: process.env.SHELL || '/bin/bash', args: ['-l'] };
}

/** 셸을 끝낸다 (id 가 없으면 모두). Windows 의 conpty 는 kill() 이 메인 스레드를 붙잡고 놓지 않는 일이 있어, 바깥에서 프로세스 트리째 끝낸다 */
export function killTerminal(id?: number): void {
  for (const [k, p] of [...ptys]) {
    if (id !== undefined && k !== id) continue;
    ptys.delete(k);
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore', detached: true, windowsHide: true }).unref();
      else p.kill();
    } catch {
      /* 이미 끝났다 */
    }
  }
}

export function setupTerminal(getCwd: (sender: WebContents) => string | null): void {
  ipcMain.handle('term-start', async (e, o: { cols: number; rows: number }) => {
    const id = e.sender.id;
    const had = ptys.get(id);
    if (had) return { pid: had.pid, reused: true };
    const { spawn: spawnPty } = await import('@lydell/node-pty');
    const cwd = getCwd(e.sender);
    const { file, args } = shell();
    const p = spawnPty(file, args, {
      name: 'xterm-256color',
      cols: Math.max(20, o.cols | 0),
      rows: Math.max(4, o.rows | 0),
      cwd: cwd && existsSync(cwd) ? cwd : homedir(),
      env: { ...process.env, TERM_PROGRAM: 'Terrarium' } as Record<string, string>,
      useConpty: true,
    });
    ptys.set(id, p);
    const to = e.sender;
    p.onData((d) => !to.isDestroyed() && to.send('term-data', d));
    p.onExit(({ exitCode }) => {
      if (ptys.get(id) === p) ptys.delete(id);
      if (!to.isDestroyed()) to.send('term-exit', exitCode);
    });
    return { pid: p.pid, reused: false };
  });
  ipcMain.on('term-write', (e, data: string) => ptys.get(e.sender.id)?.write(data));
  ipcMain.on('term-resize', (e, o: { cols: number; rows: number }) => {
    try {
      ptys.get(e.sender.id)?.resize(Math.max(20, o.cols | 0), Math.max(4, o.rows | 0));
    } catch {
      /* 끝나는 중 */
    }
  });
  ipcMain.on('term-kill', (e) => killTerminal(e.sender.id));
}
