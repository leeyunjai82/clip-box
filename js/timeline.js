// ═══════════════════════════════════════════════════════════
// timeline.js — 미리보기 재생 · 필름(구간 잡기) · 크롭 칸
// ═══════════════════════════════════════════════════════════
// · 좌표의 기준은 언제나 <video> 가 실제로 보여 주는 그림입니다.
//   회전 메타데이터가 붙은 폰 영상은 브라우저가 이미 돌려서 보여 주고,
//   ffmpeg 도 기본으로 같은 방향으로 돌리므로 크롭 좌표가 서로 맞습니다.
// · 크롭 값은 '영상 픽셀' 로 들고 있습니다 (화면 크기가 바뀌어도 안 흔들립니다).

window.ClipBox = window.ClipBox || {};

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };

  var FRAME = 1 / 30;    // ←/→ 한 번에 움직일 시간 (원본 fps 를 몰라 30fps 로 가정)
  var MIN = 0.1;         // 이보다 짧은 구간은 만들 수 없습니다

  var TL = {
    vid:null, duration:0, start:0, end:0, srcW:0, srcH:0,
    crop:null, cropOn:false, ratio:'free', loop:true,
    onChange:null, onTick:null, onPlayState:null,
    _raf:0, _thumbURL:null
  };

  // ── 표시용 ──
  /** 초 단위 표기. 영어에서는 s 로 나갑니다. */
  function fmtSec(sec) {
    var n = sec.toFixed(1);
    return ClipBox.i18n ? ClipBox.i18n.tf('{n}\ucd08', { n:n }) : n + '\ucd08';
  }

  function fmtTime(t) {
    if (!isFinite(t) || t < 0) t = 0;
    var m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }
  function fmtBytes(n) {
    if (!n || n < 0) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 2 : 1) + ' MB';
  }

  // ═══════════════════════════════════════════════════════════
  function init(cb) {
    TL.vid = $('vid');
    TL.onChange = cb.onChange;
    TL.onTick = cb.onTick;
    TL.onPlayState = cb.onPlayState;
    wireTrack(); wireCrop(); wirePlayback(); wireKeys();
    window.addEventListener('resize', function () { layout(); redrawThumbsSoon(); });
    return TL;
  }

  /**
   * 새 영상을 겁니다.
   * over = { srcW, srcH, duration } — 미리보기용 대역 영상을 걸 때 씁니다.
   *   (대역 영상은 작게 줄여 놓았으므로, 크롭 좌표의 기준이 되는 크기는
   *    원본에서 읽은 값으로 덮어써야 합니다)
   */
  function setVideo(url, over) {
    var v = TL.vid;
    TL._thumbURL = url;
    v.src = url;
    v.currentTime = 0;

    return new Promise(function (res, rej) {
      var timer = 0;
      function cleanup() {
        v.removeEventListener('loadeddata', ok);
        v.removeEventListener('error', no);
        clearTimeout(timer);
      }
      function ok() { cleanup(); res(); }
      function no() { cleanup(); rej(new Error('decode')); }
      // loadedmetadata 만으로는 부족합니다 — 컨테이너는 읽히는데 코덱을 못 푸는
      // 파일(아이폰 HEVC 등)이 있어서, 그림이 한 장 나오는지까지 봅니다.
      v.addEventListener('loadeddata', ok, { once:true });
      v.addEventListener('error', no, { once:true });
      timer = setTimeout(function () { cleanup(); rej(new Error('timeout')); }, 15000);
    }).then(function () {
      if (!v.videoWidth || !v.videoHeight) throw new Error('decode');
      // 일부 WebM/MOV 는 duration 이 Infinity 입니다. 한 번 흔들어 깨웁니다.
      if (!isFinite(v.duration) || v.duration <= 0) {
        return new Promise(function (res2) {
          function done() { v.removeEventListener('durationchange', done); res2(); }
          v.addEventListener('durationchange', done);
          v.currentTime = 1e7;
          setTimeout(done, 1500);
        }).then(function () { v.currentTime = 0; });
      }
    }).then(function () {
      TL.duration = isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
      TL.srcW = v.videoWidth;
      TL.srcH = v.videoHeight;
      if (over) {
        if (over.srcW > 0 && over.srcH > 0) { TL.srcW = over.srcW; TL.srcH = over.srcH; }
        if (over.duration > 0) TL.duration = over.duration;
      }
      TL.start = 0;
      TL.end = Math.min(TL.duration, 5);       // 처음엔 5초 구간을 잡아 둡니다
      TL.crop = null;
      TL.cropOn = false;
      $('cropLayer').hidden = true;
      $('videoBox').classList.add('on');
      $('stageEmpty').hidden = true;
      // 영상이 없을 때 빈 필름 캔버스가 회색 상자로 떠 보이므로 통째로 감춰 둡니다
      $('stageFoot').hidden = false;

      layout();
      buildThumbs();
      emit();
      return { duration:TL.duration, w:TL.srcW, h:TL.srcH };
    });
  }

  function clearVideo() {
    var v = TL.vid;
    v.pause();
    v.removeAttribute('src');
    v.load();
    TL.duration = 0; TL.start = 0; TL.end = 0; TL.crop = null; TL.cropOn = false;
    $('videoBox').classList.remove('on');
    $('stageEmpty').hidden = false;
    $('stageFoot').hidden = true;
    $('cropLayer').hidden = true;
  }

  function emit() { if (TL.onChange) TL.onChange(); }

  function layout() { fitVideo(); drawTrack(); drawRuler(); drawCropBox(); }

  /** <video> 를 무대에 맞춥니다 (비율 유지, 4배까지만 확대) */
  function fitVideo() {
    var stage = $('stageWrap'), box = $('videoBox');
    if (!TL.srcW || !TL.srcH || !stage) return;
    var aw = Math.max(80, stage.clientWidth - 24);
    var ah = Math.max(80, stage.clientHeight - 24);
    var k = Math.min(aw / TL.srcW, ah / TL.srcH, 4);
    var w = Math.round(TL.srcW * k), h = Math.round(TL.srcH * k);
    box.style.width = w + 'px';
    box.style.height = h + 'px';
    TL.vid.style.width = w + 'px';
    TL.vid.style.height = h + 'px';
  }

  // ── 재생 ──
  function wirePlayback() {
    var v = TL.vid;
    v.addEventListener('play', function () { if (TL.onPlayState) TL.onPlayState(true); tick(); });
    v.addEventListener('pause', function () { if (TL.onPlayState) TL.onPlayState(false); });
    v.addEventListener('ended', function () { if (TL.onPlayState) TL.onPlayState(false); });
  }

  function togglePlay() {
    var v = TL.vid;
    if (!v.src || !TL.duration) return;
    if (v.paused) {
      if (TL.loop && (v.currentTime < TL.start - 0.05 || v.currentTime >= TL.end - 0.02)) v.currentTime = TL.start;
      v.play().catch(function () {});
    } else v.pause();
  }
  function pause() { if (TL.vid) TL.vid.pause(); }
  function setLoop(on) { TL.loop = !!on; }

  function tick() {
    cancelAnimationFrame(TL._raf);
    var v = TL.vid;
    (function step() {
      if (TL.loop && TL.end > TL.start) {                    // 구간만 반복 재생
        if (v.currentTime >= TL.end - 0.01) v.currentTime = TL.start;
        else if (v.currentTime < TL.start - 0.2) v.currentTime = TL.start;
      }
      drawHead();
      if (TL.onTick) TL.onTick(v.currentTime);
      if (!v.paused) TL._raf = requestAnimationFrame(step);
    })();
  }

  function seekTo(t) {
    var v = TL.vid;
    if (!v.src || !TL.duration) return;
    v.currentTime = clamp(t, 0, Math.max(0, TL.duration - 0.001));
    drawHead();
    if (TL.onTick) TL.onTick(v.currentTime);
  }

  function setIn(t) {
    TL.start = clamp(t, 0, Math.max(0, TL.duration - MIN));
    if (TL.end < TL.start + MIN) TL.end = Math.min(TL.duration, TL.start + MIN);
    drawTrack(); emit();
  }
  function setOut(t) {
    TL.end = clamp(t, MIN, TL.duration);
    if (TL.start > TL.end - MIN) TL.start = Math.max(0, TL.end - MIN);
    drawTrack(); emit();
  }
  function setRange(a, b, seek) {
    TL.start = clamp(Math.min(a, b), 0, TL.duration);
    TL.end = clamp(Math.max(a, b), 0, TL.duration);
    if (TL.end - TL.start < MIN) TL.end = Math.min(TL.duration, TL.start + MIN);
    drawTrack(); emit();
    if (seek !== false) seekTo(TL.start);
  }

  // ── 필름 ──
  function trackRect() { return $('tlTrack').getBoundingClientRect(); }
  function xToT(x) {
    var r = trackRect();
    return clamp((x - r.left) / Math.max(1, r.width), 0, 1) * TL.duration;
  }
  function tToPct(t) { return TL.duration > 0 ? clamp(t / TL.duration, 0, 1) * 100 : 0; }

  function drawTrack() {
    if (!TL.duration) return;
    var a = tToPct(TL.start), b = tToPct(TL.end);
    $('tlDimA').style.left = '0%'; $('tlDimA').style.width = a + '%';
    $('tlDimB').style.left = b + '%'; $('tlDimB').style.width = (100 - b) + '%';
    $('tlSel').style.left = a + '%'; $('tlSel').style.width = (b - a) + '%';
    $('tlIn').style.left = a + '%';
    $('tlOut').style.left = b + '%';
    // 구간이 너무 좁으면 글자가 손잡이를 덮으므로 숨깁니다
    var len = $('tlLen');
    if (len) {
      var wide = (b - a) >= 9;
      len.hidden = !wide;
      if (wide) len.textContent = fmtSec(TL.end - TL.start);
    }
    drawHead();
  }
  function drawHead() {
    if (!TL.duration) return;
    $('tlHead').style.left = tToPct(TL.vid.currentTime) + '%';
  }

  /** 시간 눈금 — 어디가 몇 초인지 보여야 구간을 잡을 수 있습니다 */
  function drawRuler() {
    var el = $('tlRuler');
    el.innerHTML = '';
    if (!TL.duration) return;
    var W = Math.max(1, $('tlTrack').clientWidth);
    var raw = TL.duration / Math.max(2, Math.floor(W / 66));   // 66px 에 눈금 하나쯤
    var STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    var step = null;
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i] >= raw) { step = STEPS[i]; break; }
    if (!step) step = Math.ceil(raw / 600) * 600;

    for (var t = 0; t <= TL.duration + 1e-6; t += step) {
      var d = document.createElement('span');
      d.className = 'tk';
      var pct = t / TL.duration;
      if (pct < 0.02) d.className += ' edge';
      else if (pct > 0.98) d.className += ' edge r';
      d.style.left = (pct * 100) + '%';
      d.textContent = step < 1 ? t.toFixed(1) + 's' : fmtTime(t);
      el.appendChild(d);
    }
  }

  function wireTrack() {
    var track = $('tlTrack'), sel = $('tlSel'), tip = $('tlTip');
    var mode = null, grab = null;

    function down(e, m) {
      if (!TL.duration) return;
      mode = m;
      e.preventDefault();
      if (e.target.setPointerCapture) e.target.setPointerCapture(e.pointerId);
      if (m === 'move') {
        grab = { at:xToT(e.clientX), start:TL.start, end:TL.end, x0:e.clientX, moved:false };
        sel.classList.add('moving');
      } else move(e);
    }

    function move(e) {
      if (!mode) return;
      var t = xToT(e.clientX);
      if (mode === 'in') { TL.start = clamp(t, 0, TL.end - MIN); seekTo(TL.start); }
      else if (mode === 'out') { TL.end = clamp(t, TL.start + MIN, TL.duration); seekTo(TL.end); }
      else if (mode === 'move') {
        if (Math.abs(e.clientX - grab.x0) < 3 && !grab.moved) return;   // 아직 '클릭' 입니다
        grab.moved = true;
        var len = grab.end - grab.start;                                // 길이는 그대로 두고 통째로 밉니다
        var s = clamp(grab.start + (t - grab.at), 0, Math.max(0, TL.duration - len));
        TL.start = s; TL.end = s + len;
        seekTo(TL.start);
      } else seekTo(t);
      drawTrack();
      if (mode !== 'scrub') emit();
    }

    function up(e) {
      if (!mode) return;
      // 구간 안을 끌지 않고 톡 눌렀으면 그 자리로 이동만 합니다 (미리보기용)
      if (mode === 'move' && grab && !grab.moved && e) seekTo(xToT(e.clientX));
      mode = null; grab = null;
      sel.classList.remove('moving');
      emit();
    }

    $('tlIn').addEventListener('pointerdown', function (e) { e.stopPropagation(); down(e, 'in'); });
    $('tlOut').addEventListener('pointerdown', function (e) { e.stopPropagation(); down(e, 'out'); });
    sel.addEventListener('pointerdown', function (e) { e.stopPropagation(); down(e, 'move'); });
    track.addEventListener('pointerdown', function (e) { down(e, 'scrub'); });
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);

    track.addEventListener('pointermove', function (e) {          // 가리키는 곳이 몇 초인지
      if (!TL.duration) return;
      var pr = $('timeline').getBoundingClientRect();
      tip.hidden = false;
      tip.textContent = fmtTime(xToT(e.clientX));
      tip.style.left = clamp(e.clientX - pr.left, 26, pr.width - 26) + 'px';
    });
    track.addEventListener('pointerleave', function () { if (!mode) tip.hidden = true; });
  }

  // ── 필름 썸네일 ──
  // 영상이나 창 크기가 바뀌면 다시 그립니다. 앞서 돌던 그리기는
  // 세대 번호가 달라지는 순간 스스로 멈춥니다.
  var thumbGen = 0, redrawTimer = 0;

  function buildThumbs() {
    var myGen = ++thumbGen;
    var cv = $('tlThumbs'), track = $('tlTrack');
    var W = Math.max(40, Math.round(track.clientWidth)), H = 40;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    var ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    if (!TL.duration || !TL._thumbURL) return Promise.resolve();

    var n = clamp(Math.round(W / 60), 5, 24), tw = W / n;
    var v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.src = TL._thumbURL;

    return new Promise(function (res, rej) {
      v.addEventListener('loadeddata', res, { once:true });
      v.addEventListener('error', rej, { once:true });
      setTimeout(rej, 10000);
    }).then(function () {
      if (myGen !== thumbGen) return;
      var sw = v.videoWidth, sh = v.videoHeight;
      if (!sw || !sh) return;
      var k = Math.max(tw / sw, H / sh);                    // 가운데를 잘라 칸을 채웁니다
      var cw = tw / k, ch = H / k, cx = (sw - cw) / 2, cy = (sh - ch) / 2;

      return (function one(i) {
        if (i >= n || myGen !== thumbGen) return;
        var t = TL.duration * (i + 0.5) / n;
        return new Promise(function (res2) {
          function done() { v.removeEventListener('seeked', done); res2(); }
          v.addEventListener('seeked', done, { once:true });
          setTimeout(done, 1500);
          v.currentTime = Math.min(t, Math.max(0, TL.duration - 0.05));
        }).then(function () {
          try { ctx.drawImage(v, cx, cy, cw, ch, i * tw, 0, tw + 0.5, H); } catch (e) {}
          return one(i + 1);
        });
      })(0);
    }).catch(function () {}).then(function () {
      v.removeAttribute('src'); v.load();
    });
  }

  function redrawThumbsSoon() {
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(function () { if (TL.duration) buildThumbs(); }, 280);
  }

  // ── 크롭 칸 ──
  function setCropEnabled(on) {
    TL.cropOn = !!on;
    $('cropLayer').hidden = !TL.cropOn;
    if (TL.cropOn && !TL.crop) defaultCrop();
    layout();
    emit();
  }
  /** 칸을 기본 자리(가운데)로 되돌립니다. 칸을 아예 없애는 것은 setCropEnabled(false) 입니다. */
  function centerCrop() { TL.crop = null; defaultCrop(); drawCropBox(); emit(); }

  function setRatio(r) {
    TL.ratio = r;
    if (TL.crop && r !== 'free') {
      var ratio = parseFloat(r), w = TL.crop.w, h = w / ratio;
      if (h > TL.srcH) { h = TL.srcH; w = h * ratio; }
      if (w > TL.srcW) { w = TL.srcW; h = w / ratio; }
      TL.crop.w = w; TL.crop.h = h;
      TL.crop.x = clamp(TL.crop.x, 0, TL.srcW - w);
      TL.crop.y = clamp(TL.crop.y, 0, TL.srcH - h);
      drawCropBox(); emit();
    }
  }

  function defaultCrop() {
    if (!TL.srcW) return;
    var r = TL.ratio === 'free' ? null : parseFloat(TL.ratio), w, h;
    if (r) { w = Math.min(TL.srcW, TL.srcH * r); h = w / r; }
    else { w = TL.srcW * 0.7; h = TL.srcH * 0.7; }
    TL.crop = { x:(TL.srcW - w) / 2, y:(TL.srcH - h) / 2, w:w, h:h };
  }

  function scaleFactor() {
    var box = $('videoBox');
    return TL.srcW > 0 ? box.clientWidth / TL.srcW : 1;
  }

  function drawCropBox() {
    var box = $('cropBox');
    if (!TL.crop || !TL.srcW) { box.hidden = true; return; }
    var k = scaleFactor();
    box.hidden = false;
    box.style.left = (TL.crop.x * k) + 'px';
    box.style.top = (TL.crop.y * k) + 'px';
    box.style.width = (TL.crop.w * k) + 'px';
    box.style.height = (TL.crop.h * k) + 'px';
    $('cropSize').textContent = Math.round(TL.crop.w) + ' × ' + Math.round(TL.crop.h);
  }

  function wireCrop() {
    var layer = $('cropLayer'), box = $('cropBox'), drag = null;

    function toVid(e) {
      var r = layer.getBoundingClientRect(), k = scaleFactor();
      return { x:clamp((e.clientX - r.left) / k, 0, TL.srcW), y:clamp((e.clientY - r.top) / k, 0, TL.srcH) };
    }
    function startDrag(e, kind) {
      if (!TL.srcW) return;
      e.preventDefault(); e.stopPropagation();
      if (layer.setPointerCapture) layer.setPointerCapture(e.pointerId);
      drag = { kind:kind, from:toVid(e), orig:TL.crop ? JSON.parse(JSON.stringify(TL.crop)) : null };
      if (kind === 'new') {
        TL.crop = { x:drag.from.x, y:drag.from.y, w:1, h:1 };
        drag.orig = JSON.parse(JSON.stringify(TL.crop));
      }
    }

    box.addEventListener('pointerdown', function (e) { startDrag(e, 'move'); });
    Array.prototype.forEach.call(box.querySelectorAll('.ch'), function (h) {
      var kind = Array.prototype.filter.call(h.classList, function (c) { return c !== 'ch'; })[0];
      h.addEventListener('pointerdown', function (e) { startDrag(e, kind); });
    });
    layer.addEventListener('pointerdown', function (e) { if (e.target === layer) startDrag(e, 'new'); });

    window.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var p = toVid(e), o = drag.orig;
      var r = TL.ratio === 'free' ? null : parseFloat(TL.ratio);

      if (drag.kind === 'move') {
        TL.crop.x = clamp(o.x + (p.x - drag.from.x), 0, TL.srcW - o.w);
        TL.crop.y = clamp(o.y + (p.y - drag.from.y), 0, TL.srcH - o.h);
      } else if (drag.kind === 'new') {
        var x1 = Math.min(drag.from.x, p.x), y1 = Math.min(drag.from.y, p.y);
        var w = Math.abs(p.x - drag.from.x), h = Math.abs(p.y - drag.from.y);
        if (r) { h = w / r; if (y1 + h > TL.srcH) { h = TL.srcH - y1; w = h * r; } }
        TL.crop = { x:x1, y:y1, w:Math.max(8, w), h:Math.max(8, h) };
      } else {
        var x = o.x, y = o.y, cw = o.w, chh = o.h, k = drag.kind;
        if (k.indexOf('w') >= 0) { var nx = clamp(p.x, 0, x + cw - 8); cw = x + cw - nx; x = nx; }
        if (k.indexOf('e') >= 0) { cw = clamp(p.x - x, 8, TL.srcW - x); }
        if (k.indexOf('n') >= 0) { var ny = clamp(p.y, 0, y + chh - 8); chh = y + chh - ny; y = ny; }
        if (k.indexOf('s') >= 0) { chh = clamp(p.y - y, 8, TL.srcH - y); }
        if (r) {
          // 비율 고정 — 위·아래 변만 잡았으면 가로를 맞추고, 아니면 세로를 맞춥니다
          if (k === 'n' || k === 's') { var nw = chh * r; x = clamp(x + (cw - nw) / 2, 0, Math.max(0, TL.srcW - nw)); cw = nw; }
          else { var nh = cw / r; if (k.indexOf('n') >= 0) y = y + chh - nh; chh = nh; }
          if (y < 0) y = 0;
          if (y + chh > TL.srcH) { chh = TL.srcH - y; cw = chh * r; }
          if (x + cw > TL.srcW) { cw = TL.srcW - x; chh = cw / r; }
        }
        TL.crop = { x:x, y:y, w:Math.max(8, cw), h:Math.max(8, chh) };
      }
      drawCropBox();
    });

    function end() { if (drag) { drag = null; drawCropBox(); emit(); } }
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  /** 굽기에 넘길 크롭 값 (짝수로 맞춘 정수). 원본 그대로면 null. */
  function cropForEncode() {
    if (!TL.cropOn || !TL.crop) return null;
    var c = TL.crop;
    var w = Math.max(2, 2 * Math.round(Math.min(c.w, TL.srcW - c.x) / 2));
    var h = Math.max(2, 2 * Math.round(Math.min(c.h, TL.srcH - c.y) / 2));
    var x = clamp(Math.round(c.x), 0, TL.srcW - w);
    var y = clamp(Math.round(c.y), 0, TL.srcH - h);
    if (x === 0 && y === 0 && w === TL.srcW && h === TL.srcH) return null;
    return { x:x, y:y, w:w, h:h };
  }

  function applyCrop(crop) {
    TL.crop = crop ? JSON.parse(JSON.stringify(crop)) : null;
    setCropEnabled(!!crop);
  }

  // ── 단축키 ──
  function wireKeys() {
    window.addEventListener('keydown', function (e) {
      var el = e.target;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      if (e.metaKey || e.ctrlKey || e.altKey || !TL.duration) return;
      var k = e.key.toLowerCase();
      if (k === 'i') { setIn(TL.vid.currentTime); e.preventDefault(); }
      else if (k === 'o') { setOut(TL.vid.currentTime); e.preventDefault(); }
      else if (e.key === ' ') { togglePlay(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { TL.vid.pause(); seekTo(TL.vid.currentTime - (e.shiftKey ? 1 : FRAME)); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { TL.vid.pause(); seekTo(TL.vid.currentTime + (e.shiftKey ? 1 : FRAME)); e.preventDefault(); }
      else if (e.key === 'Home') { seekTo(TL.start); e.preventDefault(); }
      else if (e.key === 'End') { seekTo(TL.end); e.preventDefault(); }
    });
  }

  /** 목록에 붙일 작은 썸네일 (정사각 cover, data URL) */
  function grabThumb(size) {
    var v = TL.vid;
    if (!v || !v.src || !v.videoWidth) return null;
    var n = size || 42;
    var cv = document.createElement('canvas');
    cv.width = n; cv.height = n;
    var side = Math.min(v.videoWidth, v.videoHeight);
    try {
      cv.getContext('2d').drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2,
        side, side, 0, 0, n, n);
      return cv.toDataURL('image/jpeg', 0.7);
    } catch (e) { return null; }
  }

  /** 지금 프레임을 캔버스로 (한 장 저장용) */
  function grabStill() {
    var v = TL.vid;
    if (!v.src || !TL.srcW) return null;
    var c = cropForEncode();
    var kx = v.videoWidth / TL.srcW, ky = v.videoHeight / TL.srcH;
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round((c ? c.w : TL.srcW) * kx));
    cv.height = Math.max(1, Math.round((c ? c.h : TL.srcH) * ky));
    var ctx = cv.getContext('2d');
    if (c) ctx.drawImage(v, c.x * kx, c.y * ky, c.w * kx, c.h * ky, 0, 0, cv.width, cv.height);
    else ctx.drawImage(v, 0, 0, cv.width, cv.height);
    return cv;
  }

  ClipBox.tl = {
    TL: TL, init: init, setVideo: setVideo, clearVideo: clearVideo, layout: layout,
    togglePlay: togglePlay, pause: pause, setLoop: setLoop, seekTo: seekTo,
    setIn: setIn, setOut: setOut, setRange: setRange,
    setCropEnabled: setCropEnabled, centerCrop: centerCrop, setRatio: setRatio,
    cropForEncode: cropForEncode, applyCrop: applyCrop,
    grabThumb: grabThumb, grabStill: grabStill,
    fmtTime: fmtTime, fmtSec: fmtSec, fmtBytes: fmtBytes, redrawThumbsSoon: redrawThumbsSoon
  };
})();
