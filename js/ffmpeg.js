// ═══════════════════════════════════════════════════════════
// ffmpeg.js — 코어 불러오기 · 명령 조립 · 진행률 · 그만두기
// ═══════════════════════════════════════════════════════════
// · 싱글스레드 코어(@ffmpeg/core)만 씁니다. GitHub Pages 는 COOP/COEP 헤더를
//   줄 수 없어 SharedArrayBuffer(=core-mt)가 동작하지 않습니다.
// · 코어·라이브러리는 vendor/ 에 셀프호스팅합니다. 실행 중 외부 요청은 0개입니다.
// · classic script 안에서 ESM 인 @ffmpeg/ffmpeg 를 쓰므로 동적 import() 를 씁니다.
//   design/README.md §6: 경로는 new URL(..., document.baseURI) 로 문서 기준으로 풉니다.
//   ('./vendor/...' 라고 적으면 이 스크립트 파일 기준으로 풀려 404 가 납니다.)
// · 인스턴스는 하나만 두고 재사용합니다. 그만두기는 terminate() 뒤 다시 불러오기.

window.ClipBox = window.ClipBox || {};

(function () {
  'use strict';

  var CORE_VERSION = '0.12.10';
  var base = function (p) { return new URL(p, document.baseURI).href; };

  // Cache-Control 을 손댈 수 없으므로 파일 이름에 버전을 박아 둡니다.
  var CORE_JS   = base('vendor/ffmpeg-core/ffmpeg-core.' + CORE_VERSION + '.js');
  var CORE_WASM = base('vendor/ffmpeg-core/ffmpeg-core.' + CORE_VERSION + '.wasm');
  var FONT_URL  = base('vendor/fonts/Pretendard-Bold.ttf');
  var CACHE_NAME = 'clipbox-core-' + CORE_VERSION;

  var FILES = { font:'font.ttf', text:'text.txt', logo:'logo.png', palette:'palette.png' };

  var ffmpeg = null, loadPromise = null, coreBlobs = null, fontBytes = null;
  var progressCb = null, logLines = [], terminated = false, execCount = 0;

  // ffmpeg.wasm 은 exec 를 되풀이하면 힙이 쌓입니다. 열댓 번쯤 이어 돌리면
  // 'memory access out of bounds' 로 죽으므로 그 전에 갈아 끼웁니다.
  var EXEC_BUDGET = 8;

  function isLoaded() { return !!(ffmpeg && ffmpeg.loaded); }
  function needsRecycle() { return execCount >= EXEC_BUDGET; }

  /** 되살릴 수 없는 오류인가 (wasm 트랩 · 메모리 부족) */
  function isFatal(e) {
    var m = String((e && e.message) || e || '');
    return /memory access out of bounds|RuntimeError|out of memory|Aborted|table index is out of bounds|unreachable/i.test(m);
  }

  // ── 진행률 있는 내려받기 + Cache Storage ──
  // 두 번째 방문에서는 Cache Storage 에서 바로 꺼내므로 네트워크를 타지 않습니다.
  function fetchCached(url, onBytes) {
    var cache = null;
    return Promise.resolve()
      .then(function () { return caches.open(CACHE_NAME).catch(function () { return null; }); })
      .then(function (c) {
        cache = c;
        return cache ? cache.match(url) : null;
      })
      .then(function (hit) {
        if (hit) return hit.arrayBuffer().then(function (buf) {
          onBytes && onBytes(buf.byteLength, buf.byteLength, true);
          return buf;
        });
        return fetch(url).then(function (res) {
          if (!res.ok) throw new Error(url + ' (HTTP ' + res.status + ')');
          var total = parseInt(res.headers.get('Content-Length') || '-1', 10);
          if (!res.body || !res.body.getReader) {
            return res.arrayBuffer().then(function (buf) {
              onBytes && onBytes(buf.byteLength, buf.byteLength, false);
              return put(buf, res);
            });
          }
          var reader = res.body.getReader(), chunks = [], got = 0;
          function pump() {
            return reader.read().then(function (r) {
              if (r.done) {
                var out = new Uint8Array(got), pos = 0;
                chunks.forEach(function (c) { out.set(c, pos); pos += c.length; });
                return put(out.buffer, res);
              }
              chunks.push(r.value);
              got += r.value.length;
              onBytes && onBytes(got, total, false);
              return pump();
            });
          }
          return pump();

          function put(buf, res) {
            if (cache) {
              try {
                cache.put(url, new Response(buf.slice(0), {
                  headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream' }
                }));
              } catch (e) { /* 용량 부족 등 — 캐시는 없어도 동작합니다 */ }
            }
            return buf;
          }
        });
      });
  }

  /**
   * 코어를 불러옵니다. onProgress({phase, loaded, total, cached})
   * 첫 번째는 약 32MB, 두 번째부터는 캐시에서 바로.
   */
  function loadCore(onProgress) {
    if (loadPromise) return loadPromise;

    loadPromise = Promise.resolve().then(function () {
      var cached = true;
      if (coreBlobs) return null;
      return fetchCached(CORE_JS, function (got, total, hit) {
        if (!hit) cached = false;
        onProgress && onProgress({ phase:'js', loaded:got, total:total, cached:hit });
      }).then(function (jsBuf) {
        return fetchCached(CORE_WASM, function (got, total, hit) {
          if (!hit) cached = false;
          onProgress && onProgress({ phase:'wasm', loaded:got, total:total, cached:hit });
        }).then(function (wasmBuf) {
          coreBlobs = {
            core: URL.createObjectURL(new Blob([jsBuf], { type:'text/javascript' })),
            wasm: URL.createObjectURL(new Blob([wasmBuf], { type:'application/wasm' })),
            cached: cached
          };
        });
      });
    }).then(function () {
      onProgress && onProgress({ phase:'init', cached: coreBlobs.cached });
      // classic script 안에서 ESM 모듈을 불러옵니다 (design/README.md §6)
      return import(base('vendor/ffmpeg/index.js'));
    }).then(function (mod) {
      ffmpeg = new mod.FFmpeg();
      ffmpeg.on('log', function (e) {
        logLines.push(e.message);
        if (logLines.length > 500) logLines.shift();
      });
      ffmpeg.on('progress', function (p) { if (progressCb) progressCb(p); });
      // worker.js 는 module worker 라 importScripts 가 없습니다 → 자동으로
      // `await import(coreURL)` 경로를 타므로 ESM 코어를 넘겨야 합니다.
      return ffmpeg.load({ coreURL: coreBlobs.core, wasmURL: coreBlobs.wasm });
    }).then(function () {
      terminated = false;
      execCount = 0;
      return ffmpeg;
    });

    loadPromise.catch(function () { loadPromise = null; });
    return loadPromise;
  }

  /** 그만두기 — 워커를 죽입니다. 다음에 쓰기 전에 reload() 로 되살립니다. */
  function terminate() {
    terminated = true;
    if (ffmpeg) { try { ffmpeg.terminate(); } catch (e) {} }
    ffmpeg = null;
    loadPromise = null;
  }

  /** terminate() 뒤 되살립니다. blob 이 남아 있어 바로 끝납니다. */
  function reload(onProgress) { return loadCore(onProgress); }

  function ensureFont() {
    if (fontBytes) return Promise.resolve(fontBytes);
    return fetch(FONT_URL).then(function (r) {
      if (!r.ok) throw new Error('글꼴을 불러오지 못했습니다');
      return r.arrayBuffer();
    }).then(function (b) { fontBytes = new Uint8Array(b); return fontBytes; });
  }

  // ═══════════════════════════════════════════════════════════
  // 원본 살펴보기 · 미리보기용 대역 영상
  // ═══════════════════════════════════════════════════════════

  /**
   * 원본의 크기·회전·길이를 알아냅니다 (프레임 한 장만 풀어 로그를 읽습니다).
   * 돌려주는 w/h 는 회전을 반영한, 화면에 보이는 크기입니다.
   */
  function probeInput(inName) {
    return loadCore().then(function (ff) {
      logLines = [];
      return ff.exec(['-hide_banner', '-i', inName, '-frames:v', '1', '-f', 'null', '-'])
        .catch(function () {});
    }).then(function () {
      var w = 0, h = 0, rot = 0, dur = 0;
      logLines.forEach(function (l) {
        var m;
        if (!w && /Stream #\d+:\d+.*Video:/.test(l)) {
          m = l.match(/,\s(\d{2,5})x(\d{2,5})[\s,\[]/);
          if (m) { w = +m[1]; h = +m[2]; }
        }
        if (!rot) {
          m = l.match(/rotation of (-?[\d.]+) degrees/);
          if (m && Math.abs(parseFloat(m[1])) > 0.5) rot = ((Math.round(-parseFloat(m[1])) % 360) + 360) % 360;
        }
        if (!dur) {
          m = l.match(/Duration: (\d+):(\d+):([\d.]+)/);
          if (m) dur = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
        }
      });
      if (rot === 90 || rot === 270) { var t = w; w = h; h = t; }
      return { w:w, h:h, rotation:rot, duration:dur };
    });
  }

  /**
   * 브라우저가 못 읽는 코덱(아이폰 HEVC 등)일 때 쓰는 미리보기용 대역 영상.
   * 화면에 보여 주기만 할 뿐, 굽는 것은 언제나 원본입니다.
   * VP8/WebM 은 크롬·엣지가 코덱 없이도 반드시 재생합니다.
   */
  function makeProxy(inName, outName, maxH, onProgress) {
    var info;
    return probeInput(inName).then(function (i) {
      info = i;
      var H = Math.max(2, 2 * Math.round(Math.min(maxH || 540, info.h || maxH || 540) / 2));
      var W = info.h ? Math.max(2, 2 * Math.round((info.w * (H / info.h)) / 2)) : 0;
      var dur = info.duration || 0;
      progressCb = function (p) {
        var t = (p.time || 0) / 1e6;
        onProgress && onProgress(dur > 0 ? Math.max(0, Math.min(1, t / dur)) : 0);
      };
      execCount++;
      return ffmpeg.exec(['-y', '-i', inName, '-an',
        '-vf', W ? ('scale=' + W + ':' + H) : ('scale=-2:' + H),
        '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8',
        '-b:v', '900k', '-qmin', '10', '-qmax', '46', outName]);
    }).then(function (ret) {
      progressCb = null;
      if (ret !== 0) throw new Error('미리보기를 만들지 못했습니다 (' + ret + ')');
      return ffmpeg.readFile(outName);
    }).then(function (data) {
      try { ffmpeg.deleteFile(outName); } catch (e) {}
      return { data: new Uint8Array(data), info: info };
    }).catch(function (e) {
      progressCb = null;
      if (isFatal(e)) terminate();
      throw e;
    });
  }

  // ═══════════════════════════════════════════════════════════
  // 명령 조립
  // ═══════════════════════════════════════════════════════════

  var POS = {
    'top-left':     { text:function (p) { return 'x=' + p + ':y=' + p; },          ov:function (p) { return p + ':' + p; } },
    'top-right':    { text:function (p) { return 'x=w-tw-' + p + ':y=' + p; },     ov:function (p) { return 'W-w-' + p + ':' + p; } },
    'bottom-left':  { text:function (p) { return 'x=' + p + ':y=h-th-' + p; },     ov:function (p) { return p + ':H-h-' + p; } },
    'bottom-right': { text:function (p) { return 'x=w-tw-' + p + ':y=h-th-' + p; },ov:function (p) { return 'W-w-' + p + ':H-h-' + p; } }
  };

  /** 출력 크기 (예상 용량·글자 크기에 씁니다). srcW/srcH 는 화면에 보이는 크기 기준. */
  function outSize(job) {
    var w = job.crop ? job.crop.w : job.srcW;
    var h = job.crop ? job.crop.h : job.srcH;
    if (job.rotate === 90 || job.rotate === 270) { var t = w; w = h; h = t; }
    if (!w || !h) return { w:0, h:0 };
    var ow = Math.max(2, 2 * Math.round(Math.min(job.width, w) / 2));
    var oh = Math.max(2, 2 * Math.round((h * (ow / w)) / 2));
    return { w:ow, h:oh };
  }

  /** 출력 길이(초) — 배속·핑퐁 반영 */
  function outDuration(job) {
    var raw = Math.max(0.02, job.end - job.start);
    var sped = raw / (job.speed || 1);
    return job.loop === 'pingpong' ? sped * 2 : sped;
  }

  function videoChain(job, dims) {
    var f = [];

    // 1) 크롭이 먼저입니다 — 크롭 칸 좌표는 화면의 <video> 가 보여 주는 그림
    //    (= 회전 메타데이터가 이미 반영된 그림) 기준이기 때문입니다.
    if (job.crop) {
      f.push('crop=' + Math.round(job.crop.w) + ':' + Math.round(job.crop.h) + ':' +
             Math.round(job.crop.x) + ':' + Math.round(job.crop.y));
    }
    // 2) 회전 — '자동'(기본)이면 아무것도 넣지 않습니다.
    //    ffmpeg 이 회전 메타데이터를 보고 알아서 돌려 주고(-autorotate 기본 on),
    //    <video> 도 같은 방향으로 보여 주므로 좌표가 서로 맞습니다.
    if (job.rotate === 90) f.push('transpose=1');
    else if (job.rotate === 270) f.push('transpose=2');
    else if (job.rotate === 180) f.push('transpose=1', 'transpose=1');

    // 3) 배속
    if (Math.abs((job.speed || 1) - 1) > 0.001) f.push('setpts=' + (1 / job.speed).toFixed(6) + '*PTS');
    // 4) 프레임률 — 여기서 먼저 줄여야 뒤 필터가 가볍습니다
    f.push('fps=' + job.fps);
    // 5) 크기 — 숫자로 못박습니다. scale 에 min()/trunc() 같은 식을 넣으면
    //    필터가 다시 초기화될 때(split·concat 이 끼는 핑퐁 등) 식을 못 읽고 깨집니다.
    f.push('scale=' + dims.w + ':' + dims.h + ':flags=lanczos');
    return f;
  }

  /** 필터그래프 전체. 결과 라벨은 언제나 [vout]. */
  function buildGraph(job, dims, extra) {
    var parts = [], cur = '[0:v]', n = 0;
    function next() { return '[v' + (++n) + ']'; }
    var chain = videoChain(job, dims).join(',');

    if (job.loop === 'pingpong') {
      // 정방향 + 역방향 이어 붙이기. reverse 는 프레임을 전부 메모리에 쌓으므로
      // 반드시 fps·scale 로 줄인 뒤에 돌립니다.
      var a = next(), b = next(), r = next(), o1 = next();
      parts.push(cur + chain + ',split=2' + a + b);
      parts.push(b + 'reverse' + r);
      parts.push(a + r + 'concat=n=2:v=1:a=0' + o1);
      cur = o1;
    } else if (job.loop === 'reverse') {
      var o2 = next();
      parts.push(cur + chain + ',reverse' + o2);
      cur = o2;
    } else {
      var o3 = next();
      parts.push(cur + chain + o3);
      cur = o3;
    }

    if (job.text) {
      var p = Math.max(0, Math.round(job.textPad));
      var size = Math.max(8, Math.round(job.textSize));
      var o4 = next();
      parts.push(cur + 'drawtext=fontfile=' + FILES.font + ':textfile=' + FILES.text + ':reload=0:' +
        'fontsize=' + size + ':fontcolor=white:borderw=' + Math.max(1, Math.round(size / 10)) + ':' +
        'bordercolor=black@0.85:line_spacing=4:' + (POS[job.textPos] || POS['bottom-left']).text(p) + o4);
      cur = o4;
    }

    if (extra.logoIdx != null) {
      var lw = Math.max(8, Math.round(dims.w * (job.logoScale || 18) / 100));
      var lp = Math.max(0, Math.round(job.logoPad));
      var lg = next(), o5 = next();
      parts.push('[' + extra.logoIdx + ':v]scale=' + lw + ':-1' + lg);
      parts.push(cur + lg + 'overlay=' + (POS[job.logoPos] || POS['bottom-right']).ov(lp) + o5);
      cur = o5;
    }

    if (job.fade > 0) {
      var dur = outDuration(job);
      var d = Math.min(job.fade, dur / 2.2);
      if (d > 0.04) {
        var o6 = next();
        parts.push(cur + 'fade=t=in:st=0:d=' + d.toFixed(3) +
          ',fade=t=out:st=' + (dur - d).toFixed(3) + ':d=' + d.toFixed(3) + o6);
        cur = o6;
      }
    }

    if (extra.paletteUse) {
      parts.push(cur + '[' + extra.paletteIdx + ':v]paletteuse=dither=' + job.dither + ':diff_mode=rectangle[vout]');
    } else if (extra.palettegen) {
      parts.push(cur + 'palettegen=max_colors=' + Math.max(4, Math.min(256, job.colors)) + ':stats_mode=full[vout]');
    } else {
      parts.push(cur + 'null[vout]');
    }
    return parts.join(';');
  }

  /**
   * 클립 하나를 만드는 ffmpeg 명령(패스) 목록.
   * `-ss <시작> -to <끝> -i 원본` 순서라 그 구간만 풉니다 (-to 는 절대시각입니다).
   */
  function buildPasses(job, inName, outName) {
    var dims = outSize(job);
    var fmt = ClipBox.presets.FORMATS[job.format];
    var ss = job.start.toFixed(3), to = job.end.toFixed(3);
    var passes = [];

    function head(withLogo, withPalette) {
      var a = ['-y', '-ss', ss, '-to', to, '-i', inName], extra = {}, idx = 1;
      if (withLogo) { a.push('-i', FILES.logo); extra.logoIdx = idx++; }
      if (withPalette) { a.push('-i', FILES.palette); extra.paletteIdx = idx++; }
      return { a:a, extra:extra };
    }

    if (fmt.twoPass) {
      var p1 = head(!!job.logo, false);
      p1.extra.palettegen = true;
      p1.a.push('-filter_complex', buildGraph(job, dims, p1.extra), '-map', '[vout]',
        '-frames:v', '1', '-update', '1', FILES.palette);
      passes.push({ args:p1.a, weight:0.35, label:'색을 고르는 중입니다' });

      var p2 = head(!!job.logo, true);
      p2.extra.paletteUse = true;
      p2.a.push('-filter_complex', buildGraph(job, dims, p2.extra), '-map', '[vout]',
        '-an', '-loop', '0', '-f', 'gif', outName);
      passes.push({ args:p2.a, weight:0.65, label:'굽는 중입니다' });
    } else if (job.format === 'webp') {
      var pw = head(!!job.logo, false);
      pw.a.push('-filter_complex', buildGraph(job, dims, pw.extra), '-map', '[vout]',
        '-an', '-c:v', 'libwebp', '-lossless', '0',
        '-q:v', String(Math.round(job.quality)), '-loop', '0', outName);
      passes.push({ args:pw.a, weight:1, label:'굽는 중입니다' });
    } else {
      var pm = head(!!job.logo, false);       // MP4 — 소리 없음 고정
      pm.a.push('-filter_complex', buildGraph(job, dims, pm.extra), '-map', '[vout]',
        '-an', '-c:v', 'libx264', '-preset', 'veryfast',
        '-crf', String(Math.round(job.crf)), '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', outName);
      passes.push({ args:pm.a, weight:1, label:'굽는 중입니다' });
    }
    return passes;
  }

  // ═══════════════════════════════════════════════════════════
  // 실행
  // ═══════════════════════════════════════════════════════════

  /** 원본을 가상 파일칸에 한 번만 올립니다 (클립 여러 개가 같이 씁니다) */
  function writeInput(inName, file) {
    return loadCore().then(function (ff) {
      return file.arrayBuffer().then(function (buf) {
        return ff.writeFile(inName, new Uint8Array(buf));
      });
    });
  }

  function writeAux(job) {
    return loadCore().then(function (ff) {
      var chain = Promise.resolve();
      if (job.text) {
        chain = chain.then(ensureFont).then(function (f) {
          return ff.writeFile(FILES.font, f);
        }).then(function () {
          return ff.writeFile(FILES.text, new TextEncoder().encode(job.text));
        });
      }
      if (job.logo) {
        chain = chain.then(function () { return job.logo.arrayBuffer(); })
          .then(function (b) { return ff.writeFile(FILES.logo, new Uint8Array(b)); });
      }
      return chain;
    });
  }

  function quietDelete(names) {
    if (!ffmpeg || !ffmpeg.loaded) return Promise.resolve();
    return names.reduce(function (p, n) {
      return p.then(function () { return ffmpeg.deleteFile(n).catch(function () {}); });
    }, Promise.resolve());
  }

  /**
   * 클립 하나를 굽습니다. onProgress(0~1, 라벨)
   * 그만두기는 terminate() 로 — 여기서 던지는 예외를 부르는 쪽이 받습니다.
   */
  function encodeClip(job, inName, outName, onProgress) {
    var ff, passes, dur, baseR = 0;
    return loadCore().then(function (f) {
      ff = f;
      return writeAux(job);
    }).then(function () {
      passes = buildPasses(job, inName, outName);
      dur = outDuration(job);
      return passes.reduce(function (chain, p) {
        return chain.then(function () {
          progressCb = function (e) {
            var t = (e.time || 0) / 1e6;
            var r = Math.max(0, Math.min(1, dur > 0 ? t / dur : 0));
            onProgress && onProgress(baseR + r * p.weight, p.label);
          };
          execCount++;
          return ff.exec(p.args).then(function (ret) {
            progressCb = null;
            if (terminated) throw new Error('그만뒀습니다');
            if (ret !== 0) throw new Error('ffmpeg 이 ' + ret + ' 로 끝났습니다');
            baseR += p.weight;
            onProgress && onProgress(baseR, p.label);
          });
        });
      }, Promise.resolve());
    }).then(function () {
      return ff.readFile(outName);
    }).then(function (data) {
      return quietDelete([outName, FILES.palette]).then(function () { return new Uint8Array(data); });
    }).catch(function (e) {
      progressCb = null;
      // wasm 이 한 번 트랩을 내면 그 인스턴스는 되살릴 수 없습니다. 조용히 버립니다.
      if (isFatal(e)) terminate();
      else quietDelete([outName, FILES.palette]);
      throw e;
    });
  }

  ClipBox.ff = {
    CORE_VERSION: CORE_VERSION, FILES: FILES,
    loadCore: loadCore, reload: reload, terminate: terminate,
    isLoaded: isLoaded, isFatal: isFatal, needsRecycle: needsRecycle,
    probeInput: probeInput, makeProxy: makeProxy,
    writeInput: writeInput, encodeClip: encodeClip,
    buildPasses: buildPasses, outSize: outSize, outDuration: outDuration,
    recentLog: function () { return logLines.slice(); }
  };
})();
