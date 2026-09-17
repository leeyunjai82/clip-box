// ═══════════════════════════════════════════════════════════
// clip-box — 상태 · 파일 로드 · 클립 목록 · 굽기
// ═══════════════════════════════════════════════════════════
// 1원칙: 영상은 브라우저 밖으로 나가지 않는다.
// 이 파일에는 fetch() 로 바깥을 부르는 코드가 한 줄도 없다.
// (vendor/ 아래 코어·글꼴만 same-origin 으로 읽는다)

import { T, localizeDOM, mountLangToggle } from './i18n.js';
import * as P from './presets.js';
import * as F from './ffmpeg.js';
import {
  TL, initTimeline, setVideo, clearVideo, setRange, setCropEnabled, clearCrop,
  setRatio, cropForEncode, grabStill, fitVideo, drawTimeline, drawCropBox,
  fmtTime, fmtBytes, seekTo,
} from './timeline.js';

const $ = (id) => document.getElementById(id);
const BIG_FILE = 300 * 1024 * 1024;
const MAX_TRIES = 3;

const S = {
  file: null,
  url: null,
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
  proxyURL: null,
  usingProxy: false,
};

// ═══════════════════════════════════════════════════════════
// 시작
// ═══════════════════════════════════════════════════════════
function boot() {
  S.cur = { ...(S.presets.find(p => p.id === S.st.presetId) || S.presets[0]) };

  initTimeline({ onChange: onRangeChange, onTick: onTick });
  buildPresetButtons();
  buildDitherOptions();
  wireControls();
  wireFile();
  wireRun();
  applyUI();
  layout();
  window.addEventListener('resize', layout);

  localizeDOM();
  mountLangToggle();

  loadCore();

  window.addEventListener('beforeunload', (e) => {
    if (S.busy) { e.preventDefault(); e.returnValue = ''; }
  });
}

function layout() { fitVideo(); drawTimeline(); drawCropBox(); }

// ── 코어 로드 ──
async function loadCore() {
  const ov = $('coreOverlay');
  const fill = $('coreFill');
  const text = $('coreText');
  const title = $('coreTitle');
  const badge = $('coreBadge');
  const MB = (n) => (n / 1024 / 1024).toFixed(1);

  badge.textContent = T('코어 받는 중');
  try {
    await F.loadCore((p) => {
      if (p.phase === 'init') {
        title.textContent = T('코어 켜는 중');
        fill.style.width = '100%';
        text.textContent = p.cached ? '캐시에서 바로' : '';
        return;
      }
      if (p.phase === 'wasm') {
        const r = p.total > 0 ? p.loaded / p.total : 0;
        fill.style.width = (r * 100).toFixed(1) + '%';
        text.textContent = p.total > 0 ? `${MB(p.loaded)} / ${MB(p.total)} MB` : `${MB(p.loaded)} MB`;
      }
    });
    S.coreReady = true;
    badge.textContent = T('준비 완료');
    badge.classList.add('ok');
    ov.classList.add('off');
    refreshRunState();
  } catch (e) {
    title.textContent = T('코어를 불러오지 못했어요');
    text.textContent = T('새로고침해 주세요') + ' — ' + String(e).slice(0, 120);
    badge.textContent = T('코어를 불러오지 못했어요');
  }
}

// ═══════════════════════════════════════════════════════════
// 파일 불러오기
// ═══════════════════════════════════════════════════════════
function wireFile() {
  const input = $('fileInput');
  input.addEventListener('change', () => { if (input.files[0]) openFile(input.files[0]); input.value = ''; });
  $('reload').addEventListener('click', () => input.click());

  const drop = $('drop');
  let depth = 0;
  ['dragenter', 'dragover'].forEach(ev => {
    window.addEventListener(ev, (e) => {
      if (!e.dataTransfer || Array.from(e.dataTransfer.types || []).indexOf('Files') < 0) return;
      e.preventDefault();
      if (ev === 'dragenter') depth++;
      document.body.classList.add('dragging');
      if (e.target === drop || drop.contains(e.target)) drop.classList.add('over');
    });
  });
  ['dragleave', 'drop'].forEach(ev => {
    window.addEventListener(ev, (e) => {
      e.preventDefault();
      if (ev === 'dragleave') { depth--; if (depth > 0) return; }
      depth = 0;
      document.body.classList.remove('dragging');
      drop.classList.remove('over');
      if (ev === 'drop' && e.dataTransfer && e.dataTransfer.files[0]) openFile(e.dataTransfer.files[0]);
    });
  });

  // 로고
  $('logoInput').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (S.logoURL) URL.revokeObjectURL(S.logoURL);
    S.logo = f;
    S.logoURL = URL.createObjectURL(f);
    $('logoPrev').src = S.logoURL;
    $('logoName').textContent = f.name;
    $('logoRow').style.display = '';
    e.target.value = '';
    updateEstimate();
  });
  $('logoClear').addEventListener('click', () => {
    if (S.logoURL) URL.revokeObjectURL(S.logoURL);
    S.logo = null; S.logoURL = null;
    $('logoRow').style.display = 'none';
    updateEstimate();
  });
}

async function openFile(file) {
  if (S.busy) return;
  if (!/^video\//.test(file.type) && !/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name)) {
    alert(T('영상 파일이 아니에요'));
    return;
  }

  if (S.url) URL.revokeObjectURL(S.url);
  S.file = file;
  S.url = URL.createObjectURL(file);
  S.baseName = file.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'clip';
  S.inName = 'in' + (file.name.match(/\.[a-z0-9]+$/i) || ['.mp4'])[0].toLowerCase();
  S.inputWritten = false;
  S.clips = [];
  S.activeClip = null;
  S.seq = 0;
  renderClips();

  $('bigWarn').style.display = file.size > BIG_FILE ? '' : 'none';
  if (S.proxyURL) { URL.revokeObjectURL(S.proxyURL); S.proxyURL = null; }
  S.usingProxy = false;

  let meta = null;
  try {
    meta = await setVideo(S.url);
  } catch (e) {
    // 브라우저가 못 푸는 코덱(아이폰 HEVC 등). ffmpeg 으로 미리보기용 영상을 만든다.
    // 굽는 것은 언제나 원본이므로 화질은 그대로다.
    try {
      meta = await buildProxy();
    } catch (e2) {
      alert(T('영상을 읽지 못했어요. 다른 파일로 해 보세요') + '\n\n' + String(e2).slice(0, 160));
      clearVideo();
      $('proxyNote').style.display = 'none';
      return;
    }
  }

  $('proxyNote').style.display = S.usingProxy ? '' : 'none';
  $('fileInfo').style.display = '';
  $('fName').textContent = file.name;
  $('fDur').textContent = fmtTime(meta.duration) + 's';
  $('fSize').textContent = meta.w + ' × ' + meta.h;
  $('fBytes').textContent = fmtBytes(file.size);
  ['playBtn', 'homeBtn', 'loopBtn', 'inBtn', 'outBtn', 'cropToggle', 'stillBtn', 'addClip'].forEach(id => { $(id).disabled = false; });
  $('loopBtn').classList.toggle('on', TL.loop);
  layout();
  onRangeChange();
  refreshRunState();
}

/** 미리보기용 대역 영상(VP8/WebM)을 만들어 건다 */
async function buildProxy() {
  if (!S.coreReady) throw new Error(T('코어를 아직 못 불러왔어요'));
  setBusy(true);
  try {
    progress(0, '영상 올리는 중');
    await ensureInput();
    progress(0, '미리보기 만드는 중');
    const { data, info } = await F.makeProxy(S.inName, 'proxy.webm', 540, (r) => progress(r, '미리보기 만드는 중'));
    S.proxyURL = URL.createObjectURL(new Blob([data], { type: 'video/webm' }));
    S.usingProxy = true;
    progress(1, '다 됐어요');
    return await setVideo(S.proxyURL, { srcW: info.w, srcH: info.h, duration: info.duration });
  } finally {
    setBusy(false);
  }
}

// ═══════════════════════════════════════════════════════════
// 오른쪽 도구 — 값 ↔ 화면
// ═══════════════════════════════════════════════════════════
const SPEEDS = [0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4];

function buildPresetButtons() {
  const box = $('presetBtns');
  box.innerHTML = '';
  S.presets.forEach(p => {
    const b = document.createElement('button');
    b.className = 'pbtn' + (p.id === S.st.presetId ? ' on' : '');
    b.dataset.id = p.id;
    b.innerHTML = `<b><i class="fa-solid ${p.icon}"></i>${p.name}</b><span>${p.desc}</span>`;
    b.addEventListener('click', () => pickPreset(p.id));
    box.appendChild(b);
  });
  localizeDOM(box);   // 프리셋을 다시 그릴 때도 영어가 유지되게
}

function pickPreset(id) {
  const p = S.presets.find(x => x.id === id);
  if (!p) return;
  S.st.presetId = id;
  S.cur = { ...p };
  P.saveSettings(S.st);
  document.querySelectorAll('.pbtn').forEach(b => b.classList.toggle('on', b.dataset.id === id));
  // 카톡처럼 목표 용량이 박힌 프리셋은 '목표 용량 맞추기' 를 자동으로 켠다
  if (p.maxBytes > 0) { S.st.fitToSize = true; S.st.targetMB = p.maxBytes / 1024 / 1024; }
  applyUI();
}

function buildDitherOptions() {
  const sel = $('ditherSel');
  sel.innerHTML = '';
  P.DITHERS.forEach(d => {
    const o = document.createElement('option');
    o.value = d; o.textContent = d;
    sel.appendChild(o);
  });
}

function wireControls() {
  // 탭
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === t));
      document.querySelectorAll('.tp').forEach(s => s.classList.toggle('on', s.dataset.tab === t.dataset.tab));
    });
  });

  // 형식
  segment('fmtBtns', 'fmt', v => { S.cur.format = v; applyUI(); });

  // 슬라이더들
  slider('wRange', 'wOut', v => { S.cur.width = v; updateEstimate(); }, v => v + 'px');
  slider('fpsRange', 'fpsOut', v => { S.cur.fps = v; updateEstimate(); }, v => v + 'fps');
  slider('colRange', 'colOut', v => { S.cur.colors = v; updateEstimate(); });
  slider('qRange', 'qOut', v => { S.cur.quality = v; updateEstimate(); });
  slider('crfRange', 'crfOut', v => { S.cur.crf = v; updateEstimate(); });
  slider('spdRange', 'spdOut', i => { S.cur.speedIdx = i; updateEstimate(); }, i => SPEEDS[i] + '×');
  slider('fadeRange', 'fadeOut', v => { S.st.fade = v; saveSt(); }, v => v > 0 ? v.toFixed(1) + 's' : T('없음'), true);
  slider('tsRange', 'tsOut', v => { S.st.textSize = v; saveSt(); updateEstimate(); });
  slider('tpRange', 'tpOut', v => { S.st.textPad = v; saveSt(); });
  slider('lsRange', 'lsOut', v => { S.st.logoScale = v; saveSt(); }, v => v + '%');
  slider('lpRange', 'lpOut', v => { S.st.logoPad = v; saveSt(); });

  $('ditherSel').addEventListener('change', e => { S.cur.dither = e.target.value; });

  // 프리셋 저장/되돌리기
  $('presetSave').addEventListener('click', () => {
    const i = S.presets.findIndex(p => p.id === S.st.presetId);
    if (i < 0) return;
    S.presets[i] = { ...S.presets[i], ...S.cur };
    S.presets[i].desc = describePreset(S.presets[i]);
    P.savePresets(S.presets);
    buildPresetButtons();
    flash($('presetSave'), T('저장했어요'));
  });
  $('presetReset').addEventListener('click', () => {
    S.presets = P.resetPresets();
    buildPresetButtons();
    pickPreset(S.st.presetId);
    flash($('presetReset'), T('되돌렸어요'));
  });

  // 목표 용량
  $('fitChk').addEventListener('change', e => { S.st.fitToSize = e.target.checked; saveSt(); applyUI(); });
  $('targetMB').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (isFinite(v) && v > 0) { S.st.targetMB = v; saveSt(); updateEstimate(); }
  });

  // 크롭
  $('cropToggle').addEventListener('click', toggleCrop);
  $('cropToggle2').addEventListener('click', toggleCrop);
  $('cropClear').addEventListener('click', () => clearCrop());
  $('cropClear2').addEventListener('click', () => clearCrop());
  segment('ratioBtns', 'ratio', v => setRatio(v));

  // 방향 / 회전
  segment('dirBtns', 'dir', v => { S.cur.loop = v; updateEstimate(); });
  segment('rotBtns', 'rot', v => { S.st.rotate = v; saveSt(); updateEstimate(); });

  // 글자 / 로고 위치
  segment('textPosBtns', 'pos', v => { S.st.textPos = v; saveSt(); });
  segment('logoPosBtns', 'pos', v => { S.st.logoPos = v; saveSt(); });
  $('textInput').addEventListener('input', () => updateEstimate());

  // 클립
  $('addClip').addEventListener('click', addClip);
  $('encodeAll').addEventListener('click', () => runBatch(S.clips.slice()));

  // 스틸컷
  $('stillBtn').addEventListener('click', saveStill);
}

function segment(boxId, key, fn) {
  const box = $(boxId);
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-' + key + ']');
    if (!b) return;
    box.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    fn(b.dataset[key]);
  });
}

function slider(rangeId, outId, fn, fmt, isFloat) {
  const r = $(rangeId), o = $(outId);
  r.addEventListener('input', () => {
    const v = isFloat ? parseFloat(r.value) : parseInt(r.value, 10);
    o.textContent = fmt ? fmt(v) : String(v);
    fn(v);
  });
}

function saveSt() { P.saveSettings(S.st); }

function flash(btn, msg) {
  const old = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-check"></i> ' + msg;
  setTimeout(() => { btn.innerHTML = old; }, 1100);
}

function describePreset(p) {
  const f = P.FORMATS[p.format];
  // 한/영 어느 쪽에서도 그대로 읽히도록 기호만 쓴다
  return `${p.width}px · ${p.fps}fps · ${f.label}` + (p.maxBytes ? ` · ≤${Math.round(p.maxBytes / 1024 / 1024)}MB` : '');
}

/** 상태 → 화면 */
function applyUI() {
  const c = S.cur, st = S.st;
  if (c.speedIdx == null) c.speedIdx = SPEEDS.indexOf(1);
  if (!c.loop) c.loop = 'normal';

  const f = P.FORMATS[c.format];
  document.querySelectorAll('#fmtBtns button').forEach(b => b.classList.toggle('on', b.dataset.fmt === c.format));
  setSlider('wRange', 'wOut', c.width, v => v + 'px');
  setSlider('fpsRange', 'fpsOut', c.fps, v => v + 'fps');
  setSlider('colRange', 'colOut', c.colors);
  setSlider('qRange', 'qOut', c.quality);
  setSlider('crfRange', 'crfOut', c.crf);
  setSlider('spdRange', 'spdOut', c.speedIdx, i => SPEEDS[i] + '×');
  setSlider('fadeRange', 'fadeOut', st.fade, v => v > 0 ? v.toFixed(1) + 's' : T('없음'));
  setSlider('tsRange', 'tsOut', st.textSize);
  setSlider('tpRange', 'tpOut', st.textPad);
  setSlider('lsRange', 'lsOut', st.logoScale, v => v + '%');
  setSlider('lpRange', 'lpOut', st.logoPad);
  $('ditherSel').value = c.dither;

  $('fldColors').classList.toggle('off', !f.hasColors);
  $('fldDither').classList.toggle('off', !f.hasDither);
  $('fldQuality').classList.toggle('off', !f.hasQuality);
  $('fldCrf').classList.toggle('off', !f.hasCrf);

  $('fitChk').checked = !!st.fitToSize;
  $('targetMB').value = st.targetMB;
  $('fldTarget').classList.toggle('off', !st.fitToSize);

  document.querySelectorAll('#dirBtns button').forEach(b => b.classList.toggle('on', b.dataset.dir === c.loop));
  document.querySelectorAll('#rotBtns button').forEach(b => b.classList.toggle('on', b.dataset.rot === String(st.rotate)));
  document.querySelectorAll('#textPosBtns button').forEach(b => b.classList.toggle('on', b.dataset.pos === st.textPos));
  document.querySelectorAll('#logoPosBtns button').forEach(b => b.classList.toggle('on', b.dataset.pos === st.logoPos));

  updateEstimate();
}

function setSlider(rangeId, outId, val, fmt) {
  const r = $(rangeId), o = $(outId);
  r.value = val;
  o.textContent = fmt ? fmt(val) : String(val);
}

function toggleCrop() {
  const on = !TL.cropOn;
  setCropEnabled(on);
  const label = on ? T('크롭 끄기') : T('크롭 켜기');
  $('cropToggle').classList.toggle('on', on);
  $('cropToggle2').classList.toggle('on', on);
  $('cropToggle2').innerHTML = `<i class="fa-solid fa-crop-simple"></i> ${label}`;
  $('cropToggle').title = label;
}

// ═══════════════════════════════════════════════════════════
// 지금 화면의 설정으로 job 만들기
// ═══════════════════════════════════════════════════════════
function currentJob(over) {
  const c = S.cur, st = S.st;
  const rot = st.rotate === 'auto' ? 'auto' : parseInt(st.rotate, 10);
  const job = {
    start: TL.start, end: TL.end,
    speed: SPEEDS[c.speedIdx == null ? SPEEDS.indexOf(1) : c.speedIdx],
    loop: c.loop || 'normal',
    crop: cropForEncode(),
    rotate: rot,
    fps: c.fps, width: c.width, format: c.format,
    colors: c.colors, dither: c.dither, quality: c.quality, crf: c.crf,
    text: $('textInput').value.trim(),
    textPos: st.textPos, textSize: st.textSize, textPad: st.textPad,
    logo: S.logo, logoPos: st.logoPos, logoScale: st.logoScale, logoPad: st.logoPad,
    fade: st.fade,
    srcW: TL.srcW, srcH: TL.srcH,
  };
  return Object.assign(job, over || {});
}

function jobFromClip(clip) {
  return currentJob({ start: clip.start, end: clip.end, crop: clip.crop, speed: clip.speed, loop: clip.loop });
}

function onRangeChange() {
  if (!TL.duration) return;
  $('rIn').textContent = fmtTime(TL.start);
  $('rOut').textContent = fmtTime(TL.end);
  $('rLen').textContent = (TL.end - TL.start).toFixed(1) + 's';
  $('tTotal').textContent = fmtTime(TL.duration);
  const c = cropForEncode();
  $('cropInfo').textContent = c ? `${c.w} × ${c.h}` : T('전체');
  updateEstimate();
}

function onTick(t) { $('tCur').textContent = fmtTime(t); }

function updateEstimate() {
  if (!TL.duration) { $('rEst').textContent = '—'; return; }
  const job = currentJob();
  const d = F.outSize(job);
  const secs = (job.end - job.start) / job.speed;
  const bytes = P.estimateBytes({
    format: job.format, width: d.w, height: d.h, fps: job.fps, seconds: secs,
    colors: job.colors, quality: job.quality, crf: job.crf, pingpong: job.loop === 'pingpong',
  });
  // '≈' 로 어림값임을 알린다 (한/영 공통)
  $('rEst').textContent = `≈ ${fmtBytes(bytes)} · ${d.w}×${d.h}`;
  refreshRunState();
}

function refreshRunState() {
  const ok = S.coreReady && !!S.file && TL.end - TL.start >= 0.1 && !S.busy;
  $('runBtn').disabled = !ok;
  $('encodeAll').disabled = !(S.coreReady && S.clips.length && !S.busy);
  $('addClip').disabled = !(S.file && !S.busy);
  const hint = $('runHint');
  if (S.busy) hint.textContent = '';
  else if (!S.file) hint.textContent = T('먼저 영상을 불러오세요');
  else if (!S.coreReady) hint.textContent = T('코어를 아직 못 불러왔어요');
  else if (TL.end - TL.start < 0.1) hint.textContent = T('구간이 너무 짧아요');
  else hint.textContent = T('I = 시작, O = 끝, Space = 재생/멈춤, ← → = 한 프레임');
}

// ═══════════════════════════════════════════════════════════
// 클립 목록
// ═══════════════════════════════════════════════════════════
function addClip() {
  if (!S.file || TL.end - TL.start < 0.1) return;
  const c = S.cur;
  S.clips.push({
    id: ++S.seq,
    start: TL.start, end: TL.end,
    crop: cropForEncode(),
    speed: SPEEDS[c.speedIdx == null ? SPEEDS.indexOf(1) : c.speedIdx],
    loop: c.loop || 'normal',
  });
  renderClips();
}

function renderClips() {
  const box = $('clipList');
  box.innerHTML = '';
  $('clipCnt').textContent = S.clips.length;
  $('clipHint').style.display = S.clips.length ? 'none' : '';
  S.clips.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'clip' + (S.activeClip === c.id ? ' on' : '');
    const bits = [];
    if (c.crop) bits.push(`${c.crop.w}×${c.crop.h}`);
    if (c.speed !== 1) bits.push(c.speed + '×');
    if (c.loop === 'reverse') bits.push(T('역재생'));
    if (c.loop === 'pingpong') bits.push('↔');
    el.innerHTML =
      `<span class="no">${i + 1}</span>` +
      `<span class="meta"><span class="rg">${fmtTime(c.start)} → ${fmtTime(c.end)}</span>` +
      `<span class="sub">${(c.end - c.start).toFixed(1)}s${bits.length ? ' · ' + bits.join(' · ') : ''}</span></span>` +
      `<button class="x" title="${T('이 클립 지우기')}"><i class="fa-solid fa-xmark"></i></button>`;
    el.addEventListener('click', (e) => {
      if (e.target.closest('.x')) {
        S.clips = S.clips.filter(x => x.id !== c.id);
        renderClips();
        return;
      }
      S.activeClip = c.id;
      TL.crop = c.crop ? { ...c.crop } : null;
      setCropEnabled(!!c.crop);
      $('cropToggle').classList.toggle('on', !!c.crop);
      $('cropToggle2').classList.toggle('on', !!c.crop);
      S.cur.speedIdx = Math.max(0, SPEEDS.indexOf(c.speed));
      S.cur.loop = c.loop;
      applyUI();
      setRange(c.start, c.end);
      renderClips();
    });
    box.appendChild(el);
  });
  refreshRunState();
}

// ═══════════════════════════════════════════════════════════
// 굽기
// ═══════════════════════════════════════════════════════════
function wireRun() {
  $('runBtn').addEventListener('click', () => runBatch([{
    id: 0, start: TL.start, end: TL.end, crop: cropForEncode(),
    speed: SPEEDS[S.cur.speedIdx == null ? SPEEDS.indexOf(1) : S.cur.speedIdx],
    loop: S.cur.loop || 'normal',
  }]));
  $('cancelBtn').addEventListener('click', cancel);
}

function setBusy(on) {
  S.busy = on;
  $('prg').style.display = on ? '' : 'none';
  $('cancelBtn').style.display = on ? '' : 'none';
  $('runBtn').style.display = on ? 'none' : '';
  document.querySelectorAll('#panL .db, #panR .tab, #panR .pbtn, #panR .inp, #panR .rng, #panR .db, #playbar .db, #cropBar .db')
    .forEach(el => { if (el.id !== 'cancelBtn') el.disabled = on; });
  if (!on) refreshRunState();
}

function progress(r, label) {
  $('prgFill').style.width = (Math.max(0, Math.min(1, r)) * 100).toFixed(1) + '%';
  $('prgPct').textContent = Math.round(Math.max(0, Math.min(1, r)) * 100) + '%';
  if (label) $('prgLabel').textContent = T(label);
}

function cancel() {
  S.cancelled = true;
  F.terminate();
  S.inputWritten = false;
  progress(0, '취소했어요');
}

/** 원본을 가상 FS 에 올린다 (한 번만) */
async function ensureInput() {
  if (S.inputWritten) return;
  progress(0, '영상 올리는 중');
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
  setBusy(true);
  TL.vid.pause();
  const made = [];

  try {
    await ensureInput();

    for (let i = 0; i < clips.length; i++) {
      if (S.cancelled) break;
      if (F.needsRecycle()) await recycle();

      const clip = clips[i];
      const span = (n) => (i + n) / clips.length;
      const r = await encodeOne(jobFromClip(clip), (p, label) => {
        progress(span(p), clips.length > 1 ? `${T(label)} (${i + 1}/${clips.length})` : label);
      });
      if (r) made.push(r);
    }

    if (S.cancelled) { progress(0, '취소했어요'); return; }

    made.forEach(addResult);
    if (made.length > 1) await makeZip(made);
    progress(1, '다 됐어요');
    showTab('res');
  } catch (e) {
    const fatal = F.isFatal(e);
    if (String(e).indexOf('terminated') >= 0 || S.cancelled) progress(0, '취소했어요');
    else {
      progress(0, '실패했어요');
      alert(T('실패했어요') + '\n\n' + (fatal ? T('메모리가 모자랐어요. 구간을 짧게 하거나 가로 크기를 줄여 보세요.') : String(e)));
    }
    if (fatal) { F.terminate(); S.inputWritten = false; await F.reload().catch(() => {}); }
  } finally {
    // 취소했다면 워커가 죽어 있으니 되살려 둔다 (다음 굽기가 바로 되게)
    if (!F.isLoaded()) { S.inputWritten = false; await F.reload().catch(() => {}); }
    setBusy(false);
  }
}

/**
 * 클립 하나를 굽는다. 목표 용량이 켜져 있으면 최대 3번까지 낮춰 가며 다시 굽는다.
 */
async function encodeOne(job, onProg) {
  const target = S.st.fitToSize ? Math.round(S.st.targetMB * 1024 * 1024) : 0;
  let cur = { format: job.format, width: job.width, fps: job.fps, colors: job.colors, quality: job.quality, crf: job.crf };
  let best = null;
  let tries = 0;
  let missed = false;

  while (tries < (target ? MAX_TRIES : 1)) {
    if (S.cancelled) return null;
    tries++;
    const j = { ...job, ...cur };
    const outName = 'out.' + P.FORMATS[j.format].ext;

    let data;
    try {
      data = await runWithRetry(j, outName, (p, label) => {
        const base = (tries - 1) / (target ? MAX_TRIES : 1);
        const w = 1 / (target ? MAX_TRIES : 1);
        onProg(target ? base + p * w : p, tries > 1 ? '다시 굽는 중' : label);
      });
    } catch (e) {
      if (S.cancelled) return null;
      throw e;
    }

    if (!best || data.length < best.data.length) best = { data, cur: { ...cur } };
    if (!target || data.length <= target) { missed = false; break; }

    const next = P.nextAttempt(cur, data.length, target);
    if (!next) { missed = true; break; }
    cur = next;
    missed = true;
  }

  if (!best) return null;
  onProg(1, '다 됐어요');

  const fmt = P.FORMATS[best.cur.format];
  const dims = F.outSize({ ...job, ...best.cur });
  const name = `${S.baseName}_${job.start.toFixed(1)}-${job.end.toFixed(1)}.${fmt.ext}`;
  return {
    name, bytes: best.data.length, mime: fmt.mime,
    blob: new Blob([best.data], { type: fmt.mime }),
    w: dims.w, h: dims.h, fps: best.cur.fps,
    seconds: F.outDuration(job),
    missed: missed && target > 0,
    format: best.cur.format,
  };
}

/** 한 번 실패하면 워커를 갈아 끼우고 딱 한 번 더 해 본다 */
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

// ═══════════════════════════════════════════════════════════
// 결과
// ═══════════════════════════════════════════════════════════
function showTab(name) {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x.dataset.tab === name));
  document.querySelectorAll('.tp').forEach(s => s.classList.toggle('on', s.dataset.tab === name));
}

function addResult(r) {
  r.url = URL.createObjectURL(r.blob);
  S.results.unshift(r);
  $('resEmpty').style.display = 'none';

  const el = document.createElement('div');
  el.className = 'res';
  const view = r.format === 'mp4'
    ? `<video src="${r.url}" autoplay loop muted playsinline></video>`
    : `<img src="${r.url}" alt="">`;
  el.innerHTML =
    `<div class="rv">${view}</div>` +
    `<div class="rf">` +
    `<div class="rn">${r.name}</div>` +
    `<div class="rm">${fmtBytes(r.bytes)} · ${r.w}×${r.h} · ${r.fps}fps · ${r.seconds.toFixed(1)}s</div>` +
    (r.missed ? `<div class="rm miss"><i class="fa-solid fa-triangle-exclamation"></i> ${T('목표 용량을 못 맞췄어요. 가장 작게 나온 결과입니다.')}</div>` : '') +
    `<div class="rb2"><button class="db go sm"><i class="fa-solid fa-download"></i> ${T('내려받기')}</button></div>` +
    `</div>`;
  el.querySelector('button').addEventListener('click', () => download(r.blob, r.name));
  $('resList').prepend(el);
}

async function makeZip(items) {
  if (typeof JSZip === 'undefined') return;
  progress(0.99, '묶는 중');
  const zip = new JSZip();
  items.forEach(r => zip.file(r.name, r.blob));
  const blob = await zip.generateAsync({ type: 'blob' });
  const name = `${S.baseName}_clips.zip`;
  const el = document.createElement('div');
  el.className = 'res';
  el.innerHTML =
    `<div class="rf"><div class="rn"><i class="fa-solid fa-file-zipper"></i> ${name}</div>` +
    `<div class="rm">${fmtBytes(blob.size)} · ${T('클립')} ${items.length}</div>` +
    `<div class="rb2"><button class="db go sm"><i class="fa-solid fa-download"></i> ${T('모두 내려받기 (ZIP)')}</button></div></div>`;
  el.querySelector('button').addEventListener('click', () => download(blob, name));
  $('resEmpty').style.display = 'none';
  $('resList').prepend(el);
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
    if (b) download(b, `${S.baseName}_${TL.vid.currentTime.toFixed(1)}.png`);
  }, 'image/png');
}

// ── 출발 ──
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

// 디버그용 (콘솔에서 상태를 들여다보거나 자동 테스트에서 쓴다)
window.__clipbox = { S, TL, F, P, setRange, seekTo, setCropEnabled, clearCrop };
