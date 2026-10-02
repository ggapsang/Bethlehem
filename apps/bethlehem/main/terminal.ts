/* 터미널 — 창 아래에 붙는 셸 하나 (VS Code 처럼). 작업 폴더에서 시작한다.
 * node-pty 로 진짜 터미널을 띄우고, 렌더러의 xterm 과 IPC 로 주고받는다.
 */
import { ipcMain, type BrowserWindow } from 'electron';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import type { IPty } from '@lydell/node-pty';

let pty: IPty | null = null;

function shell(): { file: string; args: string[] } {
  if (process.platform === 'win32') return { file: 'powershell.exe', args: ['-NoLogo'] };
  return { file: process.env.SHELL || '/bin/bash', args: ['-l'] };
}

/** 셸을 끝낸다. Windows 의 conpty 는 kill() 이 메인 스레드를 붙잡고 놓지 않는 일이 있어, 바깥에서 프로세스 트리째 끝낸다 */
export function killTerminal(): void {
  const p = pty;
  pty = null;
  if (!p) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore', detached: true, windowsHide: true }).unref();
    else p.kill();
  } catch {
    /* 이미 끝났다 */
  }
}

export function setupTerminal(getWin: () => BrowserWindow | null, getCwd: () => string | null): void {
  ipcMain.handle('term-start', async (_e, o: { cols: number; rows: number }) => {
    if (pty) return { pid: pty.pid, reused: true };
    const { spawn: spawnPty } = await import('@lydell/node-pty');
    const cwd = getCwd();
    const { file, args } = shell();
    const p = spawnPty(file, args, {
      name: 'xterm-256color',
      cols: Math.max(20, o.cols | 0),
      rows: Math.max(4, o.rows | 0),
      cwd: cwd && existsSync(cwd) ? cwd : homedir(),
      env: { ...process.env, TERM_PROGRAM: 'Terrarium' } as Record<string, string>,
      useConpty: true,
    });
    pty = p;
    p.onData((d) => getWin()?.webContents.send('term-data', d));
    p.onExit(({ exitCode }) => {
      if (pty === p) pty = null;
      getWin()?.webContents.send('term-exit', exitCode);
    });
    return { pid: p.pid, reused: false };
  });
  ipcMain.on('term-write', (_e, data: string) => pty?.write(data));
  ipcMain.on('term-resize', (_e, o: { cols: number; rows: number }) => {
    try {
      pty?.resize(Math.max(20, o.cols | 0), Math.max(4, o.rows | 0));
    } catch {
      /* 끝나는 중 */
    }
  });
  ipcMain.on('term-kill', () => killTerminal());
}
