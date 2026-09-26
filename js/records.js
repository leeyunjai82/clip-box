// ═══════════════════════════════════════════════════════════
// 이 기기에 남기는 기록 — 이름 옮기기 · 전체 삭제
// ═══════════════════════════════════════════════════════════
// dibrain.dev 는 모든 앱이 같은 출처(origin)를 쓴다. localStorage·Cache 가 한 통에
// 들어 있으므로 이 앱이 쓰는 것은 전부 'clip-box' 로 시작한다
// (블로그 저장소 brand/README.md "기록 전체 삭제").
//
//  localStorage   clip-box:settings        내보내기 설정·프리셋 (presets.js)
//                 clip-box:language        언어 (i18n.js)
//  Cache          clip-box-core-<버전>      내려받아 둔 영상 엔진 ffmpeg 코어 약 32MB (ffmpeg.js)
//  영상 자체는 어디에도 저장하지 않는다.
//
// 이 파일은 i18n.js · presets.js 보다 먼저 읽혀서, 옛 이름을 먼저 옮겨 둔다.

window.ClipBox = window.ClipBox || {};

(function () {
  'use strict';

  var NS = 'clip-box:';
  var CACHE_PREFIX = 'clip-box-';
  var OLD_CACHE_PREFIX = 'clipbox-';     // 예전 코어 캐시 이름. 이 앱만 쓰던 것

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function del(k) { try { localStorage.removeItem(k); } catch (e) {} }

  // ── 옛 이름 → 새 이름 (한 번만) ──
  // 'clipbox.settings' 는 이 앱만 쓰던 키라 옮기고 지운다.
  if (get('clipbox.settings') !== null) {
    if (get(NS + 'settings') === null) set(NS + 'settings', get('clipbox.settings'));
    del('clipbox.settings');
  }
  // 'language' 는 스냅박스도 같이 읽던 공용 키다. 우리 몫만 복사해 두고 옛 키는 남긴다 —
  // 스냅박스가 자기 몫을 옮겨 갈 때까지 필요하다. 스냅박스도 이미 옮겼으면(snap-box:language)
  // 더 쓸 앱이 없으므로 그때 지운다. (스냅박스 js/records.js 도 같은 규칙)
  if (get('language') !== null) {
    if (get(NS + 'language') === null) set(NS + 'language', get('language'));
    if (get('snap-box:language') !== null) del('language');
  }
  // 예전 이름의 코어 캐시는 새 이름으로 다시 받으므로 지운다(32MB 를 두 벌 두지 않게).
  function cacheNames(prefix) {
    if (!window.caches) return Promise.resolve([]);
    return caches.keys().then(function (l) {
      return l.filter(function (n) { return n.indexOf(prefix) === 0; });
    }).catch(function () { return []; });
  }
  cacheNames(OLD_CACHE_PREFIX).then(function (l) {
    l.forEach(function (n) { caches.delete(n).catch(function () {}); });
  });

  // ── 전체 삭제 ──
  function clearAll() {
    var keys = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && (k.indexOf(NS) === 0 || k === 'clipbox.settings')) keys.push(k);
      }
    } catch (e) {}
    keys.forEach(del);
    // 공용 'language' 는 지우지 않는다(스냅박스 몫). 다만 스냅박스가 이미 옮겼다면
    // 아무도 안 쓰는 키라 지운다 — 남겨 두면 새로고침 때 우리 언어로 다시 복사된다.
    if (get('snap-box:language') !== null) del('language');
    return Promise.all([cacheNames(CACHE_PREFIX), cacheNames(OLD_CACHE_PREFIX)]).then(function (r) {
      return Promise.all(r[0].concat(r[1]).map(function (n) { return caches.delete(n).catch(function () {}); }));
    });
  }

  ClipBox.records = { clearAll: clearAll };

  // ── 맨 아래 줄의 버튼 (#dbReset) ──
  function wire() {
    var b = document.getElementById('dbReset');
    if (!b) return;
    var T = function (s) { return typeof GL_T === 'function' ? GL_T(s) : s; };
    b.addEventListener('click', function () {
      if (!confirm(T('이 앱에 저장된 기록을 모두 지웁니다(설정·프리셋·언어, 내려받아 둔 영상 엔진 — 다시 열면 32MB를 새로 받습니다). 되돌릴 수 없습니다. 계속할까요?'))) return;
      b.disabled = true;
      clearAll().catch(function () {}).then(function () { location.reload(); });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
