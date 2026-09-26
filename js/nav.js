// ═══════════════════════════════════════════════════════════
// 상단 바 — DigitalBrain 공통 .db-bar (css/db-tokens.css)
// ═══════════════════════════════════════════════════════════
// 바의 마크업(브랜드 마크 · 앱 이름 · #engine 배지 · 전체화면 버튼)은
// index.html 에 그대로 적혀 있다. 여기서는 전체화면 버튼만 살린다.
// 언어 토글(#langToggle)은 i18n.js 가 바 맨 오른쪽에 붙인다.

(function () {
  'use strict';

  var fs = document.getElementById('fsBtn');
  if (!fs || !document.documentElement.requestFullscreen) return;   // 지원하는 브라우저에서만

  fs.hidden = false;
  fs.addEventListener('click', function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(function () {});
  });
  document.addEventListener('fullscreenchange', function () {
    fs.innerHTML = document.fullscreenElement
      ? '<i class="fa-solid fa-compress"></i>'
      : '<i class="fa-solid fa-expand"></i>';
  });
})();
