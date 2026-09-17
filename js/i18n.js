// ═══════════════════════════════════════════════════════════
// 다국어 (한국어 / English) — sense-lab lib/i18n.js 와 같은 방식
// ═══════════════════════════════════════════════════════════
//  · 한국어 원문을 그대로 '키' 로 쓴다 → 사전에 없으면 한국어가 그대로 나오므로
//    번역이 빠져도 화면이 깨지지 않는다.
//  · HTML 은 손대지 않는다. 페이지가 뜨면 DOM 을 훑어서 텍스트를 바꾼다.
//  · 언어 설정은 sense-lab 과 같은 localStorage 키 'language' 를 쓴다.
//  · 사용자가 넣은 글(자막 문구·파일 이름)은 사전에 없으므로 번역되지 않는다.

export const LANG = (function () {
  try {
    const saved = localStorage.getItem('language');
    if (saved === 'ko' || saved === 'en') return saved;
  } catch (e) {}
  const nav = (navigator.language || navigator.userLanguage || 'ko');
  return nav.toLowerCase().indexOf('ko') === 0 ? 'ko' : 'en';
})();

const DICT = {
  // ── 페이지 / 헤더 / 푸터 ──
  'clip-box — 시연 영상에서 GIF 잘라내기': 'clip-box — Cut a GIF from a demo video',
  '시연 영상에서 구간을 잘라 GIF·WebP·MP4 로 만듭니다.': 'Cut a slice out of a demo video and turn it into a GIF, WebP or MP4.',
  '준비 중…': 'Getting ready…',
  '코어 받는 중': 'Downloading core',
  '코어 켜는 중': 'Starting core',
  '준비 완료': 'Ready',
  '코어를 불러오지 못했어요': 'Could not load the core',
  '새로고침해 주세요': 'Please refresh',
  '영상은 브라우저 밖으로 나가지 않습니다': 'Your video never leaves this browser',
  '모든 변환은 이 컴퓨터 안에서 ffmpeg.wasm 으로 처리합니다. 업로드도, 서버도 없습니다.':
    'Everything is converted right here with ffmpeg.wasm. No upload, no server.',
  '전체화면': 'Full screen',

  // ── 왼쪽: 영상 · 클립 목록 ──
  '영상': 'Video',
  '영상 파일을 여기에 놓으세요': 'Drop a video file here',
  '또는 눌러서 고르기 — MP4 / MOV / WebM': 'or click to choose — MP4 / MOV / WebM',
  '다른 영상 고르기': 'Choose another video',
  '길이': 'Length',
  '크기': 'Size',
  '용량': 'File size',
  '클립 목록': 'Clips',
  '지금 구간을 클립으로': 'Add current range as a clip',
  '클립을 더하면 한꺼번에 구울 수 있어요.': 'Add clips to encode them all at once.',
  '모두 굽기 → ZIP': 'Encode all → ZIP',
  '클립': 'clips',
  '720px · 15fps · MP4 (무음)': '720px · 15fps · MP4 (no sound)',
  '지우기': 'Delete',
  '이 클립 지우기': 'Delete this clip',
  '이 클립 불러오기': 'Load this clip',
  '덮어쓰기': 'Overwrite',
  '지금 구간으로 덮어쓰기': 'Overwrite with the current range',
  '영상이 커요 (300MB 넘음). 메모리 부족으로 실패할 수 있습니다. 폰에서 먼저 구간을 잘라 오세요.':
    'This file is large (over 300MB). It may fail from lack of memory. Try trimming it on your phone first.',
  '영상 파일이 아니에요': 'That is not a video file',
  '영상을 읽지 못했어요. 다른 파일로 해 보세요': 'Could not read the video. Try another file',
  '이 브라우저가 못 읽는 코덱이라 미리보기용 영상을 따로 만들었어요. 굽는 것은 언제나 원본입니다.':
    'This browser cannot decode that codec, so a preview copy was made. Encoding always uses the original.',
  '미리보기 만드는 중': 'Building the preview',

  // ── 가운데: 플레이어 · 타임라인 ──
  '구간 고르기': 'Pick a range',
  '영상을 불러오면 여기에 나와요': 'Your video shows up here',
  '재생': 'Play',
  '멈춤': 'Pause',
  '구간 반복': 'Loop range',
  '처음으로': 'Back to start',
  '시작': 'In',
  '끝': 'Out',
  '시작점 (I)': 'In point (I)',
  '끝점 (O)': 'Out point (O)',
  '구간 길이': 'Range',
  '예상 용량': 'Approx. size',
  '크롭 켜기': 'Crop on',
  '크롭 끄기': 'Crop off',
  '비율': 'Ratio',
  '자유': 'Free',
  '전체': 'Whole frame',
  '크롭 지우기': 'Clear crop',
  '현재 프레임 저장 (PNG)': 'Save this frame (PNG)',
  'I = 시작, O = 끝, Space = 재생/멈춤, ← → = 한 프레임':
    'I = in, O = out, Space = play/pause, ← → = one frame',

  // ── 오른쪽: 도구 ──
  '출력': 'Output',
  '변형': 'Transform',
  '꾸미기': 'Decorate',
  '결과': 'Result',
  '프리셋': 'Preset',
  '지금 값으로 프리셋 저장': 'Save these values to the preset',
  '프리셋 되돌리기': 'Reset presets',
  '저장했어요': 'Saved',
  '되돌렸어요': 'Reset',
  '형식': 'Format',
  '가로 크기': 'Width',
  '프레임률': 'Frame rate',
  '색 수': 'Colors',
  '디더링': 'Dithering',
  '품질': 'Quality',
  '화질 (CRF, 낮을수록 좋음)': 'Quality (CRF, lower is better)',
  '목표 용량 맞추기': 'Fit to a target size',
  '목표': 'Target',
  '목표 용량을 넘으면 프레임률 → 해상도 → 색 수 순으로 낮춰 다시 굽습니다 (최대 3회).':
    'If it is over, the frame rate, then the size, then the colors go down and it re-encodes (up to 3 tries).',
  '크롭': 'Crop',
  '박스를 끌어 자릅니다. 세로 영상에서 정사각형을 뽑을 때 씁니다.':
    'Drag the box to cut. Handy for pulling a square out of a portrait video.',
  '배속': 'Speed',
  '재생 방향': 'Direction',
  '정방향': 'Forward',
  '역재생': 'Reverse',
  '핑퐁 (정→역)': 'Ping-pong (forward then back)',
  '회전': 'Rotation',
  '자동': 'Auto',
  '회전은 보통 자동으로 맞습니다. 폰 영상이 옆으로 누워 나오면 직접 고르세요.':
    'Rotation is usually handled automatically. If a phone video comes out sideways, pick it by hand.',
  '페이드 인/아웃': 'Fade in / out',
  '없음': 'None',
  '글자 한 줄': 'One line of text',
  '예: 파이보가 인사합니다': 'e.g. PIBO says hello',
  '글자 크기': 'Text size',
  '여백': 'Margin',
  '위치': 'Position',
  '왼쪽 위': 'Top left',
  '오른쪽 위': 'Top right',
  '왼쪽 아래': 'Bottom left',
  '오른쪽 아래': 'Bottom right',
  '로고': 'Logo',
  '로고 그림 고르기 (PNG)': 'Choose a logo image (PNG)',
  '로고 지우기': 'Remove the logo',
  '로고 크기': 'Logo size',

  // ── 굽기 / 결과 ──
  '굽기': 'Encode',
  '이 구간 굽기': 'Encode this range',
  '취소': 'Cancel',
  '준비하는 중': 'Getting ready',
  '영상 올리는 중': 'Loading the video',
  '색 고르는 중': 'Picking colors',
  '굽는 중': 'Encoding',
  '다시 굽는 중': 'Re-encoding',
  '묶는 중': 'Zipping',
  '다 됐어요': 'Done',
  '취소했어요': 'Cancelled',
  '내려받기': 'Download',
  '모두 내려받기 (ZIP)': 'Download all (ZIP)',
  '결과가 여기에 나와요': 'Your result shows up here',
  '목표 용량을 못 맞췄어요. 가장 작게 나온 결과입니다.':
    'Could not hit the target size. This is the smallest result.',
  '시도': 'Try',
  '번째': '',
  '실패했어요': 'It failed',
  '메모리가 모자랐어요. 구간을 짧게 하거나 가로 크기를 줄여 보세요.':
    'Out of memory. Try a shorter range or a smaller width.',
  '먼저 영상을 불러오세요': 'Load a video first',
  '코어를 아직 못 불러왔어요': 'The core is not loaded yet',
  '구간이 너무 짧아요': 'The range is too short',
};

/** 한국어 원문 → 현재 언어. 사전에 없으면 원문 그대로. */
export function T(ko) {
  if (LANG === 'ko') return ko;
  const v = DICT[ko];
  return (v === undefined) ? ko : v;
}

/**
 * 화면(HTML) 자동 번역 — sense-lab 과 동일.
 * HTML 파일은 손대지 않는다. 텍스트 노드와 title/placeholder 만 바꿔치기한다.
 */
export function localizeDOM(root) {
  if (LANG === 'ko') return;
  const scope = root || document.body;
  if (!scope) return;

  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
  const hits = [];
  let n;
  while ((n = walker.nextNode())) {
    const tag = n.parentNode && n.parentNode.nodeName;
    if (tag === 'SCRIPT' || tag === 'STYLE') continue;
    const raw = n.nodeValue.trim();
    if (!raw || DICT[raw] === undefined) continue;
    hits.push([n, n.nodeValue.replace(raw, DICT[raw])]);
  }
  hits.forEach(h => { h[0].nodeValue = h[1]; });

  ['title', 'placeholder', 'aria-label'].forEach(attr => {
    scope.querySelectorAll('[' + attr + ']').forEach(el => {
      const v = DICT[el.getAttribute(attr).trim()];
      if (v !== undefined) el.setAttribute(attr, v);
    });
  });

  if (document.title && DICT[document.title.trim()] !== undefined)
    document.title = DICT[document.title.trim()];
}

function setLanguage(v) {
  try { localStorage.setItem('language', v); } catch (e) {}
  location.reload();
}

/** 언어 토글 버튼 — sense-lab 과 같은 버튼·위치 */
export function mountLangToggle() {
  const bar = document.querySelector('header');
  if (!bar || document.getElementById('langToggle')) return;

  const toKo = (LANG !== 'ko');
  const b = document.createElement('button');
  b.id = 'langToggle';
  b.type = 'button';
  b.textContent = toKo ? '한' : 'EN';
  b.title = '한국어 / English';
  b.style.cssText =
    'border:1.5px solid var(--line,#9A8F7D);background:var(--panel,#fff);' +
    'color:var(--ink,#2A2620);border-radius:var(--r-s,6px);padding:6px 10px;' +
    'font-size:12.5px;font-weight:600;min-width:46px;text-align:center;line-height:1;' +
    'font-family:inherit;cursor:pointer';
  b.addEventListener('click', function () { setLanguage(toKo ? 'ko' : 'en'); });

  bar.appendChild(b);
}
