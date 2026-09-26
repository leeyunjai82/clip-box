// ═══════════════════════════════════════════════════════════
// 다국어 (한국어 / English)
// ═══════════════════════════════════════════════════════════
// 설계
//  · 한국어 원문을 그대로 '키' 로 쓴다 → 사전에 없으면 한국어가 그대로 나오므로
//    번역이 빠져도 화면이 깨지지 않는다.
//  · HTML 은 손대지 않는다. 페이지가 뜨면 DOM 을 훑어서 텍스트를 바꾼다.
//  · 언어 설정은 localStorage 키 'clip-box:language' 에 둔다 (ko | en).
//    dibrain.dev 의 다른 앱과 같은 출처라 앱 이름으로 시작한다. 옛 'language' 는 records.js 가 옮긴다.
//  · 사용자가 적은 자막 문구·파일 이름은 사전에 없으므로 번역되지 않는다 (의도된 동작).
//
// 주의: 번역할 문장 안에 <span> 같은 인라인 요소를 넣지 말 것.
//       텍스트 노드가 쪼개져 사전 키와 맞지 않는다.

window.ClipBox = window.ClipBox || {};

var GL_LANG = (function () {
  try {
    var saved = localStorage.getItem('clip-box:language');
    if (saved === 'ko' || saved === 'en') return saved;
  } catch (e) {}
  var nav = (navigator.language || navigator.userLanguage || 'ko');
  return nav.toLowerCase().indexOf('ko') === 0 ? 'ko' : 'en';
})();
document.documentElement.lang = GL_LANG;   // 화면 읽기·번역기·글꼴 고르기가 지금 언어를 알게

var GL_I18N = {
  // ── 페이지 · 헤더 ──
  '클립박스 — 영상 자르기': 'Clip Box — Video trim',
  '클립박스': 'Clip Box',
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

  // ── 왼쪽: 담아 둔 구간 ──
  '담아 둔 구간': 'Saved ranges',
  '영상을 여기에 놓거나 눌러서 고릅니다': 'Drop a video here, or click to choose',
  '영상 고르기': 'Choose a video',
  'MP4 · MOV · WEBM을 받습니다. 다시 놓으면 그 영상으로 바뀝니다.':
    'MP4, MOV and WEBM are accepted. Drop another one and it replaces this video.',
  '길이': 'Length',
  '크기': 'Size',
  '용량': 'File size',
  '300MB가 넘습니다. 메모리가 모자라 실패할 수 있으니 폰에서 먼저 잘라 오세요.':
    'Over 300MB. It may fail from lack of memory — trim it on your phone first.',
  '한 영상에서 여러 군데를 뽑을 때만 씁니다.': 'Only needed when you want several parts of one video.',
  '고른 구간 빼기': 'Remove checked ranges',
  '구간 모두 비우기': 'Clear all ranges',
  '빼기': 'Remove',

  // ── 가운데 ──
  '미리보기': 'Preview',
  '먼저 영상을 넣어 주세요.': 'Add a video first.',
  '영상은 이 브라우저 안에서만 처리되며 어디에도 전송되지 않습니다.':
    'Your video is processed in this browser only and is never sent anywhere.',
  '영상을 넣고 → 아래 필름에서 자를 곳을 고르고 → 만들기를 누르면 끝입니다.':
    'Add a video → pick the part on the filmstrip below → press make. That is all.',
  '끌면 길이를 유지한 채 구간이 통째로 움직입니다': 'Drag to move the whole range without changing its length',

  // ── 1. 구간 고르기 ──
  '얼마나 자를까요': 'How long',
  '3초': '3s', '5초': '5s', '10초': '10s', '전체': 'Whole clip',
  '누르면 지금 시작점에서 그만큼 잡습니다.': 'Takes that much from where the range starts now.',
  '고른 구간': 'Chosen range',
  '시작': 'In',
  '끝': 'Out',
  '예상': 'Approx.',
  '여기를 시작으로': 'Set in point',
  '여기를 끝으로': 'Set out point',
  '아래 필름에서 청록 손잡이를 끌어도 됩니다. 구간 안쪽을 끌면 길이를 유지한 채 통째로 옮겨집니다.':
    'You can also drag the teal handles on the filmstrip. Dragging inside the range moves it without changing its length.',
  '재생 · 멈춤 (Space)': 'Play / pause (Space)',
  'Space 재생·멈춤 · ←→ 한 프레임 · Shift+←→ 1초 · 재생 중 I·O 로 시작·끝 잡기':
    'Space play/pause · ←→ one frame · Shift+←→ 1s · press I and O while playing to set in/out',
  '구간 시작으로': 'Back to range start',
  '구간만 반복 재생': 'Loop the range only',
  '사진 한 장': 'A single photo',
  '지금 화면을 사진으로': 'Save this frame as a photo',

  // ── 2. 다듬기 ──
  '잘라내기': 'Crop',
  '칸 그리기': 'Draw a box',
  '가운데로': 'Center it',
  '자유': 'Free',
  '지금': 'Now',
  '원본 그대로': 'Whole frame',
  '원본보다 크게 만들지는 않습니다.': 'Never upscales past the source.',
  '켜면 영상 위를 끌어 칸을 그립니다. 끄면 원본 그대로 나갑니다. 세로 영상에서 정사각형을 뽑을 때 씁니다.':
    'Turn it on and drag on the video to draw a box; off means the whole frame. Handy for pulling a square out of a portrait clip.',
  '배속 · 방향': 'Speed and direction',
  '배속': 'Speed',
  '정방향': 'Forward',
  '역재생': 'Reverse',
  '핑퐁': 'Ping-pong',
  '핑퐁은 정방향 뒤에 역방향을 이어 붙이므로 길이가 두 배가 됩니다.':
    'Ping-pong appends the reverse after the forward pass, so the result is twice as long.',
  '회전 · 페이드 · 글자 · 로고': 'Rotation, fade, text, logo',
  '회전 · 페이드': 'Rotation and fade',
  '자동': 'Auto',
  '페이드': 'Fade',
  '회전은 대개 자동으로 맞습니다. 폰 영상이 옆으로 누워 나올 때만 직접 고릅니다.':
    'Rotation is usually handled automatically. Pick one only if a phone video comes out sideways.',
  '글자 한 줄': 'One line of text',
  '예: 여기서 버튼을 누릅니다': 'e.g. Press the button here',
  '왼위': 'T-L', '오른위': 'T-R', '왼아래': 'B-L', '오른아래': 'B-R',
  '글자': 'Text',
  '여백': 'Margin',
  '한글 글꼴을 함께 넣어 두어 글자가 깨지지 않습니다.':
    'A Korean font ships with the tool, so Hangul never turns into boxes.',
  '로고': 'Logo',
  '로고 그림 고르기': 'Choose a logo image',

  // ── 3. 크기·용량 ──
  '어디에 쓸 영상인가요': 'What is it for',
  '작게': 'Small', '보통': 'Medium', '크게': 'Large',
  '형식': 'Format',
  '어디에 붙여도 바로 움직입니다. 대신 용량이 가장 큽니다.':
    'Plays anywhere you paste it. The largest files, though.',
  'GIF와 똑같이 쓰면서 용량은 훨씬 작습니다. 요즘 브라우저는 다 읽습니다.':
    'Used just like a GIF but far smaller. Every current browser reads it.',
  '가장 작고 매끄럽습니다. 소리는 넣지 않습니다.':
    'Smallest and smoothest. Never carries sound.',
  '가로 · 프레임 · 화질 · 목표 용량': 'Width, frame rate, quality, target size',
  '가로': 'Width',
  '프레임': 'Frame rate',
  '색 수': 'Colors',
  '디더링': 'Dithering',
  '화질': 'Quality',
  '색 수를 줄이면 용량이 줄고, 디더링을 끄면 화면 녹화는 훨씬 작아집니다.':
    'Fewer colors means a smaller file, and turning dithering off shrinks screen recordings a lot.',
  '숫자가 높을수록 선명하고 커집니다.': 'Higher is sharper and bigger.',
  '숫자가 낮을수록 선명하고 커집니다.': 'Lower is sharper and bigger.',
  '목표 용량': 'Target size',
  '맞추기': 'Fit',
  '켜 두면 넘칠 때 알아서 낮춰 다시 만듭니다. 최대 3번 해 봅니다.':
    'When on, it lowers the settings and re-encodes until it fits. Up to 3 tries.',
  '지금 값으로 저장': 'Save these values',
  '기본값으로': 'Reset to defaults',

  // ── 4. 내보내기 ──
  '결과': 'Result',
  '만든 것이 여기에 쌓입니다. 아래 줄에서 이 구간 만들기를 누르세요.':
    'What you make collects here. Press `Make this range` on the bar below.',
  '결과 비우기': 'Clear results',
  '파일 이름': 'File name',
  '원본 이름과 구간 시각으로 짓습니다. 여러 개를 만들면 ZIP으로 묶습니다.':
    'Named after the source file and the range. Several clips are zipped together.',
  '내려받기': 'Download',
  'ZIP으로 내려받기': 'Download ZIP',
  '이 결과 빼기': 'Remove this result',
  '이 브라우저는 MP4를 못 풉니다. 파일은 정상이니 내려받아서 보세요.':
    'This browser cannot decode MP4. The file itself is fine — download it and play it there.',
  '목표 용량을 맞추지 못했습니다. 가장 작게 나온 결과입니다.':
    'Could not hit the target size. This is the smallest result.',

  // ── 아래 작업 줄 ──
  '이 구간 만들기': 'Make this range',
  '목록에 담기': 'Add to the list',
  '담은 것 모두 만들기': 'Make everything on the list',
  '그만두기': 'Stop',

  // ── 알림 ──
  '처리하는 중입니다': 'Working',
  '영상을 올리는 중입니다': 'Loading the video',
  '미리보기를 만드는 중입니다': 'Building the preview',
  '색을 고르는 중입니다': 'Picking colors',
  '만드는 중입니다': 'Making it',
  '다시 만드는 중입니다': 'Making it again',
  '묶는 중입니다': 'Zipping',
  '그만뒀습니다': 'Stopped',
  '아래 필름에서 청록 손잡이를 끌어 자를 곳을 고르세요':
    'Drag the teal handles on the filmstrip below to pick the part you want',
  '영상 파일이 아닙니다': 'That is not a video file',
  '빈 파일입니다': 'That file is empty',
  '이 파일에는 영상이 없습니다 (소리만 들어 있습니다)': 'There is no video in that file (audio only)',
  '로고와 겹치지 않게 글자를 옆 모서리로 옮겼습니다': 'Moved the text to the next corner so the logo does not cover it',
  '글자와 겹치지 않게 로고를 옆 모서리로 옮겼습니다': 'Moved the logo to the next corner so it does not cover the text',
  '그림 파일만 됩니다 (PNG · WEBP · JPG)': 'Images only (PNG, WEBP, JPG)',
  '만드는 중입니다. 끝나거나 그만둔 뒤에 바꾸세요': 'Still making it. Change the video after it finishes or you stop it',
  '영상을 읽지 못했습니다. 다른 파일로 해 보세요': 'Could not read the video. Try another file',
  '코어를 아직 못 불러왔습니다': 'The core is not loaded yet',
  '구간이 너무 짧습니다': 'The range is too short',
  '같은 구간이 이미 목록에 있습니다': 'That exact range is already in the list',
  '지금 화면을 사진으로 저장했습니다': 'Saved this frame as a photo',
  '목록을 비웠습니다': 'Cleared the list',
  '영상을 뺐습니다': 'Removed the video',
  '기본값으로 되돌렸습니다': 'Reset to defaults',
  '메모리가 모자랍니다. 구간을 짧게 하거나 가로 크기를 줄여 보세요':
    'Out of memory. Try a shorter range or a smaller width',
  '코어를 불러오지 못했습니다. 새로고침해 주세요': 'Could not load the core. Please refresh',
  '이 브라우저가 못 읽는 코덱이라 미리보기용 영상을 만들었습니다. 만드는 것은 언제나 원본입니다':
    'This browser cannot decode that codec, so a preview copy was made. The original is always what gets encoded',

  // 값이 들어가는 문장 (GL_TF)
  '구간을 목록에 담았습니다 ({n}개)': 'Range added to the list ({n})',
  '{name}을(를) 지금 값으로 저장했습니다': 'Saved the current values to `{name}`',
  '다 됐습니다 — {name} ({size})': 'Done — {name} ({size})',
  '{n}개를 만들었습니다. ZIP으로 받으세요': 'Made {n} clips. Grab the ZIP',
  '실패했습니다 — {why}': 'It failed — {why}',
  '{s}초쯤 남았습니다': 'About {s}s left',
  '체크한 {n}개를 뺄까요?': 'Remove the {n} checked clip(s)?',
  '목록을 모두 비울까요?': 'Clear the whole list?',
  '담아 둔 구간 {n}개도 같이 없어집니다. 영상을 뺄까요?':
    'The {n} saved range(s) go too. Remove the video?',
  '담아 둔 구간 {n}개도 같이 없어집니다. 다른 영상으로 바꿀까요?':
    'The {n} saved range(s) go too. Switch to the other video?',
  '{name} 을(를) 뺄까요?': 'Remove {name}?',
  '{n}초': '{n}s',
  '{n} / {total} MB': '{n} / {total} MB',

  // ── 기록 전체 삭제 (맨 아래 줄, records.js) ──
  '기록은 이 기기에만 저장됩니다. 설정 · 내려받아 둔 영상 엔진': 'Saved only on this device. Settings · downloaded video engine',
  '기록 전체 삭제': 'Delete all records',
  '이 앱에 저장된 기록을 모두 지웁니다(설정·프리셋·언어, 내려받아 둔 영상 엔진 — 다시 열면 32MB를 새로 받습니다). 되돌릴 수 없습니다. 계속할까요?':
    'This deletes everything Clip Box saved on this device (settings, presets, language, and the downloaded video engine — it will download 32 MB again next time). This cannot be undone. Continue?'
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

// ── 화면(HTML) 자동 번역 ──
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

// ── 언어 토글 버튼 (상단 바 맨 오른쪽) ──
// 세 앱(AI 샷 · 클립박스 · 스냅박스) 공통: 버튼에는 바꿀 언어를 쓴다 — 한국어 화면이면 'EN', 영어 화면이면 '한'.
function setLanguage(v) {
  try { localStorage.setItem('clip-box:language', v); } catch (e) {}
  location.reload();
}

function mountLangToggle() {
  var bar = document.querySelector('header.db-bar');
  if (!bar || document.getElementById('langToggle')) return;

  var toKo = (GL_LANG !== 'ko');
  var b = document.createElement('button');
  b.id = 'langToggle';
  b.className = 'db-btn';
  b.type = 'button';
  b.textContent = toKo ? '한' : 'EN';
  b.title = '한국어 / English';
  b.setAttribute('aria-label', toKo ? '한국어로 보기' : 'View in English');
  b.lang = toKo ? 'ko' : 'en';
  b.addEventListener('click', function () { setLanguage(toKo ? 'ko' : 'en'); });
  bar.appendChild(b);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () { localizeDOM(); mountLangToggle(); });
} else { localizeDOM(); mountLangToggle(); }

ClipBox.i18n = { t: GL_T, tf: GL_TF, localizeDOM: localizeDOM, get lang() { return GL_LANG; } };
