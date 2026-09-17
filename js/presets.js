// ═══════════════════════════════════════════════════════════
// 출력 프리셋 — 어디에 쓸 GIF/WebP/MP4 인가로 고른다
// ═══════════════════════════════════════════════════════════
// · 값은 사용자가 화면에서 고쳐 쓸 수 있고, localStorage 에 남는다.
// · 영상 데이터는 절대 저장하지 않는다 (설정값만).

export const LS_PRESETS = 'clipbox.presets.v1';
export const LS_SETTINGS = 'clipbox.settings.v1';

// ── 포맷별 기본 성질 ──
export const FORMATS = {
  gif: {
    ext: 'gif',
    mime: 'image/gif',
    label: 'GIF',
    // 팔레트 2패스가 필요한 유일한 포맷
    twoPass: true,
    hasColors: true,
    hasDither: true,
    hasQuality: false,
    hasCrf: false,
  },
  webp: {
    ext: 'webp',
    mime: 'image/webp',
    label: 'WebP',
    twoPass: false,
    hasColors: false,
    hasDither: false,
    hasQuality: true,   // libwebp -q:v 0~100
    hasCrf: false,
  },
  mp4: {
    ext: 'mp4',
    mime: 'video/mp4',
    label: 'MP4',
    twoPass: false,
    hasColors: false,
    hasDither: false,
    hasQuality: false,
    hasCrf: true,       // libx264 -crf 0~51
  },
};

export const DITHERS = [
  'sierra2_4a',   // 기본 — 알갱이가 곱고 용량도 적당하다
  'bayer',        // 격자무늬. 용량이 가장 적다
  'floyd_steinberg',
  'sierra2',
  'none',
];

// ── 기본 프리셋 ──
// name 은 한/영 두 벌로 두고 presetName() 이 골라 쓴다 (i18n.js 를 거치지 않는
// 이유: 사용자가 프리셋을 고쳐 저장하면 이름은 그대로 두고 값만 바뀌기 때문).
export const BUILTIN_PRESETS = [
  {
    id: 'readme',
    name: { ko: 'README', en: 'README' },
    format: 'gif',
    width: 480,
    fps: 10,
    colors: 128,
    dither: 'sierra2_4a',
    quality: 75,
    crf: 23,
    maxBytes: 0,
  },
  {
    id: 'manual',
    name: { ko: '매뉴얼', en: 'Manual' },
    format: 'webp',
    width: 640,
    fps: 12,
    colors: 128,
    dither: 'sierra2_4a',
    quality: 75,
    crf: 23,
    maxBytes: 0,
  },
  {
    id: 'sns',
    name: { ko: 'SNS', en: 'Social' },
    format: 'mp4',
    width: 720,
    fps: 15,
    colors: 128,
    dither: 'sierra2_4a',
    quality: 75,
    crf: 23,
    maxBytes: 0,
  },
  {
    id: 'katalk',
    name: { ko: '카톡', en: 'Messenger' },
    format: 'gif',
    width: 360,
    fps: 10,
    colors: 64,
    dither: 'bayer',
    quality: 75,
    crf: 23,
    maxBytes: 5 * 1024 * 1024,
  },
];

// ── 저장 / 불러오기 ──
export function loadPresets() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS_PRESETS) || 'null'); } catch (e) {}
  if (!Array.isArray(saved) || !saved.length) return BUILTIN_PRESETS.map(p => ({ ...p }));
  // 저장본이 오래돼서 항목이 빠져 있어도 기본값으로 메운다
  return BUILTIN_PRESETS.map(base => {
    const hit = saved.find(s => s && s.id === base.id);
    // 이름은 저장본을 믿지 않는다 — 언어가 바뀌면 기본값 쪽이 맞다
    return hit ? { ...base, ...hit, id: base.id, name: base.name } : { ...base };
  });
}

export function savePresets(presets) {
  try { localStorage.setItem(LS_PRESETS, JSON.stringify(presets)); } catch (e) {}
}

export function resetPresets() {
  try { localStorage.removeItem(LS_PRESETS); } catch (e) {}
  return BUILTIN_PRESETS.map(p => ({ ...p }));
}

/** 프리셋 이름 (언어별) */
export function presetName(p, lang) {
  if (!p || !p.name) return '';
  if (typeof p.name === 'string') return p.name;
  return p.name[lang] || p.name.ko;
}

/** 프리셋 설명 — 지금 값에서 만들어 낸다. 기호만 써서 한/영 공통으로 읽힌다. */
export function describe(p) {
  const f = FORMATS[p.format];
  return `${p.width}px · ${p.fps}fps · ${f.label}` +
    (p.maxBytes ? ` · ≤${Math.round(p.maxBytes / 1024 / 1024)}MB` : '');
}

export const DEFAULT_SETTINGS = {
  presetId: 'readme',
  loopPreview: true,
  fitToSize: false,
  targetMB: 5,
  rotate: 'auto',        // auto | 0 | 90 | 180 | 270
  textPos: 'bottom-left',
  textSize: 24,
  textPad: 16,
  logoPos: 'bottom-right',
  logoScale: 18,         // 출력 가로폭 대비 %
  logoPad: 16,
  fade: 0,               // 페이드 인/아웃 길이(초). 0 이면 없음
};

export function loadSettings() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS_SETTINGS) || 'null'); } catch (e) {}
  return { ...DEFAULT_SETTINGS, ...(saved && typeof saved === 'object' ? saved : {}) };
}

export function saveSettings(s) {
  try { localStorage.setItem(LS_SETTINGS, JSON.stringify(s)); } catch (e) {}
}

// ═══════════════════════════════════════════════════════════
// 예상 용량 — 어림값
// ═══════════════════════════════════════════════════════════
// 지시서: "프레임 수 × 해상도 기반 대략치. 자릿수만 맞으면 된다."
// 아래 상수는 testsrc2(잡음이 많아 거의 최악인 영상)로 실제 인코딩해서 맞췄다.
// 화면 녹화처럼 색이 단순한 영상은 이보다 훨씬 작게 나온다 —
// 그래서 화면에는 꼭 '대략' 이라고 붙여서 보여 준다.
const BPP = {          // 픽셀 한 개당 바이트 (프레임당)
  gif: 0.125,          // 128색 기준
  webp: 0.041,         // q=75 기준
  mp4: 0.018,          // crf=23 기준
};

export function estimateBytes({ format, width, height, fps, seconds, colors, quality, crf, pingpong }) {
  const f = FORMATS[format];
  if (!f || !width || !height || !fps || !seconds) return 0;
  let frames = Math.max(1, Math.round(fps * seconds * (pingpong ? 2 : 1)));
  let bpp = BPP[format];

  if (format === 'gif') {
    // 색 수가 줄면 대략 log2 에 비례해 작아진다
    const c = Math.max(2, colors || 128);
    bpp *= Math.log2(c) / Math.log2(128);
  } else if (format === 'webp') {
    const q = Math.min(100, Math.max(1, quality || 75));
    bpp *= Math.pow(q / 75, 1.6);
  } else if (format === 'mp4') {
    const v = Math.min(51, Math.max(0, crf == null ? 23 : crf));
    // CRF 6 마다 비트레이트가 대략 2배
    bpp *= Math.pow(2, (23 - v) / 6);
  }

  const bytes = frames * width * height * bpp;
  const overhead = format === 'mp4' ? 8 * 1024 : 2 * 1024;
  return Math.round(bytes + overhead);
}

// ── 목표 용량 맞추기: 다음 시도의 설정값을 정한다 ──
// 순서대로 프레임률 → 해상도 → 팔레트 색수를 낮춘다.
export function nextAttempt(cur, actualBytes, targetBytes) {
  const over = actualBytes / targetBytes;
  if (over <= 1) return null;
  const next = { ...cur };

  // 1) 프레임률 (6fps 아래로는 내리지 않는다 — 뚝뚝 끊겨 보인다)
  let left = over;
  const fpsFloor = 6;
  if (next.fps > fpsFloor) {
    const want = Math.max(fpsFloor, Math.round(next.fps / Math.min(left, 1.7)));
    left *= want / next.fps;
    next.fps = want;
  }

  // 2) 해상도 (240px 아래로는 내리지 않는다)
  const wFloor = 240;
  if (left > 1 && next.width > wFloor) {
    const k = 1 / Math.sqrt(left);
    const want = Math.max(wFloor, 2 * Math.round((next.width * k) / 2));
    left *= (want * want) / (next.width * next.width);
    next.width = want;
  }

  // 3) 팔레트 색수 (GIF 전용)
  if (left > 1 && next.format === 'gif' && next.colors > 32) {
    next.colors = next.colors > 64 ? 64 : 32;
    left *= 0.8;
  }

  // 4) 그래도 남으면 품질/CRF
  if (left > 1 && next.format === 'webp' && next.quality > 40) {
    next.quality = Math.max(40, Math.round(next.quality * 0.75));
  }
  if (left > 1 && next.format === 'mp4' && next.crf < 34) {
    next.crf = Math.min(34, next.crf + 4);
  }

  // 아무것도 못 낮췄으면 더 시도할 의미가 없다
  const same = next.fps === cur.fps && next.width === cur.width &&
    next.colors === cur.colors && next.quality === cur.quality && next.crf === cur.crf;
  return same ? null : next;
}
