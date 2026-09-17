// ═══════════════════════════════════════════════════════════
// 다국어 (한국어 / English) — sense-lab lib/i18n.js 와 같은 방식
// ═══════════════════════════════════════════════════════════
// 설계 (sense-lab · 파이보 랩과 동일)
//  · 한국어 원문을 그대로 '키' 로 쓴다 → 사전에 없으면 한국어가 그대로 나오므로
//    번역이 빠져도 화면이 깨지지 않는다.
//  · HTML 은 손대지 않는다. 페이지가 뜨면 DOM 을 훑어서 텍스트를 바꾼다.
//  · 언어 설정은 같은 localStorage 키 'language' 를 쓴다.
//  · 사용자가 적은 자막 문구·파일 이름은 사전에 없으므로 번역되지 않는다 (의도된 동작).
//
// 주의: 번역할 문장 안에 <span> 같은 인라인 요소를 넣지 말 것.
//       텍스트 노드가 쪼개져 사전 키와 맞지 않는다.

window.ClipBox = window.ClipBox || {};

var GL_LANG = (function () {
  try {
    var saved = localStorage.getItem('language');
    if (saved === 'ko' || saved === 'en') return saved;
  } catch (e) {}
  var nav = (navigator.language || navigator.userLanguage || 'ko');
  return nav.toLowerCase().indexOf('ko') === 0 ? 'ko' : 'en';
})();

var GL_I18N = {
  // ── 페이지 · 헤더 ──
  'clip-box — 영상 자르기': 'clip-box — Video trim',
  '시연 영상 자르기': 'Demo video trim',
  '준비 중…': 'Getting ready…',
  '준비 완료': 'Ready',
  '코어를 받는 중': 'Downloading core',
  '코어를 여는 중': 'Starting core',
  '코어를 불러오지 못했습니다': 'Could not load the core',
  '전체화면': 'Full screen',

  // ── 작업 탭 ──
  '구간 고르기': 'Pick a range',
  '다듬기': 'Adjust',
  '크기·용량': 'Size',
  '내보내기': 'Export',

  // ── 왼쪽: 클립 목록 ──
  '클립 목록': 'Clips',
  '영상을 여기에 놓거나 눌러서 고릅니다': 'Drop a video here, or click to choose',
  'MP4 · MOV · WEBM을 받습니다. 브라우저가 못 읽는 코덱은 미리보기용 영상을 따로 만듭니다.':
    'MP4, MOV and WEBM are accepted. For codecs this browser cannot decode, a preview copy is built.',
  '길이': 'Length',
  '크기': 'Size',
  '용량': 'File size',
  '300MB가 넘습니다. 메모리가 모자라 실패할 수 있으니 폰에서 먼저 잘라 오세요.':
    'Over 300MB. It may fail from lack of memory — trim it on your phone first.',
  '고른 것 빼기': 'Remove checked',
  '모두 비우기': 'Clear all',

  // ── 가운데 ──
  '미리보기': 'Preview',
  '영상은 이 브라우저 안에서만 처리되며 어디에도 전송되지 않습니다.':
    'Your video is processed in this browser only and is never sent anywhere.',
  '왼쪽에 영상을 넣으면 여기에 나옵니다.': 'Add a video on the left and it shows up here.',
  '끌면 길이를 유지한 채 구간이 통째로 움직입니다': 'Drag to move the whole range without changing its length',

  // ── 1. 구간 고르기 ──
  '구간': 'Range',
  '시작': 'In',
  '끝': 'Out',
  '예상': 'Approx.',
  '여기를 시작으로': 'Set in point',
  '여기를 끝으로': 'Set out point',
  '아래 필름에서 손잡이를 끌거나, 재생 중에 I·O 키로 잡습니다. 구간 안쪽을 끌면 길이를 유지한 채 통째로 옮겨집니다.':
    'Drag the handles on the filmstrip, or press I and O while playing. Dragging inside the range moves it without changing its length.',
  '재생': 'Play',
  '멈춤': 'Pause',
  '구간 시작으로': 'Back to range start',
  '구간 반복': 'Loop range',
  'Space 재생·멈춤 · ←→ 한 프레임 · Shift+←→ 1초':
    'Space play/pause · ←→ one frame · Shift+←→ 1s',
  '한 장으로': 'Single frame',
  '지금 프레임을 PNG로': 'Save this frame as PNG',

  // ── 2. 다듬기 ──
  '잘라내기': 'Crop',
  '칸 그리기': 'Draw a box',
  '칸 지우기': 'Clear the box',
  '지우기': 'Clear',
  '자유': 'Free',
  '지금': 'Now',
  '전체': 'Whole frame',
  '영상 위를 끌어 칸을 그립니다. 세로 영상에서 정사각형을 뽑을 때 씁니다.':
    'Drag on the video to draw a box. Handy for pulling a square out of a portrait clip.',
  '배속 · 방향': 'Speed and direction',
  '배속': 'Speed',
  '정방향': 'Forward',
  '역재생': 'Reverse',
  '핑퐁': 'Ping-pong',
  '핑퐁은 정방향 뒤에 역방향을 이어 붙이므로 길이가 두 배가 됩니다.':
    'Ping-pong appends the reverse after the forward pass, so the result is twice as long.',
  '회전 · 페이드': 'Rotation and fade',
  '자동': 'Auto',
  '페이드': 'Fade',
  '회전은 대개 자동으로 맞습니다. 폰 영상이 옆으로 누워 나올 때만 직접 고릅니다.':
    'Rotation is usually handled automatically. Pick one only if a phone video comes out sideways.',
  '글자 한 줄': 'One line of text',
  '예: 파이보가 인사합니다': 'e.g. PIBO says hello',
  '왼위': 'T-L', '오른위': 'T-R', '왼아래': 'B-L', '오른아래': 'B-R',
  '글자': 'Text',
  '여백': 'Margin',
  '한글 글꼴을 함께 넣어 두어 글자가 깨지지 않습니다.':
    'A Korean font ships with the tool, so Hangul never turns into boxes.',
  '로고': 'Logo',
  '로고 그림 고르기': 'Choose a logo image',
  '빼기': 'Remove',

  // ── 3. 크기·용량 ──
  '어디에 쓰는 영상인가요': 'What is it for',
  '지금 값으로 저장': 'Save these values',
  '기본값으로': 'Reset to defaults',
  '형식 · 화질': 'Format and quality',
  '가로': 'Width',
  '프레임': 'Frame rate',
  '색 수': 'Colors',
  '디더링': 'Dithering',
  '품질': 'Quality',
  '팔레트를 뽑고 칠하는 2패스로 굽습니다. bayer가 가장 작게 나옵니다.':
    'Two passes: build a palette, then paint with it. `bayer` gives the smallest files.',
  'libwebp 애니메이션입니다. 같은 화질이면 GIF보다 훨씬 작습니다.':
    'Animated libwebp. Much smaller than GIF at the same quality.',
  'libx264 · 소리 없음 고정 · faststart. CRF는 낮을수록 좋고 커집니다.':
    'libx264, always silent, faststart. Lower CRF is better and bigger.',
  '목표 용량': 'Target size',
  '맞추기': 'Fit',
  '넘으면 프레임 → 해상도 → 색 수 순으로 낮춰 다시 굽습니다. 최대 3회 시도합니다.':
    'If it is over, the frame rate, then the size, then the colors go down and it re-encodes. Up to 3 tries.',

  // ── 4. 내보내기 ──
  '결과': 'Result',
  '구운 결과가 여기에 쌓입니다. 아래 줄에서 `이 구간 굽기`를 누르세요.':
    'Encoded results collect here. Press `Encode this range` on the bar below.',
  '결과 비우기': 'Clear results',
  '파일 이름': 'File name',
  '원본 이름과 구간 시각으로 짓습니다. 여러 개를 구우면 ZIP으로 묶습니다.':
    'Named after the source file and the range. Several clips are zipped together.',
  '내려받기': 'Download',
  'ZIP으로 내려받기': 'Download ZIP',
  '이 결과 빼기': 'Remove this result',
  '목표 용량을 맞추지 못했습니다. 가장 작게 나온 결과입니다.':
    'Could not hit the target size. This is the smallest result.',

  // ── 아래 작업 줄 ──
  '재생 · 멈춤 (Space)': 'Play / pause (Space)',
  '이 구간 굽기': 'Encode this range',
  '구간 담기': 'Add range',
  '목록 전체 굽기': 'Encode the whole list',
  '그만두기': 'Stop',

  // ── 알림 ──
  '처리하는 중입니다': 'Working',
  '영상을 올리는 중입니다': 'Loading the video',
  '미리보기를 만드는 중입니다': 'Building the preview',
  '색을 고르는 중입니다': 'Picking colors',
  '굽는 중입니다': 'Encoding',
  '다시 굽는 중입니다': 'Re-encoding',
  '묶는 중입니다': 'Zipping',
  '준비됐습니다': 'Ready',
  '그만뒀습니다': 'Stopped',
  '영상 파일이 아닙니다': 'That is not a video file',
  '영상을 읽지 못했습니다. 다른 파일로 해 보세요': 'Could not read the video. Try another file',
  '먼저 영상을 넣어 주세요': 'Add a video first',
  '코어를 아직 못 불러왔습니다': 'The core is not loaded yet',
  '구간이 너무 짧습니다': 'The range is too short',
  '같은 구간이 이미 목록에 있습니다': 'That exact range is already in the list',
  '지금 프레임을 저장했습니다': 'Saved the current frame',
  '목록을 비웠습니다': 'Cleared the list',
  '프리셋을 기본값으로 되돌렸습니다': 'Presets reset to defaults',
  '메모리가 모자랍니다. 구간을 짧게 하거나 가로 크기를 줄여 보세요':
    'Out of memory. Try a shorter range or a smaller width',
  '코어를 불러오지 못했습니다. 새로고침해 주세요': 'Could not load the core. Please refresh',
  '이 브라우저가 못 읽는 코덱이라 미리보기용 영상을 만들었습니다. 굽는 것은 언제나 원본입니다':
    'This browser cannot decode that codec, so a preview copy was made. Encoding always uses the original',

  // 값이 들어가는 문장 (GL_TF)
  '구간을 목록에 담았습니다 ({n}개)': 'Range added to the list ({n})',
  '{name} 프리셋을 지금 값으로 저장했습니다': 'Saved the current values to `{name}`',
  '다 됐습니다 — {name} ({size})': 'Done — {name} ({size})',
  '{n}개를 구웠습니다. ZIP으로 받으세요': 'Encoded {n} clips. Grab the ZIP',
  '실패했습니다 — {why}': 'It failed — {why}',
  '{s}초쯤 남았습니다': 'About {s}s left',
  '체크한 {n}개를 뺄까요?': 'Remove the {n} checked clip(s)?',
  '목록을 모두 비울까요?': 'Clear the whole list?',
  '{n} / {total} MB': '{n} / {total} MB'
};

// 한국어 원문 → 현재 언어. 사전에 없으면 원문 그대로.
function GL_T(ko) {
  if (GL_LANG === 'ko') return ko;
  var v = GL_I18N[ko];
  return (v === undefined) ? ko : v;
}

// 자리 채우기용 — GL_T 로 번역한 뒤 {키} 를 값으로 바꾼다.
function GL_TF(ko, vars) {
  var s = GL_T(ko);
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, function (m, k) {
    return Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m;
  });
}

// ── 화면(HTML) 자동 번역 — sense-lab 과 동일 ──
function localizeDOM(root) {
  if (GL_LANG === 'ko') return;
  var scope = root || document.body;
  if (!scope) return;

  var walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
  var hits = [], n;
  while ((n = walker.nextNode())) {
    var tag = n.parentNode && n.parentNode.nodeName;
    if (tag === 'SCRIPT' || tag === 'STYLE') continue;
    var raw = n.nodeValue.trim();
    if (!raw || GL_I18N[raw] === undefined) continue;
    hits.push([n, n.nodeValue.replace(raw, GL_I18N[raw])]);
  }
  hits.forEach(function (h) { h[0].nodeValue = h[1]; });

  ['title', 'placeholder'].forEach(function (attr) {
    scope.querySelectorAll('[' + attr + ']').forEach(function (el) {
      var v = GL_I18N[el.getAttribute(attr).trim()];
      if (v !== undefined) el.setAttribute(attr, v);
    });
  });

  if (document.title && GL_I18N[document.title.trim()] !== undefined)
    document.title = GL_I18N[document.title.trim()];
}

// ── 언어 토글 버튼 (sense-lab 과 같은 버튼·위치·저장 키) ──
function setLanguage(v) {
  try { localStorage.setItem('language', v); } catch (e) {}
  location.reload();
}

function mountLangToggle() {
  var bar = document.querySelector('header');
  if (!bar || document.getElementById('langToggle')) return;

  var toKo = (GL_LANG !== 'ko');
  var b = document.createElement('button');
  b.id = 'langToggle';
  b.type = 'button';
  b.textContent = toKo ? '한' : 'EN';
  b.title = '한국어 / English';
  b.addEventListener('click', function () { setLanguage(toKo ? 'ko' : 'en'); });
  bar.appendChild(b);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () { localizeDOM(); mountLangToggle(); });
} else { localizeDOM(); mountLangToggle(); }

ClipBox.i18n = { t: GL_T, tf: GL_TF, localizeDOM: localizeDOM, get lang() { return GL_LANG; } };
