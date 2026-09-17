// ═══════════════════════════════════════════════════════════════════════
// i18n.js — 모든 UI 문자열은 여기 한 곳에만 둔다.
// ═══════════════════════════════════════════════════════════════════════
// snap-box js/i18n.js 와 같은 방식이다 (docs/DESIGN.md §6).
//  · HTML 에는 data-i18n="키" 만 적는다. 문자열은 여기에만 있다.
//  · 키는 `영역.이름` 꼴. 값 안의 {n} 은 t() 가 채운다.
//  · en 에 없는 키는 ko 로 떨어지므로 번역이 덜 돼도 화면이 안 깨진다.
//  · 언어 설정은 자매 도구가 같이 쓰는 localStorage 의 'language' 키.

const ko = {
  'app.tagline': '브라우저 안에서 끝내는 시연 영상 자르기',
  'app.privacy': '영상은 이 브라우저 안에서만 처리되며 어디에도 전송되지 않습니다.',
  'app.close': '닫기',
  'app.langTitle': '한국어 / English',

  // ── 왼쪽: 영상 · 클립 ──
  'queue.title': '클립 큐',
  'queue.drop': '여기로 영상을 끌어다 놓으세요',
  'queue.pick': '파일 선택',
  'queue.change': '다른 영상 고르기',
  'queue.dupe': '같은 구간이 이미 큐에 있습니다.',
  'queue.hint': '구간을 잡고 `구간 담기` 를 누르면 여러 개를 한 번에 구울 수 있습니다.',
  'queue.clear': '큐 비우기',
  'queue.removeSel': '선택 삭제',
  'queue.added': '구간을 큐에 담았습니다. ({n}개)',
  'queue.cleared': '큐를 비웠습니다.',

  'file.length': '길이',
  'file.size': '크기',
  'file.bytes': '용량',
  'file.proxy': '이 브라우저가 못 읽는 코덱이라 미리보기용 영상을 따로 만들었습니다. 굽는 것은 언제나 원본입니다.',
  'file.big': '300MB 가 넘습니다. 메모리 부족으로 실패할 수 있으니 폰에서 먼저 잘라 오세요.',

  // ── 가운데: 화면 ──
  'stage.empty': '영상 없음',
  'stage.hint': '왼쪽에서 영상을 추가하면 여기에 표시됩니다.',
  'stage.crop': '크롭',
  'stage.still': '현재 프레임',
  'stage.stillTitle': '지금 보이는 프레임을 PNG 로 저장',
  'stage.ratio': '비율',
  'stage.free': '자유',
  'stage.cropClear': '크롭 지우기',

  'range.in': '시작',
  'range.out': '끝',
  'range.len': '구간',
  'range.est': '예상',
  'range.dragTitle': '끌면 길이를 유지한 채 구간이 통째로 움직입니다',
  'range.keys': 'I 시작 · O 끝 · Space 재생 · ←→ 한 프레임 · Shift+←→ 1초',

  // ── 오른쪽: 탭 ──
  'tab.out': '출력',
  'tab.tf': '변형',
  'tab.deco': '꾸미기',
  'tab.res': '결과',

  'out.preset': '프리셋',
  'out.presetSave': '지금 값으로 저장',
  'out.presetReset': '기본값으로',
  'out.presetSaved': '`{name}` 프리셋을 지금 값으로 저장했습니다.',
  'out.presetsReset': '프리셋을 기본값으로 되돌렸습니다.',
  'out.format': '형식 · 화질',
  'out.width': '가로',
  'out.fps': '프레임률',
  'out.colors': '색 수',
  'out.dither': '디더링',
  'out.quality': '품질',
  'out.crf': 'CRF',
  'out.hintGif': '팔레트를 뽑고(palettegen) 칠하는(paletteuse) 2패스로 굽습니다. bayer 가 가장 작습니다.',
  'out.hintWebp': 'libwebp 애니메이션. 같은 화질이면 GIF 보다 훨씬 작습니다.',
  'out.hintMp4': 'libx264 · 소리 없음 고정 · faststart. CRF 는 낮을수록 좋고 큽니다.',
  'out.fit': '목표 용량',
  'out.fitOn': '목표 용량 맞추기',
  'out.target': '목표',
  'out.fitHint': '넘으면 프레임률 → 해상도 → 색 수 순으로 낮춰 다시 굽습니다. 최대 3회.',

  'tf.crop': '크롭',
  'tf.cropOn': '크롭 켜기',
  'tf.cropOff': '크롭 끄기',
  'tf.cropClear': '지우기',
  'tf.cropNow': '지금',
  'tf.cropHint': '화면에서 박스를 끌어 자릅니다. 세로 영상에서 정사각형을 뽑을 때 씁니다.',
  'tf.whole': '전체',
  'tf.motion': '배속 · 방향',
  'tf.speed': '배속',
  'tf.fwd': '정방향',
  'tf.rev': '역재생',
  'tf.pp': '핑퐁',
  'tf.fade': '페이드',
  'tf.rotate': '회전',
  'tf.auto': '자동',
  'tf.rotateHint': '회전은 보통 자동으로 맞습니다. 폰 영상이 옆으로 누워 나올 때만 직접 고르세요.',

  'deco.text': '글자 한 줄',
  'deco.textPh': '예: 파이보가 인사합니다',
  'deco.size': '크기',
  'deco.pad': '여백',
  'deco.tl': '왼위',
  'deco.tr': '오른위',
  'deco.bl': '왼아래',
  'deco.br': '오른아래',
  'deco.textHint': '한글 글꼴을 같이 넣어 두어 글자가 깨지지 않습니다.',
  'deco.logo': '로고',
  'deco.logoClear': '빼기',
  'deco.logoSize': '로고 크기',

  'res.empty': '구운 결과가 여기에 쌓입니다.',
  'res.clear': '결과 비우기',
  'res.download': '내려받기',
  'res.zip': 'ZIP 내려받기',
  'res.miss': '목표 용량을 못 맞췄습니다. 가장 작게 나온 결과입니다.',
  'res.remove': '이 결과 지우기',
  'res.over': '목표({mb}MB)를 넘을 것 같습니다. 굽고 나서 자동으로 낮춰 다시 시도합니다.',

  // ── 아래 바 ──
  'bar.play': '재생 / 멈춤 (Space)',
  'bar.home': '구간 시작으로',
  'bar.loop': '구간 반복',
  'bar.in': 'I 시작',
  'bar.out': 'O 끝',
  'bar.addClip': '구간 담기',
  'bar.run': '이 구간 굽기',
  'bar.runAll': '큐 전체 굽기',
  'bar.cancel': '취소',

  // ── 상태 / 알림 ──
  'msg.coreLoading': 'ffmpeg 코어를 받는 중',
  'msg.coreStarting': '코어를 켜는 중',
  'msg.coreCached': '캐시에서 불러옴 — 바로 켜집니다',
  'msg.coreOnce': '한 번만 받으면 다음부터는 바로 켜집니다',
  'msg.coreReady': '준비됐습니다.',
  'msg.coreFail': '코어를 불러오지 못했습니다. 새로고침해 주세요.',
  'msg.loadingVideo': '영상을 올리는 중',
  'msg.buildingProxy': '미리보기를 만드는 중',
  'msg.palette': '색을 고르는 중',
  'msg.encoding': '굽는 중',
  'msg.reencoding': '다시 굽는 중',
  'msg.zipping': '묶는 중',
  'msg.eta': '{s}초쯤 남음',
  'msg.working': '처리 중…',
  'msg.done': '다 됐습니다 — {name} ({size})',
  'msg.doneAll': '{n}개를 구웠습니다. ZIP 으로 받으세요.',
  'msg.cancelling': '취소하는 중',
  'msg.cancelled': '취소했습니다.',
  'msg.failed': '실패했습니다 — {why}',
  'msg.oom': '메모리가 모자랍니다. 구간을 짧게 하거나 가로 크기를 줄여 보세요.',
  'msg.notVideo': '영상 파일이 아닙니다.',
  'msg.badVideo': '영상을 읽지 못했습니다. 다른 파일로 해 보세요.',
  'msg.needVideo': '먼저 영상을 불러오세요.',
  'msg.needCore': '코어를 아직 못 불러왔습니다.',
  'msg.tooShort': '구간이 너무 짧습니다.',
  'msg.stillSaved': '현재 프레임을 저장했습니다.',
};

const en = {
  'app.tagline': 'Cut demo videos into clips, entirely in your browser',
  'app.privacy': 'Your video is processed in this browser only and is never sent anywhere.',
  'app.close': 'Close',
  'app.langTitle': '한국어 / English',

  'queue.title': 'Clip queue',
  'queue.drop': 'Drop a video here',
  'queue.pick': 'Choose file',
  'queue.change': 'Choose another video',
  'queue.dupe': 'That exact range is already in the queue.',
  'queue.hint': 'Set a range and press `Add range` to encode several clips at once.',
  'queue.clear': 'Clear queue',
  'queue.removeSel': 'Remove checked',
  'queue.added': 'Range added to the queue. ({n})',
  'queue.cleared': 'Queue cleared.',

  'file.length': 'Length',
  'file.size': 'Size',
  'file.bytes': 'File size',
  'file.proxy': 'This browser cannot decode that codec, so a preview copy was made. Encoding always uses the original.',
  'file.big': 'Over 300MB. It may fail from lack of memory — trim it on your phone first.',

  'stage.empty': 'No video',
  'stage.hint': 'Add a video on the left and it shows up here.',
  'stage.crop': 'Crop',
  'stage.still': 'This frame',
  'stage.stillTitle': 'Save the current frame as PNG',
  'stage.ratio': 'Ratio',
  'stage.free': 'Free',
  'stage.cropClear': 'Clear crop',

  'range.in': 'In',
  'range.out': 'Out',
  'range.len': 'Range',
  'range.est': 'Approx.',
  'range.dragTitle': 'Drag to move the whole range without changing its length',
  'range.keys': 'I in · O out · Space play · ←→ one frame · Shift+←→ 1s',

  'tab.out': 'Output',
  'tab.tf': 'Transform',
  'tab.deco': 'Decorate',
  'tab.res': 'Result',

  'out.preset': 'Preset',
  'out.presetSave': 'Save these values',
  'out.presetReset': 'Reset to defaults',
  'out.presetSaved': 'Saved the current values to `{name}`.',
  'out.presetsReset': 'Presets reset to defaults.',
  'out.format': 'Format · quality',
  'out.width': 'Width',
  'out.fps': 'Frame rate',
  'out.colors': 'Colors',
  'out.dither': 'Dithering',
  'out.quality': 'Quality',
  'out.crf': 'CRF',
  'out.hintGif': 'Two passes: palettegen then paletteuse. `bayer` gives the smallest files.',
  'out.hintWebp': 'Animated libwebp. Much smaller than GIF at the same quality.',
  'out.hintMp4': 'libx264 · always silent · faststart. Lower CRF is better and bigger.',
  'out.fit': 'Target size',
  'out.fitOn': 'Fit to target size',
  'out.target': 'Target',
  'out.fitHint': 'If it is over, frame rate, then size, then colors go down and it re-encodes. Up to 3 tries.',

  'tf.crop': 'Crop',
  'tf.cropOn': 'Crop on',
  'tf.cropOff': 'Crop off',
  'tf.cropClear': 'Clear',
  'tf.cropNow': 'Now',
  'tf.cropHint': 'Drag the box on the video. Handy for pulling a square out of a portrait clip.',
  'tf.whole': 'Whole frame',
  'tf.motion': 'Speed · direction',
  'tf.speed': 'Speed',
  'tf.fwd': 'Forward',
  'tf.rev': 'Reverse',
  'tf.pp': 'Ping-pong',
  'tf.fade': 'Fade',
  'tf.rotate': 'Rotation',
  'tf.auto': 'Auto',
  'tf.rotateHint': 'Rotation is usually automatic. Pick one only if a phone video comes out sideways.',

  'deco.text': 'One line of text',
  'deco.textPh': 'e.g. PIBO says hello',
  'deco.size': 'Size',
  'deco.pad': 'Margin',
  'deco.tl': 'T-L',
  'deco.tr': 'T-R',
  'deco.bl': 'B-L',
  'deco.br': 'B-R',
  'deco.textHint': 'A Korean font ships with the tool, so Hangul never turns into boxes.',
  'deco.logo': 'Logo',
  'deco.logoClear': 'Remove',
  'deco.logoSize': 'Logo size',

  'res.empty': 'Encoded results collect here.',
  'res.clear': 'Clear results',
  'res.download': 'Download',
  'res.zip': 'Download ZIP',
  'res.miss': 'Could not hit the target size. This is the smallest result.',
  'res.remove': 'Remove this result',
  'res.over': 'Likely over the {mb}MB target. It will be lowered and re-encoded automatically.',

  'bar.play': 'Play / pause (Space)',
  'bar.home': 'Back to range start',
  'bar.loop': 'Loop range',
  'bar.in': 'I in',
  'bar.out': 'O out',
  'bar.addClip': 'Add range',
  'bar.run': 'Encode this range',
  'bar.runAll': 'Encode whole queue',
  'bar.cancel': 'Cancel',

  'msg.coreLoading': 'Downloading the ffmpeg core',
  'msg.coreStarting': 'Starting the core',
  'msg.coreCached': 'Loaded from cache — starts right away',
  'msg.coreOnce': 'Downloaded once, then it starts instantly',
  'msg.coreReady': 'Ready.',
  'msg.coreFail': 'Could not load the core. Please refresh.',
  'msg.loadingVideo': 'Loading the video',
  'msg.buildingProxy': 'Building the preview',
  'msg.palette': 'Picking colors',
  'msg.encoding': 'Encoding',
  'msg.reencoding': 'Re-encoding',
  'msg.zipping': 'Zipping',
  'msg.eta': '~{s}s left',
  'msg.working': 'Working…',
  'msg.done': 'Done — {name} ({size})',
  'msg.doneAll': 'Encoded {n} clips. Grab the ZIP.',
  'msg.cancelling': 'Cancelling',
  'msg.cancelled': 'Cancelled.',
  'msg.failed': 'It failed — {why}',
  'msg.oom': 'Out of memory. Try a shorter range or a smaller width.',
  'msg.notVideo': 'That is not a video file.',
  'msg.badVideo': 'Could not read the video. Try another file.',
  'msg.needVideo': 'Load a video first.',
  'msg.needCore': 'The core is not loaded yet.',
  'msg.tooShort': 'The range is too short.',
  'msg.stillSaved': 'Saved the current frame.',
};

const dict = { ko, en };

let lang = (function () {
  try {
    const saved = localStorage.getItem('language');
    if (saved === 'ko' || saved === 'en') return saved;
  } catch (e) {}
  const nav = navigator.language || navigator.userLanguage || 'ko';
  return nav.toLowerCase().indexOf('ko') === 0 ? 'ko' : 'en';
})();

/** 키 → 지금 언어의 문자열. {n} 자리는 vars 로 채운다. */
export function t(key, vars) {
  let s = (dict[lang] && dict[lang][key]) || dict.ko[key] || key;
  if (vars) {
    s = s.replace(/\{(\w+)\}/g, (m, k) =>
      Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m);
  }
  return s;
}

/** data-i18n / data-i18n-title / data-i18n-ph 를 채운다. */
export function apply(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  scope.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
  scope.querySelectorAll('[data-i18n-ph]').forEach(el => {
    el.placeholder = t(el.getAttribute('data-i18n-ph'));
  });
}

export function getLang() { return lang; }

export function setLang(l) {
  if (!dict[l]) return;
  lang = l;
  try { localStorage.setItem('language', l); } catch (e) {}
  document.documentElement.lang = l;
  apply(document);
}
