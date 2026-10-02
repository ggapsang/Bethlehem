/* Electron <webview> 태그 — Bethlehem 의 URL 화면 */
import 'preact';

declare module 'preact' {
  namespace JSX {
    interface IntrinsicElements {
      webview: JSX.HTMLAttributes<HTMLElement> & {
        src?: string;
        partition?: string;
        preload?: string;
        webpreferences?: string;
        allowpopups?: string;
      };
    }
  }
}
