// ═══════════════════════════════════════════════════════════════════════
// app.js — 상태, 영상 불러오기, 클립 큐, 굽기 파이프라인
// ═══════════════════════════════════════════════════════════════════════
// 1원칙: 영상은 브라우저 밖으로 나가지 않는다.
// 이 파일에는 바깥을 부르는 코드가 한 줄도 없다 (vendor/ 아래 코어·글꼴만
// same-origin 으로 읽는다).
//
// 화면 규약은 docs/DESIGN.md — 알림은 toast / busy / progress 셋뿐이고
// alert()·confirm() 은 쓰지 않는다.

// ── 옛 화면이 캐시에 남아 있을 때의 자가 복구 ──────────────────────────
// 2026-09 에 index.html 이 부르는 CSS 가 통째로 바뀌었다(ui.css·theme-maker.css
// → base.css). 브라우저가 옛 index.html 을 캐시에서 꺼내 쓰면 지운 CSS 가 404 가
// 나면서 색·글자 크기·헤더 높이가 전부 기본값으로 떨어진다(흰 화면).
// GitHub Pages 는 Cache-Control 을 못 건드리므로, 짝이 안 맞는 것을 스스로 알아채고
// 주소에 값을 붙여 캐시를 비켜 한 번만 다시 불러온다.
// (?v= 가 이미 붙어 있으면 다시 하지 않으므로 무한 새로고침이 되지 않는다)
if (!document.getElementById('topbar') && !/[?&]v=/.test(location.search)) {
  location.replace(location.pathname + '?v=' + Date.now());
}

import { t, apply as applyI18n, getLang, setLang } from './i18n.js';
import * as P from './presets.js';
import * as F from './ffmpeg.js';
import {
  TL, initTimeline, setVideo, clearVideo, setRange, setIn, setOut, seekTo,
  setCropEnabled, clearCrop, setRatio, cropForEncode, applyCrop, grabStill, grabThumb,
  togglePlay, pause, setLoop, layout, redrawThumbsSoon, fmtTime, fmtBytes,
} from './timeline.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.prototype.slice.call(document.querySelectorAll(s));

const BIG_FILE = 300 * 1024 * 1024;
const MAX_TRIES = 3;
const SPEEDS = [0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4];

const S = {
  file: null,
  url: null,
  proxyURL: null,
  usingProxy: false,
  baseName: 'clip',
  inName: 'in.mp4',
  inputWritten: false,
  presets: P.loadPresets(),
  st: P.loadSettings(),
  cur: null,            // 지금 화면에 걸린 출력 설정 (프리셋의 작업 사본)
  clips: [],
  activeClip: null,
  seq: 0,
  busy: false,
  cancelled: false,
  results: [],
  logo: null,
  logoURL: null,
  coreReady: false,
};

// ═══════════════════════════════════════════════════════════════════════
// 알림 / 진행률  (docs/DESIGN.md §5)
// ═══════════════════════════════════════════════════════════════════════
function toast(msg, kind) {
  const d = document.createElement('div');
  d.className = 'toast' + (kind ? ' ' + kind : '');
  d.textContent = msg;
  $('#toasts').appendChild(d);
  setTimeout(() => {
    d.style.transition = 'opacity .3s';
    d.style.opacity = '0';
    setTimeout(() => d.remove(), 320);
  }, 3600);
}

function busy(on, text, ratio, sub) {
  $('#busy').hidden = !on;
  if (!on) return;
  $('#busyText').textContent = text || t('msg.working');
  const bar = $('#busyBar');
  if (ratio == null) bar.hidden = true;
  else {
    bar.hidden = false;
    bar.firstElementChild.style.width = (Math.max(0, Math.min(1, ratio)) * 100).toFixed(1) + '%';
  }
  $('#busySub').textContent = sub || '';
}

let runStartedAt = 0;

function progress(ratio, label) {
  const w = $('#progressWrap');
  if (ratio == null) { w.hidden = true; return; }
  w.hidden = false;
  const r = Math.max(0, Math.min(1, ratio));
  $('#progressBar').firstElementChild.style.width = (r * 100).toFixed(1) + '%';

  // 지금까지 걸린 시간으로 남은 시간을 어림잡는다.
  // 5% 는 지나야 쓸 만한 값이 나온다 (그 전에는 들쭉날쭉하다).
  let eta = '';
  if (runStartedAt && r > 0.05 && r < 0.995) {
    const spent = (Date.now() - runStartedAt) / 1000;
    const left = Math.round(spent * (1 - r) / r);
    if (left >= 1 && left < 3600) eta = ' · ' + t('msg.eta', { s: left });
  }
  $('#progressText').textContent = (label ? label + ' ' : '') + Math.round(r * 100) + '%' + eta;
}

// ═══════════════════════════════════════════════════════════════════════
// 시작
// ═══════════════════════════════════════════════════════════════════════
function boot() {
  S.cur = { ...(S.presets.find(p => p.id === S.st.presetId) || S.presets[0]) };

  initTimeline({ onChange: onRangeChange, onTick: onTick, onPlayState: onPlayState });
  buildDitherOptions();
  wireTopbar();
  wireFile();
  wireTabs();
  wireOutputTab();
  wireTransformTab();
  wireDecoTab();
  wireResultTab();
  wireBottomBar();

  applyI18n(document);
  document.documentElement.lang = getLang();
  buildPresets();
  applyUI();
  refreshEnabled();

  window.addEventListener('resize', layout);
  window.addEventListener('beforeunload', (e) => {
    if (S.busy) { e.preventDefault(); e.returnValue = ''; }
  });

  loadCore();
}

// ── 코어 로드 ──
async function loadCore() {
  const MB = (n) => (n / 1024 / 1024).toFixed(1);
  busy(true, t('msg.coreLoading'), 0, t('msg.coreOnce'));
  try {
    await F.loadCore((p) => {
      if (p.phase === 'init') {
        busy(true, t('msg.coreStarting'), 1, p.cached ? t('msg.coreCached') : '');
      } else if (p.phase === 'wasm') {
        const r = p.total > 0 ? p.loaded / p.total : 0;
        busy(true, t('msg.coreLoading'), r,
          p.total > 0 ? `${MB(p.loaded)} / ${MB(p.total)} MB` : `${MB(p.loaded)} MB`);
      }
    });
    S.coreReady = true;
    busy(false);
    refreshEnabled();
  } catch (e) {
    busy(true, t('msg.coreFail'), null, String(e).slice(0, 140));
    $('#busy').querySelector('.spin').style.display = 'none';
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 상단 바
// ═══════════════════════════════════════════════════════════════════════
function wireTopbar() {
  const b = $('#langToggle');
  const paint = () => { b.textContent = getLang() === 'ko' ? 'EN' : '한'; };
  paint();
  b.addEventListener('click', () => {
    setLang(getLang() === 'ko' ? 'en' : 'ko');
    paint();
    buildPresets();
    applyUI();
    renderClips();
    renderResults();
    refreshEnabled();
  });
  $('#privacyClose').addEventListener('click', () => { $('#privacyNote').hidden = true; });
}

// ═══════════════════════════════════════════════════════════════════════
// 영상 불러오기
// ═══════════════════════════════════════════════════════════════════════
function wireFile() {
  const input = $('#fileInput');
  $('#btnPick').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    if (input.files[0]) openFile(input.files[0]);
    input.value = '';
  });

  const zone = $('#dropZone');
  let depth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0;

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth++; zone.classList.add('hot');
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (--depth <= 0) { depth = 0; zone.classList.remove('hot'); }
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault(); depth = 0; zone.classList.remove('hot');
    if (e.dataTransfer && e.dataTransfer.files[0]) openFile(e.dataTransfer.files[0]);
  });
}

async function openFile(file) {
  if (S.busy) return;
  if (!/^video\//.test(file.type) && !/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name)) {
    toast(t('msg.notVideo'), 'err');
    return;
  }
  if (!S.coreReady) { toast(t('msg.needCore'), 'warn'); return; }

  if (S.url) URL.revokeObjectURL(S.url);
  if (S.proxyURL) { URL.revokeObjectURL(S.proxyURL); S.proxyURL = null; }
  S.usingProxy = false;
  S.file = file;
  S.url = URL.createObjectURL(file);
  S.baseName = file.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'clip';
  S.inName = 'in' + ((file.name.match(/\.[a-z0-9]+$/i) || ['.mp4'])[0]).toLowerCase();
  S.inputWritten = false;
  S.clips = [];
  S.activeClip = null;
  S.seq = 0;
  renderClips();

  let meta = null;
  try {
    meta = await setVideo(S.url);
  } catch (e) {
    // 브라우저가 못 푸는 코덱(아이폰 HEVC 등). ffmpeg 으로 미리보기용 영상을 만든다.
    try {
      meta = await buildProxy();
    } catch (e2) {
      toast(t('msg.badVideo'), 'err');
      clearVideo();
      $('#fileCard').hidden = true;
      $('#stageName').textContent = t('stage.empty');
      $('#stageDims').textContent = '';
      S.file = null;
      refreshEnabled();
      return;
    }
  }

  $('#fileCard').hidden = false;
  $('#fileDur').textContent = fmtTime(meta.duration);
  $('#fileDims').textContent = meta.w + '×' + meta.h;
  $('#fileBytes').textContent = fmtBytes(file.size);
  $('#proxyNote').hidden = !S.usingProxy;
  $('#bigNote').hidden = file.size <= BIG_FILE;
  if (file.size > BIG_FILE) toast(t('file.big'), 'warn');

  $('#stageName').textContent = file.name;
  $('#stageDims').textContent = `${meta.w} × ${meta.h}`;

  layout();
  onRangeChange();
  refreshEnabled();
}

/** 미리보기용 대역 영상(VP8/WebM)을 만들어 건다 */
async function buildProxy() {
  setBusyState(true);
  try {
    busy(true, t('msg.loadingVideo'), 0);
    await ensureInput();
    busy(true, t('msg.buildingProxy'), 0);
    const { data, info } = await F.makeProxy(S.inName, 'proxy.webm', 540,
      (r) => busy(true, t('msg.buildingProxy'), r));
    S.proxyURL = URL.createObjectURL(new Blob([data], { type: 'video/webm' }));
    S.usingProxy = true;
    return await setVideo(S.proxyURL, { srcW: info.w, srcH: info.h, duration: info.duration });
  } finally {
    busy(false);
    setBusyState(false);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 탭
// ═══════════════════════════════════════════════════════════════════════
function wireTabs() {
  $$('#tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => showTab(tab.dataset.tab));
  });
}

function showTab(name) {
  $$('#tabs .tab').forEach(x => x.classList.toggle('active', x.dataset.tab === name));
  $$('.tabbody').forEach(b => { b.hidden = b.id !== 'tab-' + name; });
}

/** .seg 안의 버튼 하나를 고르는 공통 배선 */
function seg(id, fn) {
  const box = $('#' + id);
  box.addEventListener('click', (e) => {
    const b = e.target.closest('.seg-b');
    if (!b || b.disabled) return;
    box.querySelectorAll('.seg-b').forEach(x => x.classList.toggle('active', x === b));
    fn(b.dataset.v);
  });
}

function segSet(id, v) {
  $('#' + id).querySelectorAll('.seg-b').forEach(x => x.classList.toggle('active', x.dataset.v === String(v)));
}

/** range + output 짝 배선 */
function slider(id, fn, fmt, isFloat) {
  const r = $('#' + id), o = $('#' + id + 'Out');
  r.addEventListener('input', () => {
    const v = isFloat ? parseFloat(r.value) : parseInt(r.value, 10);
    o.textContent = fmt ? fmt(v) : String(v);
    fn(v);
  });
}

function sliderSet(id, v, fmt) {
  const r = $('#' + id), o = $('#' + id + 'Out');
  r.value = v;
  o.textContent = fmt ? fmt(v) : String(v);
}

// ═══════════════════════════════════════════════════════════════════════
// 출력 탭
// ═══════════════════════════════════════════════════════════════════════
function buildDitherOptions() {
  const sel = $('#optDither');
  sel.innerHTML = '';
  P.DITHERS.forEach(d => {
    const o = document.createElement('option');
    o.value = d; o.textContent = d;
    sel.appendChild(o);
  });
}

/**
 * 프리셋은 '서로 배타적인 선택' 이므로 세그먼트(.seg)로 그린다.
 * snap-box 의 `가림 모드` 와 같은 부품이다 (docs/DESIGN.md §5).
 * 고른 프리셋의 값은 바로 아래 .hint 한 줄로 보여 준다.
 */
function buildPresets() {
  const box = $('#presetSeg');
  box.innerHTML = '';
  S.presets.forEach(p => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-b' + (p.id === S.st.presetId ? ' active' : '');
    b.dataset.v = p.id;
    b.textContent = P.presetName(p, getLang());
    box.appendChild(b);
  });
  paintPresetHint();
}

function paintPresetHint() {
  const p = S.presets.find(x => x.id === S.st.presetId);
  $('#presetHint').textContent = p ? P.describe(p) : '';
}

function pickPreset(id) {
  const p = S.presets.find(x => x.id === id);
  if (!p) return;
  S.st.presetId = id;
  S.cur = { ...p };
  // 목표 용량이 박힌 프리셋(카톡)은 '목표 용량 맞추기' 를 같이 켠다
  if (p.maxBytes > 0) { S.st.fitToSize = true; S.st.targetMB = p.maxBytes / 1024 / 1024; }
  P.saveSettings(S.st);
  segSet('presetSeg', id);
  paintPresetHint();
  applyUI();
}

function wireOutputTab() {
  seg('presetSeg', v => pickPreset(v));
  seg('formatSeg', v => { S.cur.format = v; applyUI(); });
  slider('optWidth', v => { S.cur.width = v; updateEstimate(); });
  slider('optFps', v => { S.cur.fps = v; updateEstimate(); });
  slider('optColors', v => { S.cur.colors = v; updateEstimate(); });
  slider('optQuality', v => { S.cur.quality = v; updateEstimate(); });
  slider('optCrf', v => { S.cur.crf = v; updateEstimate(); });
  $('#optDither').addEventListener('change', e => { S.cur.dither = e.target.value; });

  $('#btnPresetSave').addEventListener('click', () => {
    const i = S.presets.findIndex(p => p.id === S.st.presetId);
    if (i < 0) return;
    S.presets[i] = { ...S.presets[i], ...S.cur };
    P.savePresets(S.presets);
    buildPresets();
    toast(t('out.presetSaved', { name: P.presetName(S.presets[i], getLang()) }), 'ok');
  });
  $('#btnPresetReset').addEventListener('click', () => {
    S.presets = P.resetPresets();
    buildPresets();
    pickPreset(S.st.presetId);
    toast(t('out.presetsReset'), 'ok');
  });

  $('#btnFit').addEventListener('click', () => {
    S.st.fitToSize = !S.st.fitToSize;
    P.saveSettings(S.st);
    applyUI();
  });
  $('#optTarget').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (isFinite(v) && v > 0) { S.st.targetMB = v; P.saveSettings(S.st); updateEstimate(); }
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 변형 탭
// ═══════════════════════════════════════════════════════════════════════
function wireTransformTab() {
  $('#btnCrop').addEventListener('click', toggleCrop);
  $('#btnCrop2').addEventListener('click', toggleCrop);
  $('#btnCropClear').addEventListener('click', () => clearCrop());
  $('#btnCropClear2').addEventListener('click', () => clearCrop());
  seg('ratioSeg', v => setRatio(v));

  slider('optSpeed', i => { S.cur.speedIdx = i; updateEstimate(); }, i => SPEEDS[i] + '×');
  seg('dirSeg', v => { S.cur.loop = v; updateEstimate(); });
  slider('optFade', v => { S.st.fade = v; P.saveSettings(S.st); }, v => v > 0 ? v.toFixed(1) + 's' : '0', true);
  seg('rotSeg', v => { S.st.rotate = v; P.saveSettings(S.st); updateEstimate(); });
}

function toggleCrop() {
  setCropEnabled(!TL.cropOn);
  paintCropButtons();
}

function paintCropButtons() {
  const on = TL.cropOn;
  $('#btnCrop').classList.toggle('on', on);
  $('#btnCrop2').classList.toggle('on', on);
  $('#btnCrop2').textContent = t(on ? 'tf.cropOff' : 'tf.cropOn');
}

// ═══════════════════════════════════════════════════════════════════════
// 꾸미기 탭
// ═══════════════════════════════════════════════════════════════════════
function wireDecoTab() {
  $('#optText').addEventListener('input', updateEstimate);
  seg('textPosSeg', v => { S.st.textPos = v; P.saveSettings(S.st); });
  slider('optTextSize', v => { S.st.textSize = v; P.saveSettings(S.st); });
  slider('optTextPad', v => { S.st.textPad = v; P.saveSettings(S.st); });

  $('#logoFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (S.logoURL) URL.revokeObjectURL(S.logoURL);
    S.logo = f;
    S.logoURL = URL.createObjectURL(f);
    $('#logoPrev').src = S.logoURL;
    $('#logoName').textContent = f.name;
    $('#logoRow').hidden = false;
    e.target.value = '';
  });
  $('#btnLogoClear').addEventListener('click', () => {
    if (S.logoURL) URL.revokeObjectURL(S.logoURL);
    S.logo = null; S.logoURL = null;
    $('#logoRow').hidden = true;
  });
  seg('logoPosSeg', v => { S.st.logoPos = v; P.saveSettings(S.st); });
  slider('optLogoSize', v => { S.st.logoScale = v; P.saveSettings(S.st); }, v => v + '%');
  slider('optLogoPad', v => { S.st.logoPad = v; P.saveSettings(S.st); });
}

// ═══════════════════════════════════════════════════════════════════════
// 결과 탭
// ═══════════════════════════════════════════════════════════════════════
function wireResultTab() {
  $('#btnResClear').addEventListener('click', () => {
    S.results.forEach(r => { if (r.url) URL.revokeObjectURL(r.url); });
    S.results = [];
    renderResults();
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 상태 → 화면
// ═══════════════════════════════════════════════════════════════════════
function applyUI() {
  const c = S.cur, st = S.st;
  if (c.speedIdx == null) c.speedIdx = SPEEDS.indexOf(1);
  if (!c.loop) c.loop = 'normal';

  const f = P.FORMATS[c.format];
  segSet('formatSeg', c.format);
  sliderSet('optWidth', c.width);
  sliderSet('optFps', c.fps);
  sliderSet('optColors', c.colors);
  sliderSet('optQuality', c.quality);
  sliderSet('optCrf', c.crf);
  sliderSet('optSpeed', c.speedIdx, i => SPEEDS[i] + '×');
  sliderSet('optFade', st.fade, v => v > 0 ? v.toFixed(1) + 's' : '0');
  sliderSet('optTextSize', st.textSize);
  sliderSet('optTextPad', st.textPad);
  sliderSet('optLogoSize', st.logoScale, v => v + '%');
  sliderSet('optLogoPad', st.logoPad);
  $('#optDither').value = c.dither;

  $$('.row.opt').forEach(el => {
    const k = el.dataset.for;
    el.hidden = !(k === 'colors' ? f.hasColors
      : k === 'dither' ? f.hasDither
        : k === 'quality' ? f.hasQuality
          : k === 'crf' ? f.hasCrf : true);
  });
  $('#formatHint').textContent = t('out.hint' + c.format.charAt(0).toUpperCase() + c.format.slice(1));

  $('#btnFit').classList.toggle('on', !!st.fitToSize);
  $('#optTarget').value = st.targetMB;
  $('#optTarget').disabled = !st.fitToSize;

  segSet('dirSeg', c.loop);
  segSet('rotSeg', st.rotate);
  segSet('textPosSeg', st.textPos);
  segSet('logoPosSeg', st.logoPos);
  paintCropButtons();
  updateEstimate();
}

function onPlayState(playing) {
  $('#btnPlay').innerHTML = playing ? '&#10073;&#10073;' : '&#9654;';
}

function onTick(now) {
  $('#clock').textContent = `${fmtTime(now)} / ${fmtTime(TL.duration)}`;
}

function onRangeChange() {
  if (!TL.duration) {
    $('#rIn').textContent = $('#rOut').textContent = '0:00.0';
    $('#rLen').textContent = '0.0s';
    $('#rEst').textContent = '—';
    return;
  }
  $('#rIn').textContent = fmtTime(TL.start);
  $('#rOut').textContent = fmtTime(TL.end);
  $('#rLen').textContent = (TL.end - TL.start).toFixed(1) + 's';
  $('#clock').textContent = `${fmtTime(TL.vid.currentTime)} / ${fmtTime(TL.duration)}`;
  const c = cropForEncode();
  $('#cropInfo').textContent = c ? `${c.w} × ${c.h}` : t('tf.whole');
  // 지금 구간이 큐에 이미 있으면 그 항목을 짚어 준다
  const hit = matchingClipId();
  if (hit !== S.activeClip) { S.activeClip = hit; renderClips(); }
  updateEstimate();
}

function updateEstimate() {
  if (!TL.duration) { $('#rEst').textContent = '—'; return; }
  const job = currentJob();
  const d = F.outSize(job);
  const secs = (job.end - job.start) / job.speed;
  const bytes = P.estimateBytes({
    format: job.format, width: d.w, height: d.h, fps: job.fps, seconds: secs,
    colors: job.colors, quality: job.quality, crf: job.crf, pingpong: job.loop === 'pingpong',
  });
  // '≈' 로 어림값임을 알린다 (한/영 공통)
  const est = $('#rEst');
  est.textContent = `≈ ${fmtBytes(bytes)} · ${d.w}×${d.h}`;
  // 목표 용량을 켜 뒀는데 넘을 것 같으면 굽기 전에 알려 준다
  const over = S.st.fitToSize && bytes > S.st.targetMB * 1024 * 1024;
  est.classList.toggle('over', !!over);
  est.title = over ? t('res.over', { mb: S.st.targetMB }) : '';
  refreshEnabled();
}

/** 지금 상황에서 눌러도 되는 버튼만 켠다 */
function refreshEnabled() {
  const hasVideo = !!S.file && TL.duration > 0;
  const ready = S.coreReady && hasVideo && !S.busy;
  const longEnough = TL.end - TL.start >= 0.1;

  ['btnPlay', 'btnHome', 'btnLoop', 'btnIn', 'btnOut', 'btnCrop', 'btnStill']
    .forEach(id => { $('#' + id).disabled = !hasVideo || S.busy; });
  $('#btnAddClip').disabled = !(ready && longEnough);
  $('#btnRun').disabled = !(ready && longEnough);
  $('#btnRunAll').disabled = !(ready && S.clips.length > 0);
  $('#btnClearQueue').disabled = !S.clips.length || S.busy;
  $('#btnRemoveSel').disabled = !S.clips.length || S.busy;
  $('#btnPick').disabled = S.busy || !S.coreReady;
}

// ═══════════════════════════════════════════════════════════════════════
// job 만들기
// ═══════════════════════════════════════════════════════════════════════
function currentJob(over) {
  const c = S.cur, st = S.st;
  const job = {
    start: TL.start, end: TL.end,
    speed: SPEEDS[c.speedIdx == null ? SPEEDS.indexOf(1) : c.speedIdx],
    loop: c.loop || 'normal',
    crop: cropForEncode(),
    rotate: st.rotate === 'auto' ? 'auto' : parseInt(st.rotate, 10),
    fps: c.fps, width: c.width, format: c.format,
    colors: c.colors, dither: c.dither, quality: c.quality, crf: c.crf,
    text: $('#optText').value.trim(),
    textPos: st.textPos, textSize: st.textSize, textPad: st.textPad,
    logo: S.logo, logoPos: st.logoPos, logoScale: st.logoScale, logoPad: st.logoPad,
    fade: st.fade,
    srcW: TL.srcW, srcH: TL.srcH,
  };
  return Object.assign(job, over || {});
}

function jobFromClip(clip) {
  return currentJob({
    start: clip.start, end: clip.end, crop: clip.crop,
    speed: clip.speed, loop: clip.loop,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 클립 큐
// ═══════════════════════════════════════════════════════════════════════
function addClip() {
  if (!S.file || TL.end - TL.start < 0.1) { toast(t('msg.tooShort'), 'warn'); return; }
  const c = S.cur;
  const clip = {
    id: ++S.seq,
    start: TL.start, end: TL.end,
    crop: cropForEncode(),
    speed: SPEEDS[c.speedIdx == null ? SPEEDS.indexOf(1) : c.speedIdx],
    loop: c.loop || 'normal',
    checked: false,
    thumb: grabThumb(46),     // 지금 보이는 프레임 (구간 손잡이가 여기로 옮겨 놨다)
  };
  // 같은 구간을 두 번 담으면 같은 파일이 두 개 나온다 — 미리 막는다
  const dupe = S.clips.find(x => sameClip(x, clip));
  if (dupe) {
    S.activeClip = dupe.id;
    renderClips();
    toast(t('queue.dupe'), 'warn');
    return;
  }
  S.clips.push(clip);
  S.activeClip = clip.id;    // 방금 담은 것을 지금 항목으로
  renderClips();
  toast(t('queue.added', { n: S.clips.length }), 'ok');
}

/** 구간·크롭·배속·방향이 모두 같은가 */
function sameClip(a, b) {
  const near = (x, y) => Math.abs(x - y) < 0.05;
  const sameCrop = (p, q) => (!p && !q) || (p && q && p.x === q.x && p.y === q.y && p.w === q.w && p.h === q.h);
  return near(a.start, b.start) && near(a.end, b.end) && a.speed === b.speed
    && a.loop === b.loop && sameCrop(a.crop, b.crop);
}

/** 지금 화면의 구간이 큐의 어느 항목인지 (없으면 null) */
function matchingClipId() {
  const live = liveClip();
  const hit = S.clips.find(x => sameClip(x, live));
  return hit ? hit.id : null;
}

function renderClips() {
  const box = $('#queueList');
  box.innerHTML = '';
  $('#queueCount').textContent = S.clips.length;
  $('#queueHint').hidden = S.clips.length > 0;

  S.clips.forEach((c) => {
    const li = document.createElement('li');
    li.className = (S.activeClip === c.id ? 'active' : '');

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = !!c.checked;
    chk.addEventListener('click', (e) => e.stopPropagation());
    chk.addEventListener('change', () => { c.checked = chk.checked; });

    // 구간 첫 프레임 썸네일 — 어떤 구간인지 글자보다 그림이 빠르다
    let thumb = null;
    if (c.thumb) {
      thumb = document.createElement('img');
      thumb.src = c.thumb;
      thumb.alt = '';
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    const rg = document.createElement('div');
    rg.className = 'rg';
    rg.textContent = `${fmtTime(c.start)} → ${fmtTime(c.end)}`;
    const st = document.createElement('div');
    st.className = 'st';
    const bits = [(c.end - c.start).toFixed(1) + 's'];
    if (c.crop) bits.push(`${c.crop.w}×${c.crop.h}`);
    if (c.speed !== 1) bits.push(c.speed + '×');
    if (c.loop === 'reverse') bits.push(t('tf.rev'));
    if (c.loop === 'pingpong') bits.push(t('tf.pp'));
    st.textContent = bits.join(' · ');
    meta.appendChild(rg);
    meta.appendChild(st);

    li.appendChild(chk);
    if (thumb) li.appendChild(thumb);
    li.appendChild(meta);
    li.addEventListener('click', () => loadClip(c));
    box.appendChild(li);
  });
  refreshEnabled();
}

/** 큐의 클립을 화면으로 되돌린다 */
function loadClip(c) {
  if (S.busy) return;
  S.activeClip = c.id;
  applyCrop(c.crop);
  S.cur.speedIdx = Math.max(0, SPEEDS.indexOf(c.speed));
  S.cur.loop = c.loop;
  applyUI();
  setRange(c.start, c.end);
  renderClips();
}

// ═══════════════════════════════════════════════════════════════════════
// 아래 바
// ═══════════════════════════════════════════════════════════════════════
function wireBottomBar() {
  $('#btnPlay').addEventListener('click', togglePlay);
  $('#btnHome').addEventListener('click', () => seekTo(TL.start));
  $('#btnLoop').addEventListener('click', () => {
    const on = !TL.loop;
    setLoop(on);
    $('#btnLoop').classList.toggle('on', on);
  });
  $('#btnIn').addEventListener('click', () => setIn(TL.vid.currentTime));
  $('#btnOut').addEventListener('click', () => setOut(TL.vid.currentTime));
  $('#btnAddClip').addEventListener('click', addClip);
  $('#btnRun').addEventListener('click', () => runBatch([liveClip()]));
  $('#btnRunAll').addEventListener('click', () => runBatch(S.clips.slice()));
  $('#btnCancel').addEventListener('click', cancel);

  $('#btnStill').addEventListener('click', saveStill);
  $('#btnClearQueue').addEventListener('click', () => {
    S.clips = []; S.activeClip = null;
    renderClips();
    toast(t('queue.cleared'), 'ok');
  });
  $('#btnRemoveSel').addEventListener('click', () => {
    const keep = S.clips.filter(c => !c.checked);
    if (keep.length === S.clips.length) return;
    S.clips = keep;
    renderClips();
  });
}

function liveClip() {
  return {
    id: 0, start: TL.start, end: TL.end, crop: cropForEncode(),
    speed: SPEEDS[S.cur.speedIdx == null ? SPEEDS.indexOf(1) : S.cur.speedIdx],
    loop: S.cur.loop || 'normal',
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 굽기
// ═══════════════════════════════════════════════════════════════════════
function setBusyState(on) {
  S.busy = on;
  $('#btnCancel').hidden = !on;
  $('#btnRun').hidden = on;
  $('#btnRunAll').hidden = on;
  // 작업 중에는 설정을 못 바꾸게 잠근다 (취소 버튼만 남긴다)
  $$('#toolPane button, #toolPane input, #toolPane select, #queuePane button, #stageHead button, #cropBar button')
    .forEach(el => { el.disabled = on; });
  if (!on) {
    progress(null);
    refreshEnabled();
    applyUI();
  }
}

function cancel() {
  if (S.cancelled) return;
  S.cancelled = true;
  // 워커를 죽이고 다시 띄우는 사이에 화면이 멈춘 것처럼 보이지 않게 덮개를 씌운다
  busy(true, t('msg.cancelling'));
  F.terminate();
  S.inputWritten = false;
  progress(0, t('msg.cancelled'));
}

async function ensureInput() {
  if (S.inputWritten) return;
  await F.writeInput(S.inName, S.file);
  S.inputWritten = true;
}

/** 힘이 빠진 워커를 갈아 끼운다 */
async function recycle() {
  F.terminate();
  S.inputWritten = false;
  S.cancelled = false;
  await F.reload();
  await ensureInput();
}

async function runBatch(clips) {
  if (S.busy || !clips.length || !S.file || !S.coreReady) return;
  S.cancelled = false;
  runStartedAt = Date.now();
  setBusyState(true);
  pause();
  const made = [];

  try {
    progress(0, t('msg.loadingVideo'));
    await ensureInput();

    for (let i = 0; i < clips.length; i++) {
      if (S.cancelled) break;
      if (F.needsRecycle()) await recycle();

      const many = clips.length > 1;
      const r = await encodeOne(jobFromClip(clips[i]), (p, label) => {
        progress((i + p) / clips.length, many ? `${label} (${i + 1}/${clips.length})` : label);
      });
      if (r) made.push(r);
    }

    if (S.cancelled) { toast(t('msg.cancelled'), 'warn'); return; }

    made.forEach(addResult);
    if (made.length > 1) await makeZip(made);
    renderResults();
    showTab('res');

    if (made.length === 1) {
      toast(t('msg.done', { name: made[0].name, size: fmtBytes(made[0].bytes) }), 'ok');
    } else if (made.length > 1) {
      toast(t('msg.doneAll', { n: made.length }), 'ok');
    }
  } catch (e) {
    if (S.cancelled || /terminated/i.test(String(e))) toast(t('msg.cancelled'), 'warn');
    else if (F.isFatal(e)) toast(t('msg.oom'), 'err');
    else toast(t('msg.failed', { why: String(e).slice(0, 120) }), 'err');
    if (F.isFatal(e)) { F.terminate(); S.inputWritten = false; }
  } finally {
    // 취소·오류로 워커가 죽었다면 되살려 둔다 (다음 굽기가 바로 되게)
    if (!F.isLoaded()) {
      S.inputWritten = false;
      try { await F.reload(); } catch (e) { S.coreReady = false; }
    }
    busy(false);
    setBusyState(false);
  }
}

/** 클립 하나. 목표 용량이 켜져 있으면 최대 3번까지 낮춰 가며 다시 굽는다. */
async function encodeOne(job, onProg) {
  const target = S.st.fitToSize ? Math.round(S.st.targetMB * 1024 * 1024) : 0;
  const tries = target ? MAX_TRIES : 1;
  let cur = { format: job.format, width: job.width, fps: job.fps, colors: job.colors, quality: job.quality, crf: job.crf };
  let best = null;
  let missed = false;
  let n = 0;

  while (n < tries) {
    if (S.cancelled) return null;
    n++;
    const j = { ...job, ...cur };
    const outName = 'out.' + P.FORMATS[j.format].ext;
    const base = (n - 1) / tries;
    const w = 1 / tries;

    const data = await runWithRetry(j, outName, (p, label) => {
      onProg(base + p * w, n > 1 ? t('msg.reencoding') : t(label));
    });

    if (!best || data.length < best.data.length) best = { data, cur: { ...cur } };
    if (!target || data.length <= target) { missed = false; break; }

    const next = P.nextAttempt(cur, data.length, target);
    missed = true;
    if (!next) break;
    cur = next;
  }

  if (!best) return null;
  onProg(1, t('msg.encoding'));

  const fmt = P.FORMATS[best.cur.format];
  const dims = F.outSize({ ...job, ...best.cur });
  return {
    name: `${S.baseName}_${job.start.toFixed(1)}-${job.end.toFixed(1)}.${fmt.ext}`,
    bytes: best.data.length,
    blob: new Blob([best.data], { type: fmt.mime }),
    w: dims.w, h: dims.h, fps: best.cur.fps,
    seconds: F.outDuration(job),
    missed: missed && target > 0,
    format: best.cur.format,
  };
}

/** 한 번 죽으면 워커를 갈아 끼우고 딱 한 번 더 해 본다 */
async function runWithRetry(job, outName, onProg) {
  try {
    return await F.encodeClip(job, S.inName, outName, onProg);
  } catch (e) {
    if (S.cancelled || !F.isFatal(e)) throw e;
    await recycle();
    if (S.cancelled) throw e;
    return await F.encodeClip(job, S.inName, outName, onProg);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 결과
// ═══════════════════════════════════════════════════════════════════════
function addResult(r) {
  r.url = URL.createObjectURL(r.blob);
  S.results.unshift(r);
}

async function makeZip(items) {
  if (typeof JSZip === 'undefined') return;
  progress(0.99, t('msg.zipping'));
  const zip = new JSZip();
  items.forEach(r => zip.file(r.name, r.blob));
  const blob = await zip.generateAsync({ type: 'blob' });
  S.results.unshift({
    name: `${S.baseName}_clips.zip`,
    bytes: blob.size, blob, url: null, isZip: true, count: items.length,
  });
}

function renderResults() {
  const list = $('#resList');
  list.innerHTML = '';
  $('#resEmpty').hidden = S.results.length > 0;
  $('#resFoot').hidden = S.results.length === 0;
  const badge = $('#resBadge');
  badge.hidden = S.results.length === 0;
  badge.textContent = String(S.results.length);

  S.results.forEach(r => {
    const el = document.createElement('div');
    el.className = 'res';

    if (!r.isZip) {
      const rv = document.createElement('div');
      rv.className = 'rv';
      if (r.format === 'mp4') {
        const v = document.createElement('video');
        v.src = r.url; v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true;
        rv.appendChild(v);
      } else {
        const im = document.createElement('img');
        im.src = r.url; im.alt = '';
        rv.appendChild(im);
      }
      el.appendChild(rv);
    }

    const rf = document.createElement('div');
    rf.className = 'rf';
    const nm = document.createElement('div');
    nm.className = 'rn';
    nm.textContent = r.name;
    rf.appendChild(nm);

    const meta = document.createElement('div');
    meta.className = 'rm';
    meta.textContent = r.isZip
      ? `${fmtBytes(r.bytes)} · ${r.count}`
      : `${fmtBytes(r.bytes)} · ${r.w}×${r.h} · ${r.fps}fps · ${r.seconds.toFixed(1)}s`;
    rf.appendChild(meta);

    if (r.missed) {
      const w = document.createElement('div');
      w.className = 'rm miss';
      w.textContent = t('res.miss');
      rf.appendChild(w);
    }

    const rb = document.createElement('div');
    rb.className = 'rb';
    const dl = document.createElement('button');
    dl.className = 'btn ' + (r.isZip ? 'accent' : 'primary');
    dl.textContent = t(r.isZip ? 'res.zip' : 'res.download');
    dl.addEventListener('click', () => download(r.blob, r.name));
    rb.appendChild(dl);

    const rm = document.createElement('button');
    rm.className = 'btn ghost x';
    rm.innerHTML = '&times;';
    rm.title = t('res.remove');
    rm.addEventListener('click', () => {
      if (r.url) URL.revokeObjectURL(r.url);
      S.results = S.results.filter(v => v !== r);
      renderResults();
    });
    rb.appendChild(rm);
    rf.appendChild(rb);

    el.appendChild(rf);
    list.appendChild(el);
  });
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

function saveStill() {
  const cv = grabStill();
  if (!cv) return;
  cv.toBlob(b => {
    if (!b) return;
    download(b, `${S.baseName}_${TL.vid.currentTime.toFixed(1)}.png`);
    toast(t('msg.stillSaved'), 'ok');
  }, 'image/png');
}

// ── 출발 ──
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

// 디버그용 (콘솔에서 상태를 들여다보거나 자동 시험에서 쓴다)
window.ClipBox = {
  S, TL, F, P, SPEEDS,
  setRange, seekTo, setCropEnabled, clearCrop, addClip, showTab, toast,
};
