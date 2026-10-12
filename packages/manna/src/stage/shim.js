/* 품은 화면 안에서 가장 먼저 실행되는 shim — docs/ARCHITECTURE.md §5.2, §5.4
 * 이 파일은 번들되지 않고 문자열 그대로(?raw) iframe <head> 맨 앞에 들어간다. 바로 뒤에 에이전트가 이어진다.
 * 함수 하나로 끝나야 하며 바깥 변수에 의존하지 않는다.
 *   map    : 가상 절대 URL → Blob URL
 *   base   : 이 문서의 가상 URL (https://pkg.manna/index.html)
 *   pages  : 패키지 안 HTML 페이지 → 미리 처리한 HTML (상대 경로를 그 페이지 기준으로 바꿔 둔 것). iframe 에 넣을 때 쓴다
 *   src    : 이 shim 의 소스 — 하위 페이지(iframe)에도 같은 shim 을 넣는다
 *   nested : 하위 페이지(엔트리 문서 안의 iframe)에서 도는가
 */
(function (map, base, pages, src, nested) {
  'use strict';
  var PKG = 'https://pkg.manna/';
  var PASS = /^(blob:|data:|javascript:|about:|mailto:|tel:|#)/i;
  var SLOT = '<script data-manna-shim=""><\/script>';
  var misses = [];
  var seenMiss = {};
  pages = pages || {};

  /** 찾지 못한 패키지 파일 — 하위 페이지는 엔트리 문서에 모아 테라리움에 알린다 */
  function report(abs) {
    if (seenMiss[abs]) return;
    seenMiss[abs] = 1;
    misses.push({ url: decodeURIComponent(abs.slice(PKG.length)), at: Date.now() });
    if (nested) {
      try { return window.parent.__manna.report(abs); } catch (e) { /* 엔트리에 닿지 못함 */ }
    }
    try { window.parent.postMessage({ manna: 'miss', url: abs }, '*'); } catch (e) { /* 무시 */ }
  }

  function absOf(ref) {
    try { return new URL(String(ref), base).href; } catch (e) { return null; }
  }

  function resolve(ref) {
    if (ref == null) return ref;
    var s = String(ref);
    if (!s || PASS.test(s)) return ref;
    var abs = absOf(s);
    if (!abs) return ref;
    var noHash = abs.split('#')[0];
    var hit = map[abs] || map[noHash] || map[noHash.split('?')[0]];
    if (hit) return hit;
    if (abs.indexOf(PKG) === 0) report(abs);
    return ref;
  }

  function patchProp(proto, prop) {
    var d = proto && Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || !d.set) return;
    Object.defineProperty(proto, prop, {
      configurable: true,
      enumerable: d.enumerable,
      get: d.get,
      set: function (v) { d.set.call(this, resolve(v)); },
    });
  }

  patchProp(HTMLScriptElement.prototype, 'src');
  patchProp(HTMLImageElement.prototype, 'src');
  patchProp(HTMLSourceElement.prototype, 'src');
  patchProp(HTMLMediaElement.prototype, 'src');
  patchProp(HTMLLinkElement.prototype, 'href');
  patchProp(HTMLVideoElement.prototype, 'poster');
  patchProp(window.HTMLEmbedElement && HTMLEmbedElement.prototype, 'src');
  patchProp(window.HTMLObjectElement && HTMLObjectElement.prototype, 'data');
  patchProp(window.HTMLFrameElement && HTMLFrameElement.prototype, 'src');

  /* 패키지 안 페이지를 iframe 에 — 미리 처리한 HTML 에 이 shim 을 넣어 srcdoc 으로. 엔트리와 같은 origin 을 이어받고,
     하위 문서 안의 상대 경로 · 동적 로드도 그 페이지 기준으로 풀린다. 그 밖의 주소는 다른 파일처럼 Blob URL 로 */
  function framed(html, url) {
    var boot = '<script>(function(){var P=window.parent.__manna;(' + src + ')(P.map,' + JSON.stringify(url).replace(/</g, '\\u003c') +
      ',P.pages,P.src,true);})();<\/script>';
    return html.indexOf(SLOT) >= 0 ? html.replace(SLOT, function () { return boot; }) : boot + html;
  }
  var frameSrc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
  var srcdocProp = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc');
  var setAttr = Element.prototype.setAttribute;
  var removeAttr = Element.prototype.removeAttribute;
  function setFrame(el, v, setNative) {
    var abs = v == null || PASS.test(String(v)) ? null : absOf(v);
    var page = abs && src ? pages[abs.split('#')[0].split('?')[0]] : null;
    if (page != null) {
      el.__mannaSrc = String(v);
      srcdocProp.set.call(el, framed(page, abs));
      return;
    }
    // 전에 넣은 페이지를 걷어야 새 주소가 뜬다 (srcdoc 이 src 보다 앞선다)
    if (el.__mannaSrc != null) removeAttr.call(el, 'srcdoc');
    el.__mannaSrc = null;
    setNative(resolve(v));
  }
  if (frameSrc && frameSrc.set && srcdocProp) {
    Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
      configurable: true,
      enumerable: frameSrc.enumerable,
      get: function () { return this.__mannaSrc != null ? absOf(this.__mannaSrc) : frameSrc.get.call(this); },
      set: function (v) {
        var el = this;
        setFrame(el, v, function (r) { frameSrc.set.call(el, r); });
      },
    });
  }

  var URL_ATTR = { src: 1, href: 1, poster: 1, data: 1 };
  var URL_TAGS = { SCRIPT: 1, IMG: 1, SOURCE: 1, VIDEO: 1, AUDIO: 1, LINK: 1, TRACK: 1, EMBED: 1, FRAME: 1, OBJECT: 1 };
  Element.prototype.setAttribute = function (name, value) {
    var n = String(name).toLowerCase();
    var el = this;
    if (n === 'src' && el.tagName === 'IFRAME' && srcdocProp) return setFrame(el, value, function (r) { setAttr.call(el, name, r); });
    if (URL_ATTR[n] && URL_TAGS[el.tagName] && (n !== 'data' || el.tagName === 'OBJECT')) value = resolve(value);
    return setAttr.call(el, name, value);
  };

  /* 문서에 처음부터 있던 <iframe src="sub/page.html"> — 로더가 data-manna-src 로 옮겨 두었다 */
  function staticFrames() {
    var list = document.querySelectorAll('iframe[data-manna-src]');
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      var v = f.getAttribute('data-manna-src');
      removeAttr.call(f, 'data-manna-src');
      f.src = v;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', staticFrames);
  else staticFrames();

  var nativeFetch = window.fetch;
  if (nativeFetch) {
    window.fetch = function (input, init) {
      if (typeof input === 'string' || input instanceof URL) input = resolve(String(input));
      else if (input && input.url) {
        var r = resolve(input.url);
        if (r !== input.url) input = new Request(r, input);
      }
      return nativeFetch.call(this, input, init);
    };
  }

  var xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments);
    args[1] = resolve(url);
    return xhrOpen.apply(this, args);
  };

  if (window.Worker) {
    var NativeWorker = window.Worker;
    window.Worker = function (url, opts) { return new NativeWorker(resolve(url), opts); };
    window.Worker.prototype = NativeWorker.prototype;
  }

  /* srcdoc 안에서는 주소가 about:srcdoc 이라 pushState · replaceState 에 준 주소가 거부된다(SecurityError).
     화면 상태를 주소에 남기는 화면도 그대로 돌게 — 주소 없이 상태만 바꾼다 */
  ['pushState', 'replaceState'].forEach(function (k) {
    var orig = history[k];
    if (!orig) return;
    history[k] = function (state, title, url) {
      try {
        return orig.apply(history, arguments);
      } catch (e) {
        if (arguments.length < 3 || !e || e.name !== 'SecurityError') throw e;
        return orig.call(history, state, title);
      }
    };
  });

  /* 패키지 안 다른 페이지로 가는 링크 — srcdoc 에서는 그대로 따라가면 깨진다. 엔트리는 부모(테라리움)에게 그 페이지를 열어 달라고 하고,
     하위 페이지는 자기 iframe 에 그 페이지를 넣는다. 화면 스크립트가 먼저 처리(preventDefault)한 클릭은 건드리지 않는다. */
  window.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || (a.target && a.target !== '_self')) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#') return;
    var abs = absOf(href);
    if (!abs) return;
    var pagePath = abs.split('#')[0].split('?')[0];
    if (pagePath.indexOf(PKG) !== 0 || !/\.html?$/i.test(pagePath) || !map[pagePath]) return;
    e.preventDefault();
    if (nested) {
      try { window.frameElement.src = abs; } catch (err) { /* 무시 */ }
      return;
    }
    try { window.parent.postMessage({ manna: 'navigate', url: abs }, '*'); } catch (err) { /* 무시 */ }
  });

  // 일시정지(시계)는 에이전트(agent.ts)가 맡는다
  window.__manna = { resolve: resolve, misses: misses, report: report, map: map, pages: pages, src: src, base: base };

  /* 하위 페이지 — 화면 스크립트보다 먼저 엔트리의 에이전트에 이 창을 알린다(시계 · 클릭 기록 · 단축키 · 피커가 이 안까지) */
  if (nested) {
    try {
      var hook = window.parent.__manna && window.parent.__manna.hookChild;
      if (hook) hook(window);
    } catch (e) { /* 무시 */ }
  }
})
