// ═══════════════════════════════════════════════════════════
// 플레이어 + 타임라인(구간 드래그) + 크롭 박스
// ═══════════════════════════════════════════════════════════
// · 좌표의 기준은 언제나 <video> 가 실제로 보여 주는 그림이다.
//   회전 메타데이터가 붙은 폰 영상은 브라우저가 이미 돌려서 보여 주고,
//   ffmpeg 도 기본으로 같은 방향으로 돌리므로 크롭 좌표가 서로 맞는다.
// · 크롭 값은 '영상 픽셀' 로 들고 있는다 (화면 크기가 바뀌어도 안 흔들린다).

const $ = (id) => document.getElementById(id);

const FRAME = 1 / 30;   // ←/→ 한 번에 움직일 시간 (원본 fps 를 알 수 없어 30fps 로 가정)

export const TL = {
  vid: null,
  duration: 0,
  start: 0,
  end: 0,
  srcW: 0,
  srcH: 0,
  crop: null,           // {x,y,w,h} — 영상 픽셀
  cropOn: false,
  ratio: 'free',
  loop: true,
  onChange: null,       // 구간·크롭이 바뀔 때
  onTick: null,         // 재생 위치가 바뀔 때
  _raf: 0,
  _thumbURL: null,
};

// ── 도우미 ──
export function fmtTime(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export function fmtBytes(n) {
  if (!n || n < 0) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 2 : 1) + ' MB';
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ═══════════════════════════════════════════════════════════
// 초기화
// ═══════════════════════════════════════════════════════════
export function initTimeline({ onChange, onTick }) {
  TL.vid = $('vid');
  TL.onChange = onChange;
  TL.onTick = onTick;

  wireTimeline();
  wireCrop();
  wirePlayback();
  wireKeys();

  window.addEventListener('resize', () => { drawTimeline(); drawCropBox(); redrawThumbs(); });
  return TL;
}

/**
 * 새 영상을 걸고 구간을 초기화한다.
 * over = { srcW, srcH, duration } — 미리보기용 대역 영상을 걸 때 쓴다.
 *   (대역 영상은 작게 줄여 놓았으므로, 크롭 좌표의 기준이 되는 크기는
 *    원본에서 읽은 값으로 덮어써야 한다)
 */
export async function setVideo(url, over) {
  const v = TL.vid;
  TL._thumbURL = url;
  v.src = url;
  v.currentTime = 0;

  await new Promise((res, rej) => {
    const ok = () => { cleanup(); res(); };
    const no = () => { cleanup(); rej(new Error('메타데이터를 읽지 못했어요')); };
    const cleanup = () => {
      v.removeEventListener('loadeddata', ok);
      v.removeEventListener('error', no);
      clearTimeout(timer);
    };
    // loadedmetadata 만으로는 부족하다 — 컨테이너는 읽히는데 코덱을 못 푸는
    // 파일(아이폰 HEVC 등)이 있어서, 실제 그림이 한 장 나오는지까지 본다.
    v.addEventListener('loadeddata', ok, { once: true });
    v.addEventListener('error', no, { once: true });
    const timer = setTimeout(() => { cleanup(); rej(new Error('영상을 풀지 못했어요')); }, 12000);
  });

  if (!v.videoWidth || !v.videoHeight) throw new Error('영상을 풀지 못했어요');

  // 일부 WebM/MOV 는 loadedmetadata 때 duration 이 Infinity 다. 한 번 흔들어 깨운다.
  if (!isFinite(v.duration) || v.duration <= 0) {
    await new Promise((res) => {
      const done = () => { v.removeEventListener('durationchange', done); res(); };
      v.addEventListener('durationchange', done);
      v.currentTime = 1e7;
      setTimeout(done, 1500);
    });
    v.currentTime = 0;
  }

  TL.duration = isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
  TL.srcW = v.videoWidth;
  TL.srcH = v.videoHeight;
  if (over) {
    if (over.srcW > 0 && over.srcH > 0) { TL.srcW = over.srcW; TL.srcH = over.srcH; }
    if (over.duration > 0) TL.duration = over.duration;
  }
  TL.start = 0;
  TL.end = Math.min(TL.duration, 5);          // 처음엔 5초 구간을 잡아 둔다
  TL.crop = null;
  TL.cropOn = false;
  $('cropLayer').style.display = 'none';
  $('cropBar').style.display = 'none';
  $('videoWrap').classList.add('on');
  $('stageEmpty').style.display = 'none';

  fitVideo();
  drawTimeline();
  buildThumbs().catch(() => {});
  emit();
  return { duration: TL.duration, w: TL.srcW, h: TL.srcH };
}

export function clearVideo() {
  const v = TL.vid;
  v.pause();
  v.removeAttribute('src');
  v.load();
  TL.duration = 0; TL.start = 0; TL.end = 0; TL.crop = null; TL.cropOn = false;
  $('videoWrap').classList.remove('on');
  $('stageEmpty').style.display = '';
  $('cropLayer').style.display = 'none';
  $('cropBar').style.display = 'none';
}

function emit() { TL.onChange && TL.onChange(); }

/** <video> 를 무대 크기에 맞춘다 (비율 유지, 확대는 하지 않는다) */
function fitVideo() {
  const stage = $('stage');
  const wrap = $('videoWrap');
  if (!TL.srcW || !TL.srcH || !stage) return;
  const pad = 16;
  const aw = Math.max(80, stage.clientWidth - pad);
  const ah = Math.max(80, stage.clientHeight - pad);
  const k = Math.min(aw / TL.srcW, ah / TL.srcH, 4);
  const w = Math.round(TL.srcW * k);
  const h = Math.round(TL.srcH * k);
  wrap.style.width = w + 'px';
  wrap.style.height = h + 'px';
  TL.vid.style.width = w + 'px';
  TL.vid.style.height = h + 'px';
}

// ═══════════════════════════════════════════════════════════
// 재생
// ═══════════════════════════════════════════════════════════
function wirePlayback() {
  const v = TL.vid;

  $('playBtn').addEventListener('click', togglePlay);
  $('homeBtn').addEventListener('click', () => { seekTo(TL.start); });
  $('loopBtn').addEventListener('click', () => {
    TL.loop = !TL.loop;
    $('loopBtn').classList.toggle('on', TL.loop);
  });
  $('inBtn').addEventListener('click', () => setIn(v.currentTime));
  $('outBtn').addEventListener('click', () => setOut(v.currentTime));

  v.addEventListener('play', () => { setPlayIcon(true); tick(); });
  v.addEventListener('pause', () => { setPlayIcon(false); });
  v.addEventListener('ended', () => { setPlayIcon(false); });
}

function setPlayIcon(on) {
  const b = $('playBtn');
  b.innerHTML = on ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
  b.title = on ? '멈춤' : '재생';
}

export function togglePlay() {
  const v = TL.vid;
  if (!v.src) return;
  if (v.paused) {
    if (TL.loop && (v.currentTime < TL.start - 0.05 || v.currentTime >= TL.end - 0.02)) v.currentTime = TL.start;
    v.play().catch(() => {});
  } else v.pause();
}

function tick() {
  cancelAnimationFrame(TL._raf);
  const v = TL.vid;
  const step = () => {
    // 구간만 반복 재생
    if (TL.loop && TL.end > TL.start) {
      if (v.currentTime >= TL.end - 0.01) v.currentTime = TL.start;
      else if (v.currentTime < TL.start - 0.2) v.currentTime = TL.start;
    }
    drawPlayhead();
    TL.onTick && TL.onTick(v.currentTime);
    if (!v.paused) TL._raf = requestAnimationFrame(step);
  };
  step();
}

export function seekTo(t) {
  const v = TL.vid;
  if (!v.src) return;
  v.currentTime = clamp(t, 0, Math.max(0, TL.duration - 0.001));
  drawPlayhead();
  TL.onTick && TL.onTick(v.currentTime);
}

export function setIn(t) {
  TL.start = clamp(t, 0, Math.max(0, TL.duration - 0.1));
  if (TL.end < TL.start + 0.1) TL.end = Math.min(TL.duration, TL.start + 0.1);
  drawTimeline(); emit();
}

export function setOut(t) {
  TL.end = clamp(t, 0.1, TL.duration);
  if (TL.start > TL.end - 0.1) TL.start = Math.max(0, TL.end - 0.1);
  drawTimeline(); emit();
}

export function setRange(a, b) {
  TL.start = clamp(Math.min(a, b), 0, TL.duration);
  TL.end = clamp(Math.max(a, b), 0, TL.duration);
  if (TL.end - TL.start < 0.1) TL.end = Math.min(TL.duration, TL.start + 0.1);
  drawTimeline(); emit();
  seekTo(TL.start);
}

// ═══════════════════════════════════════════════════════════
// 타임라인 바
// ═══════════════════════════════════════════════════════════
function trackRect() { return $('tlTrack').getBoundingClientRect(); }
const xToT = (x) => { const r = trackRect(); return clamp((x - r.left) / Math.max(1, r.width), 0, 1) * TL.duration; };
const tToPct = (t) => (TL.duration > 0 ? clamp(t / TL.duration, 0, 1) * 100 : 0);

function drawTimeline() {
  if (!TL.duration) return;
  const a = tToPct(TL.start), b = tToPct(TL.end);
  $('tlDim1').style.left = '0%'; $('tlDim1').style.width = a + '%';
  $('tlDim2').style.left = b + '%'; $('tlDim2').style.width = (100 - b) + '%';
  $('tlSel').style.left = a + '%'; $('tlSel').style.width = (b - a) + '%';
  $('tlHIn').style.left = a + '%';
  $('tlHOut').style.left = b + '%';
  drawPlayhead();
}

function drawPlayhead() {
  if (!TL.duration) return;
  $('tlPlay').style.left = tToPct(TL.vid.currentTime) + '%';
}

function wireTimeline() {
  const track = $('tlTrack');
  let mode = null;

  const down = (e, m) => {
    if (!TL.duration) return;
    mode = m;
    e.preventDefault();
    e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId);
    move(e);
  };

  const move = (e) => {
    if (!mode) return;
    const t = xToT(e.clientX);
    if (mode === 'in') { TL.start = clamp(t, 0, TL.end - 0.1); seekTo(TL.start); }
    else if (mode === 'out') { TL.end = clamp(t, TL.start + 0.1, TL.duration); seekTo(TL.end); }
    else { seekTo(t); }
    drawTimeline();
    if (mode !== 'scrub') emit();
  };

  const up = () => { if (mode) { mode = null; emit(); } };

  $('tlHIn').addEventListener('pointerdown', (e) => { e.stopPropagation(); down(e, 'in'); });
  $('tlHOut').addEventListener('pointerdown', (e) => { e.stopPropagation(); down(e, 'out'); });
  track.addEventListener('pointerdown', (e) => down(e, 'scrub'));
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

// ── 필름스트립 ──
async function buildThumbs() {
  const cv = $('tlThumbs');
  const track = $('tlTrack');
  const W = Math.max(40, Math.round(track.clientWidth));
  const H = 46;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#E7EEF1';
  ctx.fillRect(0, 0, W, H);
  if (!TL.duration || !TL._thumbURL) return;

  const n = clamp(Math.round(W / 64), 5, 20);
  const tw = W / n;

  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.src = TL._thumbURL;
  try {
    await new Promise((res, rej) => {
      v.addEventListener('loadeddata', res, { once: true });
      v.addEventListener('error', rej, { once: true });
      setTimeout(rej, 8000);
    });
  } catch (e) { return; }

  const sw = v.videoWidth, sh = v.videoHeight;
  if (!sw || !sh) return;
  // 가운데를 잘라 칸을 채운다 (cover)
  const k = Math.max(tw / sw, H / sh);
  const cw = tw / k, ch = H / k;
  const cx = (sw - cw) / 2, cy = (sh - ch) / 2;

  for (let i = 0; i < n; i++) {
    const t = TL.duration * (i + 0.5) / n;
    try {
      await new Promise((res, rej) => {
        v.addEventListener('seeked', res, { once: true });
        v.addEventListener('error', rej, { once: true });
        setTimeout(res, 1200);
        v.currentTime = Math.min(t, Math.max(0, TL.duration - 0.05));
      });
      ctx.drawImage(v, cx, cy, cw, ch, i * tw, 0, tw + 0.5, H);
    } catch (e) { break; }
  }
  v.removeAttribute('src'); v.load();
  TL._thumbsDone = true;
}

let redrawTimer = 0;
function redrawThumbs() {
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(() => { if (TL.duration) buildThumbs().catch(() => {}); }, 260);
}

// ═══════════════════════════════════════════════════════════
// 크롭 박스
// ═══════════════════════════════════════════════════════════
export function setCropEnabled(on) {
  TL.cropOn = !!on;
  $('cropLayer').style.display = TL.cropOn ? '' : 'none';
  $('cropBar').style.display = TL.cropOn ? '' : 'none';
  if (TL.cropOn && !TL.crop) defaultCrop();
  drawCropBox();
  emit();
}

export function clearCrop() {
  TL.crop = null;
  defaultCrop();
  drawCropBox();
  emit();
}

export function setRatio(r) {
  TL.ratio = r;
  if (TL.crop && r !== 'free') {
    const ratio = parseFloat(r);
    // 넓이는 두고 높이를 맞춘다. 넘치면 넓이를 줄인다.
    let w = TL.crop.w, h = w / ratio;
    if (h > TL.srcH) { h = TL.srcH; w = h * ratio; }
    TL.crop.w = w; TL.crop.h = h;
    TL.crop.x = clamp(TL.crop.x, 0, TL.srcW - w);
    TL.crop.y = clamp(TL.crop.y, 0, TL.srcH - h);
    drawCropBox(); emit();
  }
}

function defaultCrop() {
  if (!TL.srcW) return;
  const r = TL.ratio === 'free' ? null : parseFloat(TL.ratio);
  let w, h;
  if (r) {
    w = Math.min(TL.srcW, TL.srcH * r);
    h = w / r;
  } else {
    w = TL.srcW * 0.7; h = TL.srcH * 0.7;
  }
  TL.crop = { x: (TL.srcW - w) / 2, y: (TL.srcH - h) / 2, w, h };
}

/** 화면 px ↔ 영상 px */
function scaleFactor() {
  const wrap = $('videoWrap');
  return TL.srcW > 0 ? wrap.clientWidth / TL.srcW : 1;
}

function drawCropBox() {
  const box = $('cropBox');
  if (!TL.crop || !TL.srcW) { box.style.display = 'none'; return; }
  const k = scaleFactor();
  box.style.display = '';
  box.style.left = (TL.crop.x * k) + 'px';
  box.style.top = (TL.crop.y * k) + 'px';
  box.style.width = (TL.crop.w * k) + 'px';
  box.style.height = (TL.crop.h * k) + 'px';
  $('cropSz').textContent = `${Math.round(TL.crop.w)} × ${Math.round(TL.crop.h)}`;
}

function wireCrop() {
  const layer = $('cropLayer');
  const box = $('cropBox');
  let drag = null;

  const toVid = (e) => {
    const r = layer.getBoundingClientRect();
    const k = scaleFactor();
    return { x: clamp((e.clientX - r.left) / k, 0, TL.srcW), y: clamp((e.clientY - r.top) / k, 0, TL.srcH) };
  };

  const startDrag = (e, kind) => {
    if (!TL.srcW) return;
    e.preventDefault();
    e.stopPropagation();
    layer.setPointerCapture && layer.setPointerCapture(e.pointerId);
    drag = { kind, from: toVid(e), orig: TL.crop ? { ...TL.crop } : null };
    if (kind === 'new') {
      TL.crop = { x: drag.from.x, y: drag.from.y, w: 1, h: 1 };
      drag.orig = { ...TL.crop };
    }
  };

  box.addEventListener('pointerdown', (e) => startDrag(e, 'move'));
  box.querySelectorAll('.ch').forEach(h => {
    const kind = Array.from(h.classList).find(c => c !== 'ch');
    h.addEventListener('pointerdown', (e) => startDrag(e, kind));
  });
  layer.addEventListener('pointerdown', (e) => { if (e.target === layer) startDrag(e, 'new'); });

  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = toVid(e);
    const o = drag.orig;
    const r = TL.ratio === 'free' ? null : parseFloat(TL.ratio);

    if (drag.kind === 'move') {
      TL.crop.x = clamp(o.x + (p.x - drag.from.x), 0, TL.srcW - o.w);
      TL.crop.y = clamp(o.y + (p.y - drag.from.y), 0, TL.srcH - o.h);
    } else if (drag.kind === 'new') {
      let x1 = Math.min(drag.from.x, p.x), y1 = Math.min(drag.from.y, p.y);
      let w = Math.abs(p.x - drag.from.x), h = Math.abs(p.y - drag.from.y);
      if (r) { h = w / r; if (y1 + h > TL.srcH) { h = TL.srcH - y1; w = h * r; } }
      TL.crop = { x: x1, y: y1, w: Math.max(8, w), h: Math.max(8, h) };
    } else {
      // 모서리·변 손잡이
      let { x, y, w, h } = o;
      const k = drag.kind;
      if (k.includes('w')) { const nx = clamp(p.x, 0, x + w - 8); w = x + w - nx; x = nx; }
      if (k.includes('e')) { w = clamp(p.x - x, 8, TL.srcW - x); }
      if (k.includes('n')) { const ny = clamp(p.y, 0, y + h - 8); h = y + h - ny; y = ny; }
      if (k.includes('s')) { h = clamp(p.y - y, 8, TL.srcH - y); }
      if (r) {
        // 비율 고정 — 가로를 기준으로 세로를 맞춘다 (n/s 만 잡으면 반대로)
        if (k === 'n' || k === 's') { const nw = h * r; x = clamp(x + (w - nw) / 2, 0, TL.srcW - nw); w = nw; }
        else { const nh = w / r; if (k.includes('n')) y = y + h - nh; h = nh; }
        if (y < 0) { y = 0; }
        if (y + h > TL.srcH) { h = TL.srcH - y; w = h * r; }
        if (x + w > TL.srcW) { w = TL.srcW - x; h = w / r; }
      }
      TL.crop = { x, y, w: Math.max(8, w), h: Math.max(8, h) };
    }
    drawCropBox();
  });

  const end = () => { if (drag) { drag = null; drawCropBox(); emit(); } };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

/** 인코딩에 넘길 크롭 값 (짝수로 맞춘 정수) */
export function cropForEncode() {
  if (!TL.cropOn || !TL.crop) return null;
  const c = TL.crop;
  const w = Math.max(2, 2 * Math.round(Math.min(c.w, TL.srcW - c.x) / 2));
  const h = Math.max(2, 2 * Math.round(Math.min(c.h, TL.srcH - c.y) / 2));
  const x = clamp(Math.round(c.x), 0, TL.srcW - w);
  const y = clamp(Math.round(c.y), 0, TL.srcH - h);
  // 원본 그대로면 크롭 필터를 넣지 않는다
  if (x === 0 && y === 0 && w === TL.srcW && h === TL.srcH) return null;
  return { x, y, w, h };
}

// ═══════════════════════════════════════════════════════════
// 단축키
// ═══════════════════════════════════════════════════════════
function wireKeys() {
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!TL.duration) return;

    const k = e.key.toLowerCase();
    if (k === 'i') { setIn(TL.vid.currentTime); e.preventDefault(); }
    else if (k === 'o') { setOut(TL.vid.currentTime); e.preventDefault(); }
    else if (e.key === ' ') { togglePlay(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { TL.vid.pause(); seekTo(TL.vid.currentTime - (e.shiftKey ? 1 : FRAME)); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { TL.vid.pause(); seekTo(TL.vid.currentTime + (e.shiftKey ? 1 : FRAME)); e.preventDefault(); }
    else if (e.key === 'Home') { seekTo(TL.start); e.preventDefault(); }
    else if (e.key === 'End') { seekTo(TL.end); e.preventDefault(); }
  });
}

/** 현재 프레임을 PNG 로 (P2 — 스틸 컷) */
export function grabStill() {
  const v = TL.vid;
  if (!v.src || !TL.srcW) return null;
  const c = TL.cropOn ? cropForEncode() : null;
  const cv = document.createElement('canvas');
  cv.width = c ? c.w : TL.srcW;
  cv.height = c ? c.h : TL.srcH;
  const ctx = cv.getContext('2d');
  if (c) ctx.drawImage(v, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
  else ctx.drawImage(v, 0, 0, cv.width, cv.height);
  return cv;
}

export { fitVideo, drawTimeline, drawCropBox };
