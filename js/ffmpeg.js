// ═══════════════════════════════════════════════════════════
// ffmpeg.wasm — 코어 로드 · 명령 조립 · 진행률 · 취소
// ═══════════════════════════════════════════════════════════
// · 싱글스레드 코어(@ffmpeg/core)만 쓴다. GitHub Pages 는 COOP/COEP 헤더를
//   줄 수 없어서 SharedArrayBuffer(=core-mt)가 아예 동작하지 않는다.
// · 코어 파일은 vendor/ 에 셀프호스팅한다. 런타임 외부 요청은 0 이다.
// · 인스턴스는 하나만 두고 재사용한다. 취소는 terminate() → 재로드.

import { FFmpeg } from '../vendor/ffmpeg/index.js';
import { FORMATS } from './presets.js';

export const CORE_VERSION = '0.12.10';

// Cache-Control 헤더를 손댈 수 없으니 파일명에 버전을 박아 둔다.
// (같은 파일명이면 브라우저 캐시가 그대로 맞는다)
const CORE_JS = new URL(`../vendor/ffmpeg-core/ffmpeg-core.${CORE_VERSION}.js`, import.meta.url).href;
const CORE_WASM = new URL(`../vendor/ffmpeg-core/ffmpeg-core.${CORE_VERSION}.wasm`, import.meta.url).href;
const FONT_URL = new URL('../vendor/fonts/Pretendard-Bold.ttf', import.meta.url).href;
const CACHE_NAME = `clipbox-core-${CORE_VERSION}`;

export const FILES = {
  font: 'font.ttf',
  text: 'text.txt',
  logo: 'logo.png',
  palette: 'palette.png',
};

// ── 내부 상태 ──
let ffmpeg = null;
let loadPromise = null;
let coreBlobs = null;          // { core, wasm } blob URL — 재로드 때 다시 쓴다
let fontBytes = null;
let progressCb = null;
let logCb = null;
let logLines = [];             // 마지막 로그 (probe 가 읽는다)
let terminated = false;
let execCount = 0;             // 워커 하나가 지금까지 돌린 인코딩 수

// ffmpeg.wasm 은 exec 를 되풀이하면 힙이 조금씩 쌓인다. 실제로 열댓 번쯤
// 이어서 돌리면 'memory access out of bounds' 로 죽는다. 그 전에 갈아 끼운다.
const EXEC_BUDGET = 8;
export function needsRecycle() { return execCount >= EXEC_BUDGET; }
export function resetBudget() { execCount = 0; }

export function isLoaded() {
  return !!(ffmpeg && ffmpeg.loaded);
}

// ── 진행률 있는 다운로드 + Cache Storage ──
// 두 번째 방문에서는 Cache Storage 에서 바로 꺼내므로 네트워크를 타지 않는다.
async function fetchCached(url, onBytes) {
  let cache = null;
  try { cache = await caches.open(CACHE_NAME); } catch (e) { /* file:// 등 */ }

  if (cache) {
    const hit = await cache.match(url);
    if (hit) {
      const buf = await hit.arrayBuffer();
      onBytes && onBytes(buf.byteLength, buf.byteLength, true);
      return buf;
    }
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} 를 불러오지 못했어요 (HTTP ${res.status})`);
  const total = parseInt(res.headers.get('Content-Length') || '-1', 10);
  let buf;

  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onBytes && onBytes(got, total, false);
    }
    const out = new Uint8Array(got);
    let pos = 0;
    for (const c of chunks) { out.set(c, pos); pos += c.length; }
    buf = out.buffer;
  } else {
    buf = await res.arrayBuffer();
    onBytes && onBytes(buf.byteLength, buf.byteLength, false);
  }

  if (cache) {
    try {
      await cache.put(url, new Response(buf.slice(0), {
        headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream' },
      }));
    } catch (e) { /* 용량 부족 등 — 캐시는 없어도 동작한다 */ }
  }
  return buf;
}

/**
 * 코어를 불러온다. onProgress({phase, loaded, total, ratio, cached})
 * 첫 로드는 약 32MB, 두 번째부터는 캐시에서 즉시.
 */
export function loadCore(onProgress) {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    // 코어 JS(약 0.1MB) + wasm(약 32MB)
    let cached = true;
    if (!coreBlobs) {
      const jsBuf = await fetchCached(CORE_JS, (got, total, hit) => {
        if (!hit) cached = false;
        onProgress && onProgress({ phase: 'js', loaded: got, total, ratio: total > 0 ? got / total : 0, cached: hit });
      });
      const wasmBuf = await fetchCached(CORE_WASM, (got, total, hit) => {
        if (!hit) cached = false;
        onProgress && onProgress({ phase: 'wasm', loaded: got, total, ratio: total > 0 ? got / total : 0, cached: hit });
      });
      coreBlobs = {
        core: URL.createObjectURL(new Blob([jsBuf], { type: 'text/javascript' })),
        wasm: URL.createObjectURL(new Blob([wasmBuf], { type: 'application/wasm' })),
      };
    }

    onProgress && onProgress({ phase: 'init', loaded: 1, total: 1, ratio: 1, cached });

    ffmpeg = new FFmpeg();
    ffmpeg.on('log', ({ message }) => {
      logLines.push(message);
      if (logLines.length > 500) logLines.shift();
      logCb && logCb(message);
    });
    ffmpeg.on('progress', (p) => { progressCb && progressCb(p); });

    // worker.js 는 module worker 라 importScripts 가 없다 → 자동으로
    // `await import(coreURL)` 경로를 타므로 ESM 코어를 넘겨야 한다.
    await ffmpeg.load({ coreURL: coreBlobs.core, wasmURL: coreBlobs.wasm });
    terminated = false;
    execCount = 0;
    return ffmpeg;
  })();

  loadPromise.catch(() => { loadPromise = null; });
  return loadPromise;
}

/** 취소 — 워커를 죽인다. 다음 인코딩 전에 reload() 로 되살린다. */
export function terminate() {
  terminated = true;
  if (ffmpeg) {
    try { ffmpeg.terminate(); } catch (e) {}
  }
  ffmpeg = null;
  loadPromise = null;
}

/** terminate() 뒤 다시 쓸 수 있게 되살린다. blob 은 남아 있어 즉시 끝난다. */
export function reload(onProgress) {
  return loadCore(onProgress);
}

export function onLog(fn) { logCb = fn; }
export function recentLog() { return logLines.slice(); }

// ═══════════════════════════════════════════════════════════
// 원본 살펴보기 / 미리보기용 대역 영상
// ═══════════════════════════════════════════════════════════

/**
 * 원본의 크기·회전·길이를 알아낸다 (프레임 한 장만 디코딩해서 로그를 읽는다).
 * 돌려주는 w/h 는 '회전을 반영한, 화면에 보이는' 크기다.
 */
export async function probeInput(inName) {
  const ff = await loadCore();
  logLines = [];
  try { await ff.exec(['-hide_banner', '-i', inName, '-frames:v', '1', '-f', 'null', '-']); } catch (e) {}

  let w = 0, h = 0, rot = 0, dur = 0;
  for (const l of logLines) {
    if (!w && /Stream #\d+:\d+.*Video:/.test(l)) {
      const m = l.match(/,\s(\d{2,5})x(\d{2,5})[\s,\[]/);
      if (m) { w = +m[1]; h = +m[2]; }
    }
    if (!rot) {
      const m = l.match(/rotation of (-?[\d.]+) degrees/);
      if (m && Math.abs(parseFloat(m[1])) > 0.5) rot = ((Math.round(-parseFloat(m[1])) % 360) + 360) % 360;
    }
    if (!dur) {
      const m = l.match(/Duration: (\d+):(\d+):([\d.]+)/);
      if (m) dur = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
    }
  }
  // 회전이 90/270 이면 화면에 보이는 크기는 가로세로가 바뀐다 (ffmpeg 이 알아서 돌린다)
  if (rot === 90 || rot === 270) { const t = w; w = h; h = t; }
  return { w, h, rotation: rot, duration: dur };
}

/**
 * 브라우저가 못 읽는 코덱(아이폰 HEVC 등)일 때 쓰는 미리보기용 대역 영상.
 * 화면에 보여 주기만 할 뿐, 실제로 굽는 것은 언제나 원본이다.
 * VP8/WebM 은 크롬·엣지가 코덱 없이도 반드시 재생한다.
 */
export async function makeProxy(inName, outName, maxH, onProgress) {
  const ff = await loadCore();
  const info = await probeInput(inName);
  const H = Math.max(2, 2 * Math.round(Math.min(maxH || 540, info.h || maxH || 540) / 2));
  const W = info.h ? Math.max(2, 2 * Math.round((info.w * (H / info.h)) / 2)) : 0;
  const dur = info.duration || 0;

  progressCb = ({ time }) => {
    const t = (time || 0) / 1e6;
    onProgress && onProgress(dur > 0 ? Math.max(0, Math.min(1, t / dur)) : 0);
  };
  try {
    execCount++;
    const ret = await ff.exec(['-y', '-i', inName, '-an',
      '-vf', W ? `scale=${W}:${H}` : `scale=-2:${H}`,
      '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8',
      '-b:v', '900k', '-qmin', '10', '-qmax', '46', outName]);
    if (ret !== 0) throw new Error(`미리보기를 만들지 못했어요 (${ret})`);
    const data = await ff.readFile(outName);
    return { data: new Uint8Array(data), info };
  } finally {
    progressCb = null;
    if (ffmpeg && ffmpeg.loaded) { try { await ffmpeg.deleteFile(outName); } catch (e) {} }
  }
}

// ── drawtext 용 한글 폰트 ──
async function ensureFont() {
  if (!fontBytes) {
    const res = await fetch(FONT_URL);
    if (!res.ok) throw new Error('글꼴을 불러오지 못했어요');
    fontBytes = new Uint8Array(await res.arrayBuffer());
  }
  return fontBytes;
}

// ═══════════════════════════════════════════════════════════
// 명령 조립
// ═══════════════════════════════════════════════════════════

const POS = {
  'top-left': { text: (p) => `x=${p}:y=${p}`, ov: (p) => `${p}:${p}` },
  'top-right': { text: (p) => `x=w-tw-${p}:y=${p}`, ov: (p) => `W-w-${p}:${p}` },
  'bottom-left': { text: (p) => `x=${p}:y=h-th-${p}`, ov: (p) => `${p}:H-h-${p}` },
  'bottom-right': { text: (p) => `x=w-tw-${p}:y=h-th-${p}`, ov: (p) => `W-w-${p}:H-h-${p}` },
};

/**
 * 출력 크기를 미리 계산한다 (예상 용량·글자 크기에 쓴다).
 * srcW/srcH 는 <video> 가 보여 주는 크기(회전 반영 후) 기준.
 */
export function outSize(job) {
  let w = job.crop ? job.crop.w : job.srcW;
  let h = job.crop ? job.crop.h : job.srcH;
  if (job.rotate === 90 || job.rotate === 270) { const t = w; w = h; h = t; }
  if (!w || !h) return { w: 0, h: 0 };
  const target = Math.min(job.width, w);
  const ow = Math.max(2, 2 * Math.round(target / 2));
  const oh = Math.max(2, 2 * Math.round((h * (ow / w)) / 2));
  return { w: ow, h: oh };
}

/** 구간 길이(초) — 배속·핑퐁 반영한 '출력' 길이 */
export function outDuration(job) {
  const raw = Math.max(0.02, job.end - job.start);
  const sped = raw / (job.speed || 1);
  return job.loop === 'pingpong' ? sped * 2 : sped;
}

// 공통 영상 필터 사슬 (입력 [0:v] 기준, 라벨은 붙이지 않는다)
function videoChain(job, dims) {
  const f = [];

  // 1) 크롭이 먼저다 — 크롭 박스 좌표는 화면의 <video> 가 보여 주는 그림
  //    (= 회전 메타데이터가 이미 반영된 그림) 기준이기 때문이다.
  if (job.crop) {
    const c = job.crop;
    f.push(`crop=${Math.round(c.w)}:${Math.round(c.h)}:${Math.round(c.x)}:${Math.round(c.y)}`);
  }

  // 2) 회전 — '자동'(기본)이면 아무것도 넣지 않는다.
  //    ffmpeg 은 회전 메타데이터(display matrix)가 있으면 알아서 돌려 준다
  //    (-autorotate 가 기본 on). <video> 도 같은 방향으로 보여 주므로 좌표가 맞는다.
  //    자동이 안 먹는 파일을 만나면 화면에서 90/180/270 을 직접 고를 수 있다.
  if (job.rotate === 90) f.push('transpose=1');
  else if (job.rotate === 270) f.push('transpose=2');
  else if (job.rotate === 180) f.push('transpose=1', 'transpose=1');

  // 3) 배속
  const sp = job.speed || 1;
  if (Math.abs(sp - 1) > 0.001) f.push(`setpts=${(1 / sp).toFixed(6)}*PTS`);

  // 4) 프레임률 — 여기서 먼저 줄여야 뒤 필터가 가벼워진다
  f.push(`fps=${job.fps}`);

  // 5) 크기 — 숫자로 못박는다.
  //    scale 에 min()/trunc() 같은 식을 넣으면 필터가 다시 초기화될 때
  //    (split·concat 이 끼어드는 핑퐁 등) 식을 다시 못 읽고 깨진다.
  //    출력 크기는 어차피 outSize() 로 미리 알 수 있으니 그대로 숫자를 쓴다.
  f.push(`scale=${dims.w}:${dims.h}:flags=lanczos`);

  return f;
}

/**
 * 필터그래프 전체를 만든다.
 * · extra: { logoIdx, paletteIdx, paletteUse } — 입력 번호
 * · 결과 라벨은 항상 [vout]
 */
function buildGraph(job, dims, extra) {
  const parts = [];
  let cur = '[0:v]';
  let n = 0;
  const next = () => `[v${++n}]`;

  const chain = videoChain(job, dims).join(',');

  if (job.loop === 'pingpong') {
    // 정방향 + 역방향 이어붙이기. reverse 는 프레임을 전부 메모리에 쌓으므로
    // 반드시 fps·scale 로 줄인 뒤에 돌린다.
    const a = next(), b = next(), r = next(), o = next();
    parts.push(`${cur}${chain},split=2${a}${b}`);
    parts.push(`${b}reverse${r}`);
    parts.push(`${a}${r}concat=n=2:v=1:a=0${o}`);
    cur = o;
  } else if (job.loop === 'reverse') {
    const o = next();
    parts.push(`${cur}${chain},reverse${o}`);
    cur = o;
  } else {
    const o = next();
    parts.push(`${cur}${chain}${o}`);
    cur = o;
  }

  // 6) 텍스트 한 줄
  if (job.text) {
    const p = Math.max(0, Math.round(job.textPad));
    const pos = (POS[job.textPos] || POS['bottom-left']).text(p);
    const size = Math.max(8, Math.round(job.textSize));
    const o = next();
    parts.push(
      `${cur}drawtext=fontfile=${FILES.font}:textfile=${FILES.text}:reload=0:` +
      `fontsize=${size}:fontcolor=white:borderw=${Math.max(1, Math.round(size / 10))}:` +
      `bordercolor=black@0.85:line_spacing=4:${pos}${o}`
    );
    cur = o;
  }

  // 7) 로고
  if (extra.logoIdx != null) {
    const lw = Math.max(8, Math.round(dims.w * (job.logoScale || 18) / 100));
    const p = Math.max(0, Math.round(job.logoPad));
    const lg = next(), o = next();
    parts.push(`[${extra.logoIdx}:v]scale=${lw}:-1${lg}`);
    parts.push(`${cur}${lg}overlay=${(POS[job.logoPos] || POS['bottom-right']).ov(p)}${o}`);
    cur = o;
  }

  // 8) 페이드 인/아웃
  if (job.fade > 0) {
    const d = Math.min(job.fade, outDuration(job) / 2.2);
    if (d > 0.04) {
      const st = (outDuration(job) - d).toFixed(3);
      const o = next();
      parts.push(`${cur}fade=t=in:st=0:d=${d.toFixed(3)},fade=t=out:st=${st}:d=${d.toFixed(3)}${o}`);
      cur = o;
    }
  }

  // 9) 팔레트 적용 (GIF 2패스의 두 번째 패스)
  if (extra.paletteUse) {
    parts.push(`${cur}[${extra.paletteIdx}:v]paletteuse=dither=${job.dither}:diff_mode=rectangle[vout]`);
  } else if (extra.palettegen) {
    parts.push(`${cur}palettegen=max_colors=${Math.max(4, Math.min(256, job.colors))}:stats_mode=full[vout]`);
  } else {
    parts.push(`${cur}null[vout]`);
  }

  return parts.join(';');
}

/**
 * 한 클립을 만들기 위한 ffmpeg 명령(패스) 목록.
 * 지시서대로 `-ss <start> -to <end> -i in` 순서라서 구간만 디코딩한다.
 */
export function buildPasses(job, inName, outName) {
  const dims = outSize(job);
  const fmt = FORMATS[job.format];
  const ss = job.start.toFixed(3);
  const to = job.end.toFixed(3);
  const passes = [];

  const head = (withLogo, withPalette) => {
    const a = ['-y', '-ss', ss, '-to', to, '-i', inName];
    const extra = {};
    let idx = 1;
    if (withLogo) { a.push('-i', FILES.logo); extra.logoIdx = idx++; }
    if (withPalette) { a.push('-i', FILES.palette); extra.paletteIdx = idx++; }
    return { a, extra };
  };

  if (fmt.twoPass) {
    // ── 1패스: 팔레트 뽑기 ──
    {
      const { a, extra } = head(!!job.logo, false);
      extra.palettegen = true;
      a.push('-filter_complex', buildGraph(job, dims, extra), '-map', '[vout]',
        '-frames:v', '1', '-update', '1', FILES.palette);
      passes.push({ args: a, weight: 0.35, label: '색 고르는 중' });
    }
    // ── 2패스: 팔레트로 GIF 굽기 ──
    {
      const { a, extra } = head(!!job.logo, true);
      extra.paletteUse = true;
      a.push('-filter_complex', buildGraph(job, dims, extra), '-map', '[vout]',
        '-an', '-loop', '0', '-f', 'gif', outName);
      passes.push({ args: a, weight: 0.65, label: '굽는 중' });
    }
  } else if (job.format === 'webp') {
    const { a, extra } = head(!!job.logo, false);
    a.push('-filter_complex', buildGraph(job, dims, extra), '-map', '[vout]',
      '-an', '-c:v', 'libwebp', '-lossless', '0',
      '-q:v', String(Math.round(job.quality)), '-loop', '0', outName);
    passes.push({ args: a, weight: 1, label: '굽는 중' });
  } else {
    // MP4 — 소리 없음 고정
    const { a, extra } = head(!!job.logo, false);
    a.push('-filter_complex', buildGraph(job, dims, extra), '-map', '[vout]',
      '-an', '-c:v', 'libx264', '-preset', 'veryfast',
      '-crf', String(Math.round(job.crf)), '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', outName);
    passes.push({ args: a, weight: 1, label: '굽는 중' });
  }

  return passes;
}

// ═══════════════════════════════════════════════════════════
// 실행
// ═══════════════════════════════════════════════════════════

/** 원본 영상을 가상 FS 에 한 번만 올린다 (클립 여러 개가 같이 쓴다) */
export async function writeInput(inName, file) {
  const ff = await loadCore();
  const buf = new Uint8Array(await file.arrayBuffer());
  await ff.writeFile(inName, buf);
}

export async function writeAux(job) {
  const ff = await loadCore();
  if (job.text) {
    await ff.writeFile(FILES.font, await ensureFont());
    await ff.writeFile(FILES.text, new TextEncoder().encode(job.text));
  }
  if (job.logo) {
    await ff.writeFile(FILES.logo, new Uint8Array(await job.logo.arrayBuffer()));
  }
}

async function quietDelete(names) {
  if (!ffmpeg || !ffmpeg.loaded) return;
  for (const n of names) {
    try { await ffmpeg.deleteFile(n); } catch (e) { /* 없으면 그만 */ }
  }
}

export function cleanup(names) { return quietDelete(names); }

/**
 * 클립 하나를 인코딩한다.
 * onProgress(ratio 0~1, label)
 * 취소는 terminate() 로 — 그러면 여기 던져지는 예외를 호출부가 받는다.
 */
export async function encodeClip(job, inName, outName, onProgress) {
  const ff = await loadCore();
  await writeAux(job);
  const passes = buildPasses(job, inName, outName);
  const dur = outDuration(job);
  let base = 0;

  try {
    for (const p of passes) {
      const w = p.weight;
      progressCb = ({ time }) => {
        // ffmpeg 의 time 은 마이크로초. 구간 길이로 나눠 비율을 만든다.
        const t = (time || 0) / 1e6;
        const r = Math.max(0, Math.min(1, dur > 0 ? t / dur : 0));
        onProgress && onProgress(base + r * w, p.label);
      };
      execCount++;
      const ret = await ff.exec(p.args);
      progressCb = null;
      if (terminated) throw new Error('취소했어요');
      if (ret !== 0) throw new Error(`ffmpeg 이 ${ret} 로 끝났어요`);
      base += w;
      onProgress && onProgress(base, p.label);
    }

    const data = await ff.readFile(outName);
    return new Uint8Array(data);
  } catch (e) {
    // wasm 이 한 번 트랩(memory access out of bounds 등)을 내면 그 인스턴스는
    // 되살릴 수 없다. 조용히 버리고, 다음 호출에서 새로 띄운다.
    if (isFatal(e)) terminate();
    throw e;
  } finally {
    progressCb = null;
    if (ffmpeg && ffmpeg.loaded) await quietDelete([outName, FILES.palette]);
  }
}

/** 되살릴 수 없는 오류인가 (wasm 트랩 / 메모리 부족) */
export function isFatal(e) {
  const m = String((e && e.message) || e || '');
  return /memory access out of bounds|RuntimeError|out of memory|Aborted|table index is out of bounds|unreachable/i.test(m);
}

export { ffmpeg };
