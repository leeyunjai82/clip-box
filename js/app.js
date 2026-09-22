// ═══════════════════════════════════════════════════════════
// app.js — 상태 · 영상 불러오기 · 담아 둔 구간 · 작업 탭 · 만들기
// ═══════════════════════════════════════════════════════════
// 1원칙 (design/README.md §7): 영상은 브라우저 밖으로 나가지 않습니다.
// 이 파일에는 바깥을 부르는 코드가 한 줄도 없습니다
// (vendor/ 아래 코어·글꼴만 같은 출처에서 읽습니다).
//
// 화면 규약: 알림은 toast / busy / .prg 셋뿐이고, 되돌릴 수 없는 동작만
// confirm() 으로 한 번 묻습니다.
//
// 쉽게 쓰기 위한 규칙 둘
//  · 자주 쓰는 것만 펼쳐 두고, 나머지는 `.db.fold` 로 접습니다.
//  · 화면에 쓰는 말은 도구 용어가 아니라 하려는 일로 적습니다
//    (굽기 → 만들기, 클립 목록 → 담아 둔 구간).

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
  var fmtTime = TLM.fmtTime, fmtSec = TLM.fmtSec, fmtBytes = TLM.fmtBytes;

  var BIG_FILE = 300 * 1024 * 1024;
  var MAX_TRIES = 3;
  var SPEEDS = P.SPEEDS;

  // '작게 · 보통 · 크게' 가 가리키는 가로 크기
  var SIZE_STEPS = [360, 480, 720];

  var S = {
    file:null, url:null, proxyURL:null, usingProxy:false,
    baseName:'clip', inName:'in.mp4', inputWritten:false,
    st:P.load(), cur:null,
    clips:[], activeClip:null, seq:0,
    busy:false, cancelled:false, results:[],
    logo:null, logoURL:null, coreReady:false, step:'range',
    toldHowToPick:false, leaving:false
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
    wireFolds();
    wireFile();
    wireRangeTool();
    wireTrimTool();
    wireSizeTool();
    wireOutTool();
    wireBar();

    applyUI();
    onRangeChange();      // HTML 에 박힌 초기값 대신 한 번 그려 둡니다 (영어 단위까지)
    refreshEnabled();
    window.addEventListener('resize', TLM.layout);
    window.addEventListener('beforeunload', function (e) {
      if (S.busy) { e.preventDefault(); e.returnValue = ''; }
    });
    // 페이지를 떠나는 중에는 하던 요청이 끊깁니다. 이미 떠나는 마당에
    // "새로고침해 주세요" 라고 알릴 이유가 없습니다.
    window.addEventListener('pagehide', function () { S.leaving = true; });

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
    var engine = document.getElementById('engine');   // nav.js 가 헤더에 단 배지
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
      if (S.leaving) return;               // 새로고침·이동으로 끊긴 것은 알릴 일이 아닙니다
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

  // ── `자세히` 접기 ──
  // 새 부품을 만들지 않습니다. 킷의 .db 버튼 하나로 아래 덩이를 여닫습니다.
  function wireFolds() {
    $$('.db.fold').forEach(function (b) {
      var body = document.getElementById(b.dataset.fold);
      if (!body) return;
      b.addEventListener('click', function () {
        var open = body.hidden;
        body.hidden = !open;
        b.classList.toggle('on', open);
      });
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

  /** 고른 상태가 남지 않는 버튼 줄 — 누르면 그때 한 번 실행만 합니다 */
  function tap(id, fn) {
    var box = $('#' + id);
    if (!box) return;
    box.addEventListener('click', function (e) {
      var b = e.target.closest('.db');
      if (!b || b.disabled) return;
      fn(b.dataset.v);
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
    $('#btnFileClear').addEventListener('click', function (e) { e.stopPropagation(); clearFile(); });
    zone.addEventListener('click', function (e) {
      if (e.target !== input) input.click();
    });
    // 킷은 input[type=file] 을 숨기므로 키보드로는 닿지 않습니다.
    // 영상을 넣는 자리는 이 도구의 입구라 키보드로도 열 수 있어야 합니다.
    zone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); input.click(); }
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
    if (S.busy) { toast(T('만드는 중입니다. 끝나거나 그만둔 뒤에 바꾸세요')); return; }
    if (!/^video\//.test(file.type) && !/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name)) {
      toast(T('영상 파일이 아닙니다')); return;
    }
    if (!S.coreReady) { toast(T('코어를 아직 못 불러왔습니다')); return; }
    if (!file.size) { toast(T('빈 파일입니다')); return; }
    // 영상을 바꾸면 담아 둔 구간은 그 영상 것이므로 쓸 수 없게 됩니다 — 빼기와 같게 한 번 묻습니다
    if (S.clips.length &&
        !confirm(TF('담아 둔 구간 {n}개도 같이 없어집니다. 다른 영상으로 바꿀까요?', { n:S.clips.length }))) return;

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

    var madeProxy = false;
    TLM.setVideo(S.url).catch(function () {
      // 브라우저가 못 푸는 코덱(아이폰 HEVC 등). ffmpeg 으로 미리보기용 영상을 만듭니다.
      madeProxy = true;
      return buildProxy();
    }).then(function (meta) {
      $('#fileRow').hidden = false;
      $('#fileName').textContent = file.name;
      $('#fileName').title = file.name;
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
      // 영상을 넣은 직후, 다음에 뭘 해야 하는지 한 번만 알려 줍니다
      if (madeProxy) {
        toast(T('이 브라우저가 못 읽는 코덱이라 미리보기용 영상을 만들었습니다. 만드는 것은 언제나 원본입니다'));
      } else if (!S.toldHowToPick) {
        S.toldHowToPick = true;
        toast(T('아래 필름에서 파란 손잡이를 끌어 자를 곳을 고르세요'));
      }
    }).catch(function (e) {
      toast(T(/NOVIDEO/.test(String(e && e.message)) ? '이 파일에는 영상이 없습니다 (소리만 들어 있습니다)'
                                                     : '영상을 읽지 못했습니다. 다른 파일로 해 보세요'));
      S.file = null;
      resetStage();
    });
  }

  /** 넣은 영상을 뺍니다. 담아 둔 구간도 그 영상 것이므로 같이 없어집니다. */
  function clearFile() {
    if (S.busy || !S.file) return;
    if (S.clips.length &&
        !confirm(TF('담아 둔 구간 {n}개도 같이 없어집니다. 영상을 뺄까요?', { n:S.clips.length }))) return;
    S.file = null;
    resetStage();
    toast(T('영상을 뺐습니다'));
  }

  /** 영상이 없는 처음 상태로 되돌립니다 */
  function resetStage() {
    if (S.url) URL.revokeObjectURL(S.url);
    if (S.proxyURL) URL.revokeObjectURL(S.proxyURL);
    S.url = null; S.proxyURL = null; S.usingProxy = false;
    S.inputWritten = false;
    S.clips = []; S.activeClip = null; S.seq = 0;
    TLM.clearVideo();
    $('#fileRow').hidden = true;
    $('#fileCard').hidden = true;
    $('#bigNote').hidden = true;
    $('#dropZone').classList.remove('slim');
    $('#stageName').textContent = T('미리보기');
    $('#stageName').title = '';
    $('#stageDims').textContent = '';
    renderClips();
    onRangeChange();
    refreshEnabled();
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
    // 가장 흔한 길이를 한 번에 잡습니다. 세밀한 조정은 필름에서 합니다.
    tap('lenPick', function (v) { setRangeLen(v); });
    $('#btnIn').addEventListener('click', function () { TLM.setIn(TL.vid.currentTime); });
    $('#btnOut').addEventListener('click', function () { TLM.setOut(TL.vid.currentTime); });
    $('#btnStill').addEventListener('click', saveStill);
  }

  /** 시작점은 그대로 두고 길이만 맞춥니다. 끝이 영상 밖이면 시작을 앞으로 당깁니다. */
  function setRangeLen(v) {
    if (!TL.duration) return;
    if (v === 'all') { TLM.setRange(0, TL.duration); return; }
    var n = parseFloat(v);
    if (!isFinite(n) || n <= 0) return;
    if (n >= TL.duration) { TLM.setRange(0, TL.duration); return; }
    var a = Math.max(0, Math.min(TL.start, TL.duration - n));
    TLM.setRange(a, a + n);
  }

  function onPlayState(playing) {
    $('#btnPlay').innerHTML = '<i class="fa-solid ' + (playing ? 'fa-pause' : 'fa-play') + '"></i>';
  }

  function onTick(now) {
    $('#posLabel').textContent = fmtTime(now) + ' / ' + fmtTime(TL.duration);
  }

  function onRangeChange() {
    if (!TL.duration) {
      $('#rIn').textContent = $('#rOut').textContent = '0:00.0';
      $('#rLen').textContent = fmtSec(0);
      $('#rEst').textContent = '—';
      return;
    }
    $('#rIn').textContent = fmtTime(TL.start);
    $('#rOut').textContent = fmtTime(TL.end);
    $('#rLen').textContent = fmtSec(TL.end - TL.start);
    $('#posLabel').textContent = fmtTime(TL.vid.currentTime) + ' / ' + fmtTime(TL.duration);
    var c = TLM.cropForEncode();
    $('#cropInfo').textContent = c ? (c.w + ' × ' + c.h) : T('원본 그대로');
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
    // 목표 용량을 켜 뒀는데 넘을 것 같으면 만들기 전에 알려 줍니다
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
    $('#btnCropCenter').addEventListener('click', function () { TLM.centerCrop(); });
    pick('ratioPick', function (v) { TLM.setRatio(v); });

    slider('optSpeed', function (i) { S.cur.speedIdx = i; updateEstimate(); },
      function (i) { return SPEEDS[i] + '×'; });
    pick('dirPick', function (v) { S.cur.loop = v; updateEstimate(); });
    pick('rotPick', function (v) { S.st.rotate = v; P.save(S.st); updateEstimate(); });
    slider('optFade', function (v) { S.st.fade = v; P.save(S.st); },
      function (v) { return v > 0 ? v.toFixed(1) + 's' : '0'; }, true);

    $('#optText').addEventListener('input', updateEstimate);
    pick('textPosPick', function (v) { S.st.textPos = v; P.save(S.st); avoidOverlap('logo'); });
    slider('optTextSize', function (v) { S.st.textSize = v; P.save(S.st); });
    slider('optTextPad', function (v) { S.st.textPad = v; P.save(S.st); });

    $('#logoFile').addEventListener('change', function (e) {
      var f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      // accept= 는 파일 창의 고르기 필터일 뿐이라 영상도 들어옵니다
      if (!/^image\//.test(f.type) && !/\.(png|webp|jpe?g|gif|bmp)$/i.test(f.name)) {
        toast(T('그림 파일만 됩니다 (PNG · WEBP · JPG)')); return;
      }
      if (S.logoURL) URL.revokeObjectURL(S.logoURL);
      S.logo = f;
      S.logoURL = URL.createObjectURL(f);
      $('#logoPrev').src = S.logoURL;
      $('#logoName').textContent = f.name;
      $('#logoRow').hidden = false;
    });
    $('#btnLogoClear').addEventListener('click', function () {
      if (S.logoURL) URL.revokeObjectURL(S.logoURL);
      S.logo = null; S.logoURL = null;
      $('#logoRow').hidden = true;
    });
    pick('logoPosPick', function (v) { S.st.logoPos = v; P.save(S.st); avoidOverlap('text'); });
    slider('optLogoSize', function (v) { S.st.logoScale = v; P.save(S.st); });
  }

  /** 글자와 로고를 같은 모서리에 두면 로고가 글자를 덮습니다. 나중에 고른 쪽을 남기고 다른 쪽을 옆으로 밉니다. */
  function avoidOverlap(move) {
    if (S.st.textPos !== S.st.logoPos) return;
    var flip = { 'top-left':'top-right', 'top-right':'top-left', 'bottom-left':'bottom-right', 'bottom-right':'bottom-left' };
    if (move === 'text') { S.st.textPos = flip[S.st.textPos]; pickSet('textPosPick', S.st.textPos); }
    else                 { S.st.logoPos = flip[S.st.logoPos]; pickSet('logoPosPick', S.st.logoPos); }
    P.save(S.st);
    toast(T(move === 'text' ? '로고와 겹치지 않게 글자를 옆 모서리로 옮겼습니다' : '글자와 겹치지 않게 로고를 옆 모서리로 옮겼습니다'));
  }

  function paintCropButtons() {
    var on = TL.cropOn;
    // 라벨은 바꾸지 않습니다. '칸 지우기' 라고 적어 두니 옆의 지우기 버튼과
    // 같은 일을 하는 것처럼 읽혔습니다. 켜졌다는 것은 .on 과 딸린 줄로 알립니다.
    $('#btnCrop').classList.toggle('on', on);
    $('#ratioPick').hidden = !on;
    $('#cropTools').hidden = !on;
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
    pick('sizePick', function (v) { S.cur.width = parseInt(v, 10); applyUI(); });
    pick('formatPick', function (v) { S.cur.format = v; applyUI(); });
    // 가로를 직접 끌면 '작게·보통·크게' 중 맞는 것만 켜집니다 (없으면 셋 다 꺼집니다)
    slider('optWidth', function (v) { S.cur.width = v; pickSet('sizePick', v); updateEstimate(); });
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
        toast(TF('{name}을(를) 지금 값으로 저장했습니다', { name:P.presetName(p, lang) }));
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
      toast(T('기본값으로 되돌렸습니다'));
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
    // 프리셋은 크기·형식·화질만 바꿉니다. 다듬기 탭에서 정한 배속·방향은 그대로 둡니다.
    var keepSpeed = S.cur ? S.cur.speedIdx : null, keepLoop = S.cur ? S.cur.loop : null;
    S.cur = pickCur(id);
    if (keepSpeed != null) S.cur.speedIdx = keepSpeed;
    if (keepLoop) S.cur.loop = keepLoop;
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
    pickSet('sizePick', SIZE_STEPS.indexOf(c.width) >= 0 ? c.width : '');
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
    // 형식은 코덱 이름이 아니라 쓰임새로 적습니다
    $('#formatHint').textContent = T(
      c.format === 'gif' ? '어디에 붙여도 바로 움직입니다. 대신 용량이 가장 큽니다.'
      : c.format === 'webp' ? 'GIF와 똑같이 쓰면서 용량은 훨씬 작습니다. 요즘 브라우저는 다 읽습니다.'
      : '가장 작고 매끄럽습니다. 소리는 넣지 않습니다.');
    $('#advHint').textContent = T('원본보다 크게 만들지는 않습니다.') + ' ' + T(
      c.format === 'gif' ? '색 수를 줄이면 용량이 줄고, 디더링을 끄면 화면 녹화는 훨씬 작아집니다.'
      : c.format === 'webp' ? '숫자가 높을수록 선명하고 커집니다.'
      : '숫자가 낮을수록 선명하고 커집니다.');

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

    // 영상이 없으면 오른쪽 패널에서 할 수 있는 일이 없습니다.
    // 1번 탭만 잠그고 2·3번은 열어 두면 왜 여기만 되는지 알 수 없습니다.
    $$('#panTool button, #panTool input, #panTool select')
      .forEach(function (el) { el.disabled = !hasVideo || S.busy; });
    $$('.needvideo').forEach(function (el) { el.hidden = hasVideo; });
    // 패널을 통째로 풀었으므로, 조건이 따로 있는 것은 여기서 다시 잠급니다
    $('#optTarget').disabled = !hasVideo || S.busy || !S.st.fitToSize;
    ['btnPlay', 'btnHome', 'btnLoop'].forEach(function (id) { $('#' + id).disabled = !hasVideo || S.busy; });
    $('#btnAddClip').disabled = !(ready && longEnough);
    $('#btnRun').disabled = !(ready && longEnough);
    $('#btnRunAll').disabled = !(ready && S.clips.length > 0);
    $('#btnRemoveSel').disabled = !S.clips.length || S.busy;
    $('#btnClearQueue').disabled = !S.clips.length || S.busy;
    $('#btnFileClear').disabled = !S.file || S.busy;
    // 영상을 빼도 이미 만들어 둔 결과는 내려받을 수 있어야 합니다
    if (!S.busy) {
      $('#btnResClear').disabled = S.results.length === 0;
      $$('#resList button').forEach(function (el) { el.disabled = false; });
    }
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
  // 담아 둔 구간
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
    $('#queueEmpty').hidden = S.clips.length > 0 || !S.file;

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
      var bits = [fmtSec(c.end - c.start)];
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
  // 아래 작업 줄 — 재생 조작과 주 동작을 한 줄에 모았습니다
  // ═══════════════════════════════════════════════════════════
  function wireBar() {
    $('#btnPlay').addEventListener('click', TLM.togglePlay);
    $('#btnHome').addEventListener('click', function () { TLM.seekTo(TL.start); });
    $('#btnLoop').addEventListener('click', function () {
      var on = !TL.loop;
      TLM.setLoop(on);
      $('#btnLoop').classList.toggle('on', on);
    });
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
  // 만들기
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
        else if (made.length > 1) toast(TF('{n}개를 만들었습니다. ZIP으로 받으세요', { n:made.length }));
      });
    }).catch(function (e) {
      if (S.leaving) return;
      // 그만두기로 워커가 죽어 던지는 것은 정상입니다 — 콘솔에 오류로 남기지 않습니다
      if (S.cancelled || /terminated|그만/i.test(String(e))) { toast(T('그만뒀습니다')); return; }
      if (F.isFatal(e)) toast(T('메모리가 모자랍니다. 구간을 짧게 하거나 가로 크기를 줄여 보세요'));
      else toast(TF('실패했습니다 — {why}', { why:String(e).slice(0, 90) }));
      if (F.isFatal(e)) { F.terminate(); S.inputWritten = false; }
      console.error(e);
    }).then(function () {
      // 그만두기·오류로 워커가 죽었다면 되살려 둡니다 (다음 만들기가 바로 되게)
      if (!F.isLoaded()) {
        S.inputWritten = false;
        return F.reload().catch(function () { S.coreReady = false; });
      }
    }).then(function () {
      busy(false);
      setBusyState(false);
    });
  }

  /** 구간 하나. 목표 용량이 켜져 있으면 최대 3번까지 낮춰 가며 다시 만듭니다. */
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
        onProg(base + p * w, n > 1 ? T('다시 만드는 중입니다') : T(label));
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
      onProg(1, T('만드는 중입니다'));
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
          // H.264 디코더가 없는 브라우저(일부 리눅스 빌드)에서는 빈 칸만 남습니다.
          // 파일은 멀쩡하므로 그렇다고 알려 줍니다.
          v.addEventListener('error', function () {
            rv.innerHTML = '';
            rv.classList.add('noplay');
            var n = document.createElement('span');
            n.textContent = T('이 브라우저는 MP4를 못 풉니다. 파일은 정상이니 내려받아서 보세요.');
            rv.appendChild(n);
          });
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
        : fmtBytes(r.bytes) + ' · ' + r.w + '×' + r.h + ' · ' + r.fps + 'fps · ' + fmtSec(r.seconds);
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
        if (!confirm(TF('{name} 을(를) 뺄까요?', { name:r.name }))) return;
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
      toast(T('지금 화면을 사진으로 저장했습니다'));
    }, 'image/png');
  }

  // ── 출발 ──
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // 디버그용 (콘솔에서 상태를 보거나 자동 시험에서 씁니다)
  ClipBox.state = S;
  ClipBox.debug = { showStep:showStep, addClip:addClip, toast:toast,
                    setRange:TLM.setRange, setRangeLen:setRangeLen };
})();
