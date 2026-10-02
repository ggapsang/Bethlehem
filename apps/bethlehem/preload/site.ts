/* URL 화면(webview)의 preload — 에이전트를 페이지 스크립트보다 먼저 메인 월드에 넣고, 메시지를 잇는다.
 *   에이전트 → window.postMessage({ __terrAgent }) → 여기 → sendToHost('terr')  → 스테이지
 *   스테이지 → webview.send('terr') → 여기 → window.postMessage({ __terrHost }) → 에이전트
 */
import { contextBridge, ipcRenderer } from 'electron';
import AGENT from '../../../out/agent/agent.js?raw';

// 격리된 월드에서 함수로 만들어 메인 월드에서 실행한다 — 페이지의 CSP(eval 금지)에 걸리지 않는다
contextBridge.executeInMainWorld({ func: new Function(AGENT) as () => void });

window.addEventListener('message', (e) => {
  const m = (e.data as { __terrAgent?: unknown } | null)?.__terrAgent;
  if (m && e.source === window) ipcRenderer.sendToHost('terr', m);
});
ipcRenderer.on('terr', (_e, m) => window.postMessage({ __terrHost: m }, '*'));
