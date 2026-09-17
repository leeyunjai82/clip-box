// ═══════════════════════════════════════════════════════════
// app.js — 상태 · 영상 불러오기 · 클립 목록 · 작업 탭 · 굽기
// ═══════════════════════════════════════════════════════════
// 1원칙 (design/README.md §7): 영상은 브라우저 밖으로 나가지 않습니다.
// 이 파일에는 바깥을 부르는 코드가 한 줄도 없습니다
// (vendor/ 아래 코어·글꼴만 같은 출처에서 읽습니다).
//
// 화면 규약: 알림은 toast / busy / .prg 셋뿐이고, 되돌릴 수 없는 동작만
// confirm() 으로 한 번 묻습니다.

window.ClipBox = window.ClipBox || {};

(function () {
  'use strict';

  var P = ClipBox.presets;
  var F = ClipBox.ff;
  var TLM = ClipBox.tl;
  var TL = TLM.TL;
  var T = function (s) { return ClipBox.i18n ? ClipBox.i18n.t(s) : s; };
  var TF = function (s, v) { return ClipBox.i18n ? ClipBox.i18n.tf(s, v) : s; };

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var fmtTime = TLM.fmtTime, fmtBytes = TLM.fmtBytes;

  var BIG_FILE = 300 * 1024 * 1024;
  var MAX_TRIES = 3;
  var SPEEDS = P.SPEEDS;

  var S = {
    file:null, url:null, proxyURL:null, usingProxy:false,
    baseName:'clip', inName:'in.mp4', inputWritten:false,
    st:P.load(), cur:null,
    clips:[], activeClip:null, seq:0,
    busy:false, cancelled:false, results:[],
    logo:null, logoURL:null, coreReady:false, step:'range'
  };

  // ═══════════════════════════════════════════════════════════
  // 알림 · 진행률
  // ═══════════════════════════════════════════════════════════
  var toastTimer = 0;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('on'); }, 2600);
  }

  function busy(on, text, sub) {
    $('#busy').hidden = !on;
    if (!on) return;
    $('#busyText').textContent = text || T('처리하는 중입니다');
    $('#busySub').textContent = sub || '';
  }

  var runStartedAt = 0;
  function progress(ratio, label) {
    var w = $('#progressWrap');
    if (ratio == null) { w.hidden = true; return; }
    w.hidden = false;
    var r = Math.max(0, Math.min(1, ratio));
    $('#progressFill').style.width = (r * 100).toFixed(1) + '%';
    $('#progressText').textContent = label || '';
    // 지금까지 걸린 시간으로 남은 시간을 어림잡습니다 (5% 는 지나야 쓸 만합니다)
    var pct = Math.round(r * 100) + '%';
    if (runStartedAt && r > 0.05 && r < 0.995) {
      var spent = (Date.now() - runStartedAt) / 1000;
      var left = Math.round(spent * (1 - r) / r);
      if (left >= 1 && left < 3600) pct += ' · ' + TF('{s}초쯤 남았습니다', { s:left });
    }
    $('#progressPct').textContent = pct;
  }

  // ═══════════════════════════════════════════════════════════
  // 시작
  // ═══════════════════════════════════════════════════════════
  function boot() {
    S.cur = pickCur(S.st.presetId);

    TLM.init({ onChange:onRangeChange, onTick:onTick, onPlayState:onPlayState });
    buildDither();
    buildPresetPick();
    wireTabs();
    wireFile();
    wireRangeTool();
    wireTrimTool();
    wireSizeTool();
    wireOutTool();
    wireBar();

    applyUI();
    refreshEnabled();
    window.addEventListener('resize', TLM.layout);
    window.addEventListener('beforeunload', function (e) {
      if (S.busy) { e.preventDefault(); e.returnValue = ''; }
    });

    loadCore();
  }

  function pickCur(id) {
    var p = null;
    S.st.presets.forEach(function (x) { if (x.id === id) p = x; });
    if (!p) p = S.st.presets[0];
    var out = {}, k;
    for (k in p) if (Object.prototype.hasOwnProperty.call(p, k)) out[k] = p[k];
    if (out.speedIdx == null) out.speedIdx = SPEEDS.indexOf(1);
    if (!out.loop) out.loop = 'normal';
    return out;
  }

  function loadCore() {
    var badge = $('#coreState');
    var engine = document.getElementById('engine');
    var MB = function (n) { return (n / 1024 / 1024).toFixed(1); };
    function setState(txt, ok) {
      badge.textContent = txt;
      badge.className = 'badge' + (ok ? ' ok' : '');
      if (engine) { engine.textContent = txt; engine.className = 'badge' + (ok ? ' ok' : ''); }
    }
    setState(T('코어를 받는 중'), false);
    busy(true, T('코어를 받는 중'), '');

    F.loadCore(function (p) {
      if (p.phase === 'init') {
        busy(true, T('코어를 여는 중'), '');
        setState(T('코어를 여는 중'), false);
      } else if (p.phase === 'wasm') {
        busy(true, T('코어를 받는 중'),
          p.total > 0 ? TF('{n} / {total} MB', { n:MB(p.loaded), total:MB(p.total) }) : MB(p.loaded) + ' MB');
      }
    }).then(function () {
      S.coreReady = true;
      busy(false);
      setState(T('준비 완료'), true);
      refreshEnabled();
    }).catch(function (e) {
      busy(false);
      setState(T('코어를 불러오지 못했습니다'), false);
      toast(T('코어를 불러오지 못했습니다. 새로고침해 주세요'));
      console.error(e);
    });
  }

  // ═══════════════════════════════════════════════════════════
  // 작업 탭 — .tabbar 가 곧 오른쪽 패널의 탭입니다 (design/README.md §3)
  // ═══════════════════════════════════════════════════════════
  var STEP_META = {
    range: { icon:'fa-scissors',      title:'구간 고르기' },
    trim:  { icon:'fa-wand-magic-sparkles', title:'다듬기' },
    size:  { icon:'fa-compress',      title:'크기·용량' },
    out:   { icon:'fa-box-open',      title:'내보내기' }
  };
  var STEP_ORDER = ['range', 'trim', 'size', 'out'];

  function wireTabs() {
    $$('#toolTabs .tab').forEach(function (t) {
      t.addEventListener('click', function () { showStep(t.dataset.step); });
    });
  }

  function showStep(step) {
    S.step = step;
    $$('#toolTabs .tab').forEach(function (t) {
      t.classList.toggle('on', t.dataset.step === step);
    });
    $$('.tool').forEach(function (el) { el.hidden = el.id !== 'tool-' + step; });
    var m = STEP_META[step];
    $('#toolIcon').className = 'fa-solid ' + m.icon;
    $('#toolTitle').textContent = T(m.title);
    markDone();
  }

  /** 지나온 작업은 번호가 초록 체크로 바뀝니다 */
  function markDone() {
    var cur = STEP_ORDER.indexOf(S.step);
    $$('#toolTabs .tab').forEach(function (t) {
      var i = STEP_ORDER.indexOf(t.dataset.step);
      var done = (i < cur) && !!S.file;
      if (t.dataset.step === 'out') done = S.results.length > 0 && i < cur;
      t.classList.toggle('done', done);
    });
  }

  // ── .pickrow 공통 배선 ──
  function pick(id, fn) {
    var box = $('#' + id);
    if (!box) return;
    box.addEventListener('click', function (e) {
      var b = e.target.closest('.db');
      if (!b || b.disabled) return;
      Array.prototype.forEach.call(box.querySelectorAll('.db'), function (x) {
        x.classList.toggle('on', x === b);
      });
      fn(b.dataset.v);
    });
  }
  function pickSet(id, v) {
    var box = $('#' + id);
    if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll('.db'), function (x) {
      x.classList.toggle('on', x.dataset.v === String(v));
    });
  }

  // ── .rangerow 공통 배선 ──
  function slider(id, fn, fmt, isFloat) {
    var r = $('#' + id), o = $('#' + id + 'Out');
    r.addEventListener('input', function () {
      var v = isFloat ? parseFloat(r.value) : parseInt(r.value, 10);
      o.textContent = fmt ? fmt(v) : String(v);
      fn(v);
    });
  }
  function sliderSet(id, v, fmt) {
    var r = $('#' + id), o = $('#' + id + 'Out');
    r.value = v;
    o.textContent = fmt ? fmt(v) : String(v);
  }

  // ═══════════════════════════════════════════════════════════
  // 영상 불러오기
  // ═══════════════════════════════════════════════════════════
  function wireFile() {
    var input = $('#fileInput'), zone = $('#dropZone');
    zone.addEventListener('click', function (e) {
      if (e.target !== input) input.click();
    });
    input.addEventListener('change', function () {
      if (input.files[0]) openFile(input.files[0]);
      input.value = '';
    });

    var depth = 0;
    function hasFiles(e) {
      return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0;
    }
    window.addEventListener('dragenter', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth++; zone.classList.add('over');
    });
    window.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('dragleave', function (e) {
      e.preventDefault();
      if (--depth <= 0) { depth = 0; zone.classList.remove('over'); }
    });
    window.addEventListener('drop', function (e) {
      e.preventDefault(); depth = 0; zone.classList.remove('over');
      if (e.dataTransfer && e.dataTransfer.files[0]) openFile(e.dataTransfer.files[0]);
    });
  }

  function openFile(file) {
    if (S.busy) return;
    if (!/^video\//.test(file.type) && !/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name)) {
      toast(T('영상 파일이 아닙니다')); return;
    }
    if (!S.coreReady) { toast(T('코어를 아직 못 불러왔습니다')); return; }

    if (S.url) URL.revokeObjectURL(S.url);
    if (S.proxyURL) { URL.revokeObjectURL(S.proxyURL); S.proxyURL = null; }
    S.usingProxy = false;
    S.file = file;
    S.url = URL.createObjectURL(file);
    S.baseName = (file.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60)) || 'clip';
    S.inName = 'in' + ((file.name.match(/\.[a-z0-9]+$/i) || ['.mp4'])[0]).toLowerCase();
    S.inputWritten = false;
    S.clips = []; S.activeClip = null; S.seq = 0;
    renderClips();

    TLM.setVideo(S.url).catch(function () {
      // 브라우저가 못 푸는 코덱(아이폰 HEVC 등). ffmpeg 으로 미리보기용 영상을 만듭니다.
      return buildProxy().then(function (m) {
        toast(T('이 브라우저가 못 읽는 코덱이라 미리보기용 영상을 만들었습니다. 굽는 것은 언제나 원본입니다'));
        return m;
      });
    }).then(function (meta) {
      $('#fileCard').hidden = false;
      $('#fileDur').textContent = fmtTime(meta.duration);
      $('#fileDims').textContent = meta.w + '×' + meta.h;
      $('#fileBytes').textContent = fmtBytes(file.size);
      $('#bigNote').hidden = file.size <= BIG_FILE;
      $('#dropZone').classList.add('slim');
      $('#stageName').textContent = file.name;
      $('#stageName').title = file.name;
      $('#stageDims').textContent = meta.w + ' × ' + meta.h;
      TLM.layout();
      onRangeChange();
      refreshEnabled();
    }).catch(function () {
      toast(T('영상을 읽지 못했습니다. 다른 파일로 해 보세요'));
      TLM.clearVideo();
      $('#fileCard').hidden = true;
      $('#dropZone').classList.remove('slim');
      $('#stageName').textContent = T('미리보기');
      $('#stageDims').textContent = '';
      S.file = null;
      refreshEnabled();
    });
  }

  /** 미리보기용 대역 영상(VP8/WebM)을 만들어 겁니다 */
  function buildProxy() {
    setBusyState(true);
    busy(true, T('영상을 올리는 중입니다'));
    return ensureInput().then(function () {
      busy(true, T('미리보기를 만드는 중입니다'), '0%');
      return F.makeProxy(S.inName, 'proxy.webm', 540, function (r) {
        busy(true, T('미리보기를 만드는 중입니다'), Math.round(r * 100) + '%');
      });
    }).then(function (r) {
      S.proxyURL = URL.createObjectURL(new Blob([r.data], { type:'video/webm' }));
      S.usingProxy = true;
      return TLM.setVideo(S.proxyURL, { srcW:r.info.w, srcH:r.info.h, duration:r.info.duration });
    }).then(function (m) {
      busy(false); setBusyState(false);
      return m;
    }).catch(function (e) {
      busy(false); setBusyState(false);
      throw e;
    });
  }

  // ═══════════════════════════════════════════════════════════
  // 1. 구간 고르기
  // ═══════════════════════════════════════════════════════════
  function wireRangeTool() {
    $('#btnIn').addEventListener('click', function () { TLM.setIn(TL.vid.currentTime); });
    $('#btnOut').addEventListener('click', function () { TLM.setOut(TL.vid.currentTime); });
    $('#btnPlay').addEventListener('click', TLM.togglePlay);
    $('#btnHome').addEventListener('click', function () { TLM.seekTo(TL.start); });
    $('#btnLoop').addEventListener('click', function () {
      var on = !TL.loop;
      TLM.setLoop(on);
      $('#btnLoop').classList.toggle('on', on);
    });
    $('#btnStill').addEventListener('click', saveStill);
  }

  function onPlayState(playing) {
    var ic = playing ? 'fa-pause' : 'fa-play';
    $('#btnPlay').innerHTML = '<i class="fa-solid ' + ic + '"></i>' + T(playing ? '멈춤' : '재생');
    $('#btnPlay2').innerHTML = '<i class="fa-solid ' + ic + '"></i>';
  }

  function onTick(now) {
    $('#posLabel').textContent = fmtTime(now) + ' / ' + fmtTime(TL.duration);
  }

  function onRangeChange() {
    if (!TL.duration) {
      $('#rIn').textContent = $('#rOut').textContent = '0:00.0';
      $('#rLen').textContent = '0.0초';
      $('#rEst').textContent = '—';
      return;
    }
    $('#rIn').textContent = fmtTime(TL.start);
    $('#rOut').textContent = fmtTime(TL.end);
    $('#rLen').textContent = (TL.end - TL.start).toFixed(1) + '초';
    $('#posLabel').textContent = fmtTime(TL.vid.currentTime) + ' / ' + fmtTime(TL.duration);
    var c = TLM.cropForEncode();
    $('#cropInfo').textContent = c ? (c.w + ' × ' + c.h) : T('전체');
    // 지금 구간이 목록에 이미 있으면 그 줄을 짚어 줍니다
    var hit = matchingClipId();
    if (hit !== S.activeClip) { S.activeClip = hit; renderClips(); }
    updateEstimate();
  }

  function updateEstimate() {
    var est = $('#rEst');
    if (!TL.duration) { est.textContent = '—'; est.classList.remove('over'); return; }
    var job = currentJob();
    var d = F.outSize(job);
    var bytes = P.estimateBytes({
      format:job.format, width:d.w, height:d.h, fps:job.fps,
      seconds:(job.end - job.start) / job.speed,
      colors:job.colors, quality:job.quality, crf:job.crf,
      pingpong:job.loop === 'pingpong'
    });
    est.textContent = '≈ ' + fmtBytes(bytes) + ' · ' + d.w + '×' + d.h;
    // 목표 용량을 켜 뒀는데 넘을 것 같으면 굽기 전에 알려 줍니다
    est.classList.toggle('over', !!(S.st.fitToSize && bytes > S.st.targetMB * 1024 * 1024));
    $('#namePv').textContent = outName(job);
    refreshEnabled();
  }

  // ═══════════════════════════════════════════════════════════
  // 2. 다듬기
  // ═══════════════════════════════════════════════════════════
  function wireTrimTool() {
    $('#btnCrop').addEventListener('click', function () {
      TLM.setCropEnabled(!TL.cropOn);
      paintCropButtons();
    });
    $('#btnCropClear').addEventListener('click', function () { TLM.clearCrop(); });
    pick('ratioPick', function (v) { TLM.setRatio(v); });

    slider('optSpeed', function (i) { S.cur.speedIdx = i; updateEstimate(); },
      function (i) { return SPEEDS[i] + '×'; });
    pick('dirPick', function (v) { S.cur.loop = v; updateEstimate(); });
    pick('rotPick', function (v) { S.st.rotate = v; P.save(S.st); updateEstimate(); });
    slider('optFade', function (v) { S.st.fade = v; P.save(S.st); },
      function (v) { return v > 0 ? v.toFixed(1) + 's' : '0'; }, true);

    $('#optText').addEventListener('input', updateEstimate);
    pick('textPosPick', function (v) { S.st.textPos = v; P.save(S.st); });
    slider('optTextSize', function (v) { S.st.textSize = v; P.save(S.st); });
    slider('optTextPad', function (v) { S.st.textPad = v; P.save(S.st); });

    $('#logoFile').addEventListener('change', function (e) {
      var f = e.target.files[0];
      if (!f) return;
      if (S.logoURL) URL.revokeObjectURL(S.logoURL);
      S.logo = f;
      S.logoURL = URL.createObjectURL(f);
      $('#logoPrev').src = S.logoURL;
      $('#logoName').textContent = f.name;
      $('#logoRow').hidden = false;
      e.target.value = '';
    });
    $('#btnLogoClear').addEventListener('click', function () {
      if (S.logoURL) URL.revokeObjectURL(S.logoURL);
      S.logo = null; S.logoURL = null;
      $('#logoRow').hidden = true;
    });
    pick('logoPosPick', function (v) { S.st.logoPos = v; P.save(S.st); });
    slider('optLogoSize', function (v) { S.st.logoScale = v; P.save(S.st); });
  }

  function paintCropButtons() {
    var on = TL.cropOn;
    $('#btnCrop').classList.toggle('on', on);
    $('#btnCrop').innerHTML = '<i class="fa-solid fa-crop-simple"></i>' + T(on ? '칸 지우기' : '칸 그리기');
    $('#ratioPick').hidden = !on;
  }

  // ═══════════════════════════════════════════════════════════
  // 3. 크기·용량
  // ═══════════════════════════════════════════════════════════
  function buildDither() {
    var sel = $('#optDither');
    sel.innerHTML = '';
    P.DITHERS.forEach(function (d) {
      var o = document.createElement('option');
      o.value = d; o.textContent = d;
      sel.appendChild(o);
    });
  }

  function buildPresetPick() {
    var box = $('#presetPick');
    box.innerHTML = '';
    var lang = ClipBox.i18n ? ClipBox.i18n.lang : 'ko';
    S.st.presets.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'db' + (p.id === S.st.presetId ? ' on' : '');
      b.dataset.v = p.id;
      b.textContent = P.presetName(p, lang);
      box.appendChild(b);
    });
  }

  function wireSizeTool() {
    pick('presetPick', function (id) { pickPreset(id); });
    pick('formatPick', function (v) { S.cur.format = v; applyUI(); });
    slider('optWidth', function (v) { S.cur.width = v; updateEstimate(); });
    slider('optFps', function (v) { S.cur.fps = v; updateEstimate(); });
    slider('optColors', function (v) { S.cur.colors = v; updateEstimate(); });
    slider('optQuality', function (v) { S.cur.quality = v; updateEstimate(); });
    slider('optCrf', function (v) { S.cur.crf = v; updateEstimate(); });
    $('#optDither').addEventListener('change', function (e) { S.cur.dither = e.target.value; });

    $('#btnPresetSave').addEventListener('click', function () {
      var lang = ClipBox.i18n ? ClipBox.i18n.lang : 'ko';
      S.st.presets.forEach(function (p) {
        if (p.id !== S.st.presetId) return;
        ['format', 'width', 'fps', 'colors', 'dither', 'quality', 'crf'].forEach(function (k) { p[k] = S.cur[k]; });
        toast(TF('{name} 프리셋을 지금 값으로 저장했습니다', { name:P.presetName(p, lang) }));
      });
      P.save(S.st);
      buildPresetPick();
      paintPresetPv();
    });
    $('#btnPresetReset').addEventListener('click', function () {
      S.st.presets = P.resetPresets();
      P.save(S.st);
      buildPresetPick();
      pickPreset(S.st.presetId);
      toast(T('프리셋을 기본값으로 되돌렸습니다'));
    });

    $('#btnFit').addEventListener('click', function () {
      S.st.fitToSize = !S.st.fitToSize;
      P.save(S.st);
      applyUI();
    });
    $('#optTarget').addEventListener('input', function (e) {
      var v = parseFloat(e.target.value);
      if (isFinite(v) && v > 0) { S.st.targetMB = v; P.save(S.st); updateEstimate(); }
    });
  }

  function pickPreset(id) {
    S.st.presetId = id;
    S.cur = pickCur(id);
    var p = null;
    S.st.presets.forEach(function (x) { if (x.id === id) p = x; });
    // 목표 용량이 박힌 프리셋(메신저)은 '맞추기' 를 같이 켭니다
    if (p && p.maxBytes > 0) { S.st.fitToSize = true; S.st.targetMB = p.maxBytes / 1024 / 1024; }
    P.save(S.st);
    pickSet('presetPick', id);
    applyUI();
  }

  function paintPresetPv() {
    var p = null;
    S.st.presets.forEach(function (x) { if (x.id === S.st.presetId) p = x; });
    $('#presetPv').textContent = p ? P.describe(p) : '';
  }

  // ═══════════════════════════════════════════════════════════
  // 4. 내보내기
  // ═══════════════════════════════════════════════════════════
  function wireOutTool() {
    $('#btnResClear').addEventListener('click', function () {
      S.results.forEach(function (r) { if (r.url) URL.revokeObjectURL(r.url); });
      S.results = [];
      renderResults();
    });
  }

  // ═══════════════════════════════════════════════════════════
  // 상태 → 화면
  // ═══════════════════════════════════════════════════════════
  function applyUI() {
    var c = S.cur, st = S.st;
    var f = P.FORMATS[c.format];

    pickSet('formatPick', c.format);
    sliderSet('optWidth', c.width);
    sliderSet('optFps', c.fps);
    sliderSet('optColors', c.colors);
    sliderSet('optQuality', c.quality);
    sliderSet('optCrf', c.crf);
    sliderSet('optSpeed', c.speedIdx, function (i) { return SPEEDS[i] + '×'; });
    sliderSet('optFade', st.fade, function (v) { return v > 0 ? v.toFixed(1) + 's' : '0'; });
    sliderSet('optTextSize', st.textSize);
    sliderSet('optTextPad', st.textPad);
    sliderSet('optLogoSize', st.logoScale);
    $('#optDither').value = c.dither;

    $$('.opt').forEach(function (el) {
      var k = el.dataset.for;
      el.hidden = !(k === 'colors' ? f.hasColors
        : k === 'dither' ? f.hasDither
        : k === 'quality' ? f.hasQuality
        : k === 'crf' ? f.hasCrf : true);
    });
    $('#formatHint').textContent = T(
      c.format === 'gif' ? '팔레트를 뽑고 칠하는 2패스로 굽습니다. bayer가 가장 작게 나옵니다.'
      : c.format === 'webp' ? 'libwebp 애니메이션입니다. 같은 화질이면 GIF보다 훨씬 작습니다.'
      : 'libx264 · 소리 없음 고정 · faststart. CRF는 낮을수록 좋고 커집니다.');

    $('#btnFit').classList.toggle('on', !!st.fitToSize);
    $('#optTarget').value = st.targetMB;
    $('#optTarget').disabled = !st.fitToSize;

    pickSet('dirPick', c.loop);
    pickSet('rotPick', st.rotate);
    pickSet('textPosPick', st.textPos);
    pickSet('logoPosPick', st.logoPos);
    paintCropButtons();
    paintPresetPv();
    updateEstimate();
  }

  /** 지금 할 수 있는 것만 열어 둡니다 (design/README.md §3) */
  function refreshEnabled() {
    var hasVideo = !!S.file && TL.duration > 0;
    var ready = S.coreReady && hasVideo && !S.busy;
    var longEnough = TL.end - TL.start >= 0.1;

    ['btnPlay', 'btnPlay2', 'btnHome', 'btnLoop', 'btnIn', 'btnOut', 'btnCrop', 'btnStill']
      .forEach(function (id) { $('#' + id).disabled = !hasVideo || S.busy; });
    $('#btnAddClip').disabled = !(ready && longEnough);
    $('#btnRun').disabled = !(ready && longEnough);
    $('#btnRunAll').disabled = !(ready && S.clips.length > 0);
    $('#btnRemoveSel').disabled = !S.clips.length || S.busy;
    $('#btnClearQueue').disabled = !S.clips.length || S.busy;
    $('#btnCropClear').disabled = !hasVideo || S.busy;
    markDone();
  }

  // ═══════════════════════════════════════════════════════════
  // job
  // ═══════════════════════════════════════════════════════════
  function currentJob(over) {
    var c = S.cur, st = S.st;
    var job = {
      start:TL.start, end:TL.end,
      speed:SPEEDS[c.speedIdx == null ? SPEEDS.indexOf(1) : c.speedIdx],
      loop:c.loop || 'normal',
      crop:TLM.cropForEncode(),
      rotate:st.rotate === 'auto' ? 'auto' : parseInt(st.rotate, 10),
      fps:c.fps, width:c.width, format:c.format,
      colors:c.colors, dither:c.dither, quality:c.quality, crf:c.crf,
      text:$('#optText').value.trim(),
      textPos:st.textPos, textSize:st.textSize, textPad:st.textPad,
      logo:S.logo, logoPos:st.logoPos, logoScale:st.logoScale, logoPad:st.logoPad,
      fade:st.fade, srcW:TL.srcW, srcH:TL.srcH
    };
    if (over) for (var k in over) if (Object.prototype.hasOwnProperty.call(over, k)) job[k] = over[k];
    return job;
  }

  function jobFromClip(clip) {
    return currentJob({ start:clip.start, end:clip.end, crop:clip.crop, speed:clip.speed, loop:clip.loop });
  }

  function outName(job) {
    return S.baseName + '_' + job.start.toFixed(1) + '-' + job.end.toFixed(1) + '.' + P.FORMATS[job.format].ext;
  }

  // ═══════════════════════════════════════════════════════════
  // 클립 목록
  // ═══════════════════════════════════════════════════════════
  function liveClip() {
    return {
      id:0, start:TL.start, end:TL.end, crop:TLM.cropForEncode(),
      speed:SPEEDS[S.cur.speedIdx == null ? SPEEDS.indexOf(1) : S.cur.speedIdx],
      loop:S.cur.loop || 'normal'
    };
  }

  function sameClip(a, b) {
    function near(x, y) { return Math.abs(x - y) < 0.05; }
    function sameCrop(p, q) {
      return (!p && !q) || (p && q && p.x === q.x && p.y === q.y && p.w === q.w && p.h === q.h);
    }
    return near(a.start, b.start) && near(a.end, b.end) && a.speed === b.speed
      && a.loop === b.loop && sameCrop(a.crop, b.crop);
  }

  function matchingClipId() {
    var live = liveClip(), hit = null;
    S.clips.forEach(function (x) { if (!hit && sameClip(x, live)) hit = x.id; });
    return hit;
  }

  function addClip() {
    if (!S.file || TL.end - TL.start < 0.1) { toast(T('구간이 너무 짧습니다')); return; }
    var clip = liveClip();
    clip.id = ++S.seq;
    clip.checked = false;
    clip.thumb = TLM.grabThumb(42);

    var dupe = null;
    S.clips.forEach(function (x) { if (!dupe && sameClip(x, clip)) dupe = x; });
    if (dupe) {                                   // 같은 구간을 두 번 담으면 같은 파일이 두 개 나옵니다
      S.activeClip = dupe.id;
      renderClips();
      toast(T('같은 구간이 이미 목록에 있습니다'));
      return;
    }
    S.clips.push(clip);
    S.activeClip = clip.id;
    renderClips();
    toast(TF('구간을 목록에 담았습니다 ({n}개)', { n:S.clips.length }));
  }

  function renderClips() {
    var box = $('#queueList');
    box.innerHTML = '';
    $('#queueCount').textContent = S.clips.length;

    S.clips.forEach(function (c, i) {
      var li = document.createElement('div');
      li.className = 'qitem' + (S.activeClip === c.id ? ' on' : '');

      var chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = !!c.checked;
      chk.addEventListener('click', function (e) { e.stopPropagation(); });
      chk.addEventListener('change', function () { c.checked = chk.checked; });

      var idx = document.createElement('span');
      idx.className = 'idx';
      idx.textContent = String(i + 1);

      var meta = document.createElement('div');
      meta.className = 'meta';
      var nm = document.createElement('div');
      nm.className = 'nm';
      nm.textContent = fmtTime(c.start) + ' → ' + fmtTime(c.end);
      var mt = document.createElement('div');
      mt.className = 'mt';
      var bits = [(c.end - c.start).toFixed(1) + '초'];
      if (c.crop) bits.push(c.crop.w + '×' + c.crop.h);
      if (c.speed !== 1) bits.push(c.speed + '×');
      if (c.loop === 'reverse') bits.push(T('역재생'));
      if (c.loop === 'pingpong') bits.push(T('핑퐁'));
      mt.textContent = bits.join(' · ');
      meta.appendChild(nm); meta.appendChild(mt);

      li.appendChild(chk);
      li.appendChild(idx);
      if (c.thumb) {
        var im = document.createElement('img');
        im.className = 'th';
        im.src = c.thumb;
        im.alt = '';
        li.appendChild(im);
      }
      li.appendChild(meta);
      li.addEventListener('click', function () { loadClip(c); });
      box.appendChild(li);
    });
    refreshEnabled();
  }

  function loadClip(c) {
    if (S.busy) return;
    S.activeClip = c.id;
    TLM.applyCrop(c.crop);
    S.cur.speedIdx = Math.max(0, SPEEDS.indexOf(c.speed));
    S.cur.loop = c.loop;
    applyUI();
    TLM.setRange(c.start, c.end);
    renderClips();
  }

  // ═══════════════════════════════════════════════════════════
  // 아래 작업 줄
  // ═══════════════════════════════════════════════════════════
  function wireBar() {
    $('#btnPlay2').addEventListener('click', TLM.togglePlay);
    $('#btnAddClip').addEventListener('click', addClip);
    $('#btnRun').addEventListener('click', function () { runBatch([liveClip()]); });
    $('#btnRunAll').addEventListener('click', function () { runBatch(S.clips.slice()); });
    $('#btnCancel').addEventListener('click', cancel);

    // 되돌릴 수 없는 동작은 한 번 묻습니다 (design/README.md §3)
    $('#btnClearQueue').addEventListener('click', function () {
      if (!S.clips.length) return;
      if (!confirm(T('목록을 모두 비울까요?'))) return;
      S.clips = []; S.activeClip = null;
      renderClips();
      toast(T('목록을 비웠습니다'));
    });
    $('#btnRemoveSel').addEventListener('click', function () {
      var n = S.clips.filter(function (c) { return c.checked; }).length;
      if (!n) return;
      if (!confirm(TF('체크한 {n}개를 뺄까요?', { n:n }))) return;
      S.clips = S.clips.filter(function (c) { return !c.checked; });
      renderClips();
    });
  }

  // ═══════════════════════════════════════════════════════════
  // 굽기
  // ═══════════════════════════════════════════════════════════
  function setBusyState(on) {
    S.busy = on;
    $('#btnCancel').hidden = !on;
    $('#btnRun').hidden = on;
    $('#btnRunAll').hidden = on;
    $('#btnAddClip').hidden = on;
    // 작업 중에는 설정을 못 바꾸게 잠급니다 (그만두기 버튼만 남깁니다)
    $$('#panTool button, #panTool input, #panTool select, #panQueue button, #toolTabs .tab')
      .forEach(function (el) { el.disabled = on; });
    if (!on) { progress(null); refreshEnabled(); applyUI(); }
  }

  function cancel() {
    if (S.cancelled) return;
    S.cancelled = true;
    // 워커를 죽이고 다시 띄우는 사이에 화면이 멈춘 것처럼 보이지 않게 합니다
    busy(true, T('그만뒀습니다'));
    F.terminate();
    S.inputWritten = false;
  }

  function ensureInput() {
    if (S.inputWritten) return Promise.resolve();
    return F.writeInput(S.inName, S.file).then(function () { S.inputWritten = true; });
  }

  /** 힘이 빠진 워커를 갈아 끼웁니다 */
  function recycle() {
    F.terminate();
    S.inputWritten = false;
    S.cancelled = false;
    return F.reload().then(ensureInput);
  }

  function runBatch(clips) {
    if (S.busy || !clips.length || !S.file || !S.coreReady) return;
    S.cancelled = false;
    runStartedAt = Date.now();
    setBusyState(true);
    TLM.pause();
    var made = [];

    progress(0, T('영상을 올리는 중입니다'));
    ensureInput().then(function () {
      return clips.reduce(function (chain, clip, i) {
        return chain.then(function () {
          if (S.cancelled) return;
          return (F.needsRecycle() ? recycle() : Promise.resolve()).then(function () {
            var many = clips.length > 1;
            return encodeOne(jobFromClip(clip), function (p, label) {
              progress((i + p) / clips.length, many ? (label + ' (' + (i + 1) + '/' + clips.length + ')') : label);
            }).then(function (r) { if (r) made.push(r); });
          });
        });
      }, Promise.resolve());
    }).then(function () {
      if (S.cancelled) { toast(T('그만뒀습니다')); return; }
      made.forEach(addResult);
      var zipP = made.length > 1 ? makeZip(made) : Promise.resolve();
      return zipP.then(function () {
        renderResults();
        showStep('out');
        if (made.length === 1) toast(TF('다 됐습니다 — {name} ({size})', { name:made[0].name, size:fmtBytes(made[0].bytes) }));
        else if (made.length > 1) toast(TF('{n}개를 구웠습니다. ZIP으로 받으세요', { n:made.length }));
      });
    }).catch(function (e) {
      // 그만두기로 워커가 죽어 던지는 것은 정상입니다 — 콘솔에 오류로 남기지 않습니다
      if (S.cancelled || /terminated|그만/i.test(String(e))) { toast(T('그만뒀습니다')); return; }
      if (F.isFatal(e)) toast(T('메모리가 모자랍니다. 구간을 짧게 하거나 가로 크기를 줄여 보세요'));
      else toast(TF('실패했습니다 — {why}', { why:String(e).slice(0, 90) }));
      if (F.isFatal(e)) { F.terminate(); S.inputWritten = false; }
      console.error(e);
    }).then(function () {
      // 그만두기·오류로 워커가 죽었다면 되살려 둡니다 (다음 굽기가 바로 되게)
      if (!F.isLoaded()) {
        S.inputWritten = false;
        return F.reload().catch(function () { S.coreReady = false; });
      }
    }).then(function () {
      busy(false);
      setBusyState(false);
    });
  }

  /** 클립 하나. 목표 용량이 켜져 있으면 최대 3번까지 낮춰 가며 다시 굽습니다. */
  function encodeOne(job, onProg) {
    var target = S.st.fitToSize ? Math.round(S.st.targetMB * 1024 * 1024) : 0;
    var tries = target ? MAX_TRIES : 1;
    var cur = { format:job.format, width:job.width, fps:job.fps,
                colors:job.colors, quality:job.quality, crf:job.crf };
    var best = null, missed = false, n = 0;

    function attempt() {
      if (n >= tries || S.cancelled) return Promise.resolve();
      n++;
      var j = {}, k;
      for (k in job) if (Object.prototype.hasOwnProperty.call(job, k)) j[k] = job[k];
      for (k in cur) if (Object.prototype.hasOwnProperty.call(cur, k)) j[k] = cur[k];
      var name = 'out.' + P.FORMATS[j.format].ext;
      var base = (n - 1) / tries, w = 1 / tries;

      return runWithRetry(j, name, function (p, label) {
        onProg(base + p * w, n > 1 ? T('다시 굽는 중입니다') : T(label));
      }).then(function (data) {
        if (!best || data.length < best.data.length) {
          var snap = {};
          for (var kk in cur) if (Object.prototype.hasOwnProperty.call(cur, kk)) snap[kk] = cur[kk];
          best = { data:data, cur:snap };
        }
        if (!target || data.length <= target) { missed = false; return; }
        var nx = P.nextAttempt(cur, data.length, target);
        missed = true;
        if (!nx) return;
        cur = nx;
        return attempt();
      });
    }

    return attempt().then(function () {
      if (!best) return null;
      onProg(1, T('굽는 중입니다'));
      var j = {}, k;
      for (k in job) if (Object.prototype.hasOwnProperty.call(job, k)) j[k] = job[k];
      for (k in best.cur) if (Object.prototype.hasOwnProperty.call(best.cur, k)) j[k] = best.cur[k];
      var fmt = P.FORMATS[j.format];
      var dims = F.outSize(j);
      return {
        name:outName(j), bytes:best.data.length,
        blob:new Blob([best.data], { type:fmt.mime }),
        w:dims.w, h:dims.h, fps:j.fps, seconds:F.outDuration(job),
        missed:missed && target > 0, format:j.format
      };
    });
  }

  /** 한 번 죽으면 워커를 갈아 끼우고 딱 한 번 더 해 봅니다 */
  function runWithRetry(job, name, onProg) {
    return F.encodeClip(job, S.inName, name, onProg).catch(function (e) {
      if (S.cancelled || !F.isFatal(e)) throw e;
      return recycle().then(function () {
        if (S.cancelled) throw e;
        return F.encodeClip(job, S.inName, name, onProg);
      });
    });
  }

  // ═══════════════════════════════════════════════════════════
  // 결과
  // ═══════════════════════════════════════════════════════════
  function addResult(r) {
    r.url = URL.createObjectURL(r.blob);
    S.results.unshift(r);
  }

  function makeZip(items) {
    if (typeof JSZip === 'undefined') return Promise.resolve();
    progress(0.99, T('묶는 중입니다'));
    var zip = new JSZip();
    items.forEach(function (r) { zip.file(r.name, r.blob); });
    return zip.generateAsync({ type:'blob' }).then(function (blob) {
      S.results.unshift({ name:S.baseName + '_clips.zip', bytes:blob.size,
        blob:blob, url:null, isZip:true, count:items.length });
    });
  }

  function renderResults() {
    var list = $('#resList');
    list.innerHTML = '';
    $('#resEmpty').hidden = S.results.length > 0;
    $('#btnResClear').hidden = S.results.length === 0;

    S.results.forEach(function (r) {
      var el = document.createElement('div');
      el.className = 'res';

      if (!r.isZip) {
        var rv = document.createElement('div');
        rv.className = 'rv';
        if (r.format === 'mp4') {
          var v = document.createElement('video');
          v.src = r.url; v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true;
          rv.appendChild(v);
        } else {
          var im = document.createElement('img');
          im.src = r.url; im.alt = '';
          rv.appendChild(im);
        }
        el.appendChild(rv);
      }

      var rf = document.createElement('div');
      rf.className = 'rf';
      var nm = document.createElement('div');
      nm.className = 'rn';
      nm.textContent = r.name;
      rf.appendChild(nm);

      var mt = document.createElement('div');
      mt.className = 'rm';
      mt.textContent = r.isZip
        ? fmtBytes(r.bytes) + ' · ' + r.count
        : fmtBytes(r.bytes) + ' · ' + r.w + '×' + r.h + ' · ' + r.fps + 'fps · ' + r.seconds.toFixed(1) + '초';
      rf.appendChild(mt);

      if (r.missed) {
        var w2 = document.createElement('div');
        w2.className = 'rm miss';
        w2.textContent = T('목표 용량을 맞추지 못했습니다. 가장 작게 나온 결과입니다.');
        rf.appendChild(w2);
      }

      var rb = document.createElement('div');
      rb.className = 'rb';
      var dl = document.createElement('button');
      dl.className = 'db go';
      dl.innerHTML = '<i class="fa-solid fa-download"></i>' + T(r.isZip ? 'ZIP으로 내려받기' : '내려받기');
      dl.addEventListener('click', function () { download(r.blob, r.name); });
      rb.appendChild(dl);

      var rm = document.createElement('button');
      rm.className = 'db danger x';
      rm.title = T('이 결과 빼기');
      rm.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      rm.addEventListener('click', function () {
        if (r.url) URL.revokeObjectURL(r.url);
        S.results = S.results.filter(function (v) { return v !== r; });
        renderResults();
      });
      rb.appendChild(rm);
      rf.appendChild(rb);

      el.appendChild(rf);
      list.appendChild(el);
    });
    markDone();
  }

  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  function saveStill() {
    var cv = TLM.grabStill();
    if (!cv) return;
    cv.toBlob(function (b) {
      if (!b) return;
      download(b, S.baseName + '_' + TL.vid.currentTime.toFixed(1) + '.png');
      toast(T('지금 프레임을 저장했습니다'));
    }, 'image/png');
  }

  // ── 출발 ──
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // 디버그용 (콘솔에서 상태를 보거나 자동 시험에서 씁니다)
  ClipBox.state = S;
  ClipBox.debug = { showStep:showStep, addClip:addClip, toast:toast, setRange:TLM.setRange };
})();
