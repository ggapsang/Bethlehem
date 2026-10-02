/* 품은 화면 안에서 가장 먼저 실행되는 shim — docs/ARCHITECTURE.md §5.2, §5.4
 * 이 파일은 번들되지 않고 문자열 그대로(?raw) iframe <head> 맨 앞에 들어간다. 바로 뒤에 에이전트가 이어진다.
 * 함수 하나로 끝나야 하며 바깥 변수에 의존하지 않는다.
 *   map  : 가상 절대 URL → Blob URL
 *   base : 엔트리 문서의 가상 URL (https://pkg.manna/index.html)
 */
(function (map, base) {
  'use strict';
  var PKG = 'https://pkg.manna/';
  var PASS = /^(blob:|data:|javascript:|about:|mailto:|tel:|#)/i;
  var misses = [];
  var seenMiss = {};

  function resolve(ref) {
    if (ref == null) return ref;
    var s = String(ref);
    if (!s || PASS.test(s)) return ref;
    var abs;
    try { abs = new URL(s, base).href; } catch (e) { return ref; }
    var noHash = abs.split('#')[0];
    var hit = map[abs] || map[noHash] || map[noHash.split('?')[0]];
    if (hit) return hit;
    if (abs.indexOf(PKG) === 0 && !seenMiss[abs]) {
      seenMiss[abs] = 1;
      misses.push({ url: decodeURIComponent(abs.slice(PKG.length)), at: Date.now() });
      try { window.parent.postMessage({ manna: 'miss', url: abs }, '*'); } catch (e) { /* 무시 */ }
    }
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

  var URL_ATTR = { src: 1, href: 1, poster: 1 };
  var URL_TAGS = { SCRIPT: 1, IMG: 1, SOURCE: 1, VIDEO: 1, AUDIO: 1, LINK: 1, TRACK: 1, EMBED: 1 };
  var setAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    var n = String(name).toLowerCase();
    if (URL_ATTR[n] && URL_TAGS[this.tagName]) value = resolve(value);
    return setAttr.call(this, name, value);
  };

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

  /* 패키지 안 다른 페이지로 가는 링크 — srcdoc 에서는 그대로 따라가면 깨진다. 부모에게 그 페이지를 열어 달라고 한다.
     화면 스크립트가 먼저 처리(preventDefault)한 클릭은 건드리지 않는다. */
  window.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || (a.target && a.target !== '_self')) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#') return;
    var abs;
    try { abs = new URL(href, base).href; } catch (err) { return; }
    var pagePath = abs.split('#')[0].split('?')[0];
    if (pagePath.indexOf(PKG) !== 0 || !/\.html?$/i.test(pagePath) || !map[pagePath]) return;
    e.preventDefault();
    try { window.parent.postMessage({ manna: 'navigate', url: abs }, '*'); } catch (err) { /* 무시 */ }
  });

  // 일시정지(시계)는 에이전트(agent.ts)가 맡는다
  window.__manna = { resolve: resolve, misses: misses };
})
