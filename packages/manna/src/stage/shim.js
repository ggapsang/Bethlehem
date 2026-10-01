/* 품은 화면 안에서 가장 먼저 실행되는 shim — docs/ARCHITECTURE.md §5.2, §5.4
 * 이 파일은 번들되지 않고 문자열 그대로(?raw) iframe <head> 맨 앞에 들어간다.
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

  /* ── 일시정지 (§5.4) — rAF 보류, 시계 정지, CSS 애니메이션 정지 ───────────────── */
  var perf = window.performance;
  var nativeNow = perf.now.bind(perf);
  var nativeDateNow = Date.now;
  var nativeRaf = window.requestAnimationFrame.bind(window);
  var nativeCaf = window.cancelAnimationFrame.bind(window);
  var paused = false;
  var pausedAt = 0;
  var offset = 0;
  var seq = 0;
  var pending = {};
  var held = [];
  var frozen = [];

  perf.now = function () { return (paused ? pausedAt : nativeNow()) - offset; };
  Date.now = function () { return nativeDateNow() - offset - (paused ? nativeNow() - pausedAt : 0); };

  function schedule(id, cb) {
    pending[id] = nativeRaf(function (ts) {
      delete pending[id];
      if (paused) { held.push([id, cb]); return; }
      cb(ts - offset);
    });
  }
  window.requestAnimationFrame = function (cb) {
    var id = ++seq;
    if (paused) held.push([id, cb]);
    else schedule(id, cb);
    return id;
  };
  window.cancelAnimationFrame = function (id) {
    if (pending[id] != null) { nativeCaf(pending[id]); delete pending[id]; }
    for (var i = 0; i < held.length; i++) if (held[i][0] === id) { held.splice(i, 1); break; }
  };

  function pause() {
    if (paused) return;
    paused = true;
    pausedAt = nativeNow();
    frozen = [];
    if (document.getAnimations) {
      document.getAnimations().forEach(function (a) {
        if (a.playState === 'running') { a.pause(); frozen.push(a); }
      });
    }
  }
  function resume() {
    if (!paused) return;
    offset += nativeNow() - pausedAt;
    paused = false;
    var h = held;
    held = [];
    h.forEach(function (x) { schedule(x[0], x[1]); });
    frozen.forEach(function (a) { try { a.play(); } catch (e) { /* 이미 끝난 애니메이션 */ } });
    frozen = [];
  }

  Object.defineProperty(window, '__manna', {
    value: {
      resolve: resolve,
      misses: misses,
      pause: pause,
      resume: resume,
      isPaused: function () { return paused; },
    },
  });
})
