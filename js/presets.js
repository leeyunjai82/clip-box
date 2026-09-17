// ═══════════════════════════════════════════════════════════
// presets.js — 출력 프리셋 · 예상 용량 · 목표 용량 맞추기
// ═══════════════════════════════════════════════════════════
// design/README.md §6: classic script + 전역 네임스페이스(window.ClipBox).
// 저장 키는 `clipbox.settings` 하나. 영상 데이터는 어떤 형태로도 저장하지 않는다.

window.ClipBox = window.ClipBox || {};

(function () {
  'use strict';

  var LS = 'clipbox.settings';

  // ── 포맷별 성질 ──
  var FORMATS = {
    gif:  { ext:'gif',  mime:'image/gif',  label:'GIF',
            twoPass:true,  hasColors:true,  hasDither:true,  hasQuality:false, hasCrf:false },
    webp: { ext:'webp', mime:'image/webp', label:'WebP',
            twoPass:false, hasColors:false, hasDither:false, hasQuality:true,  hasCrf:false },
    mp4:  { ext:'mp4',  mime:'video/mp4',  label:'MP4',
            twoPass:false, hasColors:false, hasDither:false, hasQuality:false, hasCrf:true }
  };

  var DITHERS = ['sierra2_4a', 'bayer', 'floyd_steinberg', 'sierra2', 'none'];

  var SPEEDS = [0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4];

  // ── 기본 프리셋 ──
  // 이름은 한/영 두 벌. 사용자가 값을 고쳐 저장해도 이름은 그대로 둔다.
  var BUILTIN = [
    { id:'readme', name:{ko:'README', en:'README'},   format:'gif',
      width:480, fps:10, colors:128, dither:'sierra2_4a', quality:75, crf:23, maxBytes:0 },
    { id:'manual', name:{ko:'매뉴얼', en:'Manual'},    format:'webp',
      width:640, fps:12, colors:128, dither:'sierra2_4a', quality:75, crf:23, maxBytes:0 },
    { id:'sns',    name:{ko:'SNS',    en:'Social'},    format:'mp4',
      width:720, fps:15, colors:128, dither:'sierra2_4a', quality:75, crf:23, maxBytes:0 },
    { id:'katalk', name:{ko:'메신저', en:'Messenger'}, format:'gif',
      width:360, fps:10, colors:64,  dither:'bayer',      quality:75, crf:23, maxBytes:5*1024*1024 }
  ];

  var DEFAULTS = {
    presetId:'readme', presets:null,
    fitToSize:false, targetMB:5,
    rotate:'auto', fade:0,
    textPos:'bottom-left', textSize:24, textPad:16,
    logoPos:'bottom-right', logoScale:18, logoPad:16
  };

  function load() {
    var s = {}, k;
    for (k in DEFAULTS) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) s[k] = DEFAULTS[k];
    try {
      var raw = JSON.parse(localStorage.getItem(LS) || 'null');
      if (raw && typeof raw === 'object') {
        for (k in raw) if (Object.prototype.hasOwnProperty.call(s, k)) s[k] = raw[k];
      }
    } catch (e) {}
    s.presets = mergePresets(s.presets);
    return s;
  }

  function save(s) {
    try { localStorage.setItem(LS, JSON.stringify(s)); } catch (e) {}
  }

  // 저장본이 오래돼 항목이 빠져 있어도 기본값으로 메운다.
  // 이름은 저장본을 믿지 않는다 — 언어가 바뀌면 기본값 쪽이 맞다.
  function mergePresets(saved) {
    return BUILTIN.map(function (base) {
      var hit = Array.isArray(saved) ? saved.filter(function (x) { return x && x.id === base.id; })[0] : null;
      var out = {}, k;
      for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
      if (hit) for (k in hit) if (Object.prototype.hasOwnProperty.call(out, k) && k !== 'id' && k !== 'name') out[k] = hit[k];
      return out;
    });
  }

  function resetPresets() { return mergePresets(null); }

  function presetName(p, lang) {
    if (!p || !p.name) return '';
    if (typeof p.name === 'string') return p.name;
    return p.name[lang] || p.name.ko;
  }

  /** 프리셋 설명 — 지금 값에서 만든다. 기호만 써서 한·영 공통으로 읽힌다. */
  function describe(p) {
    var f = FORMATS[p.format];
    return p.width + 'px · ' + p.fps + 'fps · ' + f.label +
      (p.maxBytes ? ' · ≤' + Math.round(p.maxBytes / 1024 / 1024) + 'MB' : '');
  }

  // ═══════════════════════════════════════════════════════════
  // 예상 용량 — 어림값
  // ═══════════════════════════════════════════════════════════
  // 아래 상수는 testsrc2(잡음이 많아 거의 최악인 영상)로 실제 구워서 맞췄다.
  // 화면 녹화처럼 색이 단순한 영상은 이보다 훨씬 작게 나오므로 '≈' 를 붙여 보여 준다.
  var BPP = { gif:0.125, webp:0.041, mp4:0.018 };   // 프레임당 픽셀 한 개의 바이트

  function estimateBytes(o) {
    var f = FORMATS[o.format];
    if (!f || !o.width || !o.height || !o.fps || !o.seconds) return 0;
    var frames = Math.max(1, Math.round(o.fps * o.seconds * (o.pingpong ? 2 : 1)));
    var bpp = BPP[o.format];

    if (o.format === 'gif') {
      var c = Math.max(2, o.colors || 128);
      bpp *= Math.log(c) / Math.log(128);
    } else if (o.format === 'webp') {
      var q = Math.min(100, Math.max(1, o.quality || 75));
      bpp *= Math.pow(q / 75, 1.6);
    } else {
      var v = Math.min(51, Math.max(0, o.crf == null ? 23 : o.crf));
      bpp *= Math.pow(2, (23 - v) / 6);     // CRF 6마다 비트레이트가 대략 두 배
    }
    return Math.round(frames * o.width * o.height * bpp + (o.format === 'mp4' ? 8192 : 2048));
  }

  /** 목표 용량을 넘었을 때 다음 시도의 설정값. 프레임 → 해상도 → 색 수 순. */
  function nextAttempt(cur, actualBytes, targetBytes) {
    var over = actualBytes / targetBytes;
    if (over <= 1) return null;
    var next = {}, k;
    for (k in cur) if (Object.prototype.hasOwnProperty.call(cur, k)) next[k] = cur[k];

    var left = over;
    if (next.fps > 6) {                                   // 6fps 아래로는 내리지 않는다
      var want = Math.max(6, Math.round(next.fps / Math.min(left, 1.7)));
      left *= want / next.fps;
      next.fps = want;
    }
    if (left > 1 && next.width > 240) {                   // 240px 아래로는 내리지 않는다
      var w = Math.max(240, 2 * Math.round((next.width / Math.sqrt(left)) / 2));
      left *= (w * w) / (next.width * next.width);
      next.width = w;
    }
    if (left > 1 && next.format === 'gif' && next.colors > 32) {
      next.colors = next.colors > 64 ? 64 : 32;
      left *= 0.8;
    }
    if (left > 1 && next.format === 'webp' && next.quality > 40) {
      next.quality = Math.max(40, Math.round(next.quality * 0.75));
    }
    if (left > 1 && next.format === 'mp4' && next.crf < 34) {
      next.crf = Math.min(34, next.crf + 4);
    }

    var same = next.fps === cur.fps && next.width === cur.width && next.colors === cur.colors
      && next.quality === cur.quality && next.crf === cur.crf;
    return same ? null : next;
  }

  ClipBox.presets = {
    FORMATS: FORMATS, DITHERS: DITHERS, SPEEDS: SPEEDS, BUILTIN: BUILTIN,
    load: load, save: save, resetPresets: resetPresets,
    presetName: presetName, describe: describe,
    estimateBytes: estimateBytes, nextAttempt: nextAttempt
  };
})();
