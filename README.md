# clip-box

시연 영상에서 짧은 구간을 잘라 문서·README·SNS용 **GIF / WebP / MP4** 로 만드는 브라우저 도구입니다.

**→ https://leeyunjai82.github.io/clip-box/**

![clip-box 로 만든 예시 GIF](docs/clip-box-demo.gif)

*위 GIF 는 clip-box 를 쓰는 화면을 녹화해서, 다시 clip-box 의 `README` 프리셋(480px · 10fps · GIF)으로 구운 것입니다.*

---

## 🔒 영상은 브라우저 밖으로 나가지 않습니다

인코딩은 전부 **여러분의 PC 안에서** [`ffmpeg.wasm`](https://github.com/ffmpegwasm/ffmpeg.wasm) 으로 돌아갑니다.
업로드도, 서버도, 계정도 없습니다. 페이지를 연 뒤에는 바깥으로 나가는 네트워크 요청이 **하나도** 없습니다
(개발자 도구 Network 탭에서 직접 확인할 수 있습니다). 라이브러리와 ffmpeg 코어까지 전부 이 저장소에 함께 들어 있습니다.

---

## 쓰는 법

1. 영상을 **끌어다 놓거나** 눌러서 고릅니다. (MP4 / MOV / WebM)
2. 타임라인에서 **시작·끝 손잡이**를 끌거나, 재생 중에 `I` / `O` 키로 구간을 잡습니다.
3. 오른쪽에서 **프리셋**을 고릅니다.
4. **이 구간 굽기** → 미리보기가 나오면 **내려받기**.

세로 영상을 놓고 README 프리셋으로 GIF 를 받는 데까지 **클릭 3번**입니다.

### 단축키

| 키 | 하는 일 |
|---|---|
| `I` / `O` | 지금 위치를 구간 시작 / 끝으로 |
| `Space` | 재생 / 멈춤 |
| `←` `→` | 한 프레임씩 (`Shift` 와 함께 누르면 1초씩) |
| `Home` / `End` | 구간 시작 / 끝으로 이동 |

---

## 프리셋

| 프리셋 | 크기 | 프레임률 | 형식 | 비고 |
|---|---|---|---|---|
| **README** | 480px | 10fps | GIF | 128색 · sierra2_4a |
| **매뉴얼** | 640px | 12fps | WebP | 품질 75 |
| **SNS** | 720px | 15fps | MP4 | 소리 없음 (고정) |
| **카톡** | 360px | 10fps | GIF | 64색 · 5MB 이하 |

값은 화면에서 바로 고칠 수 있고, **지금 값으로 프리셋 저장** 을 누르면 `localStorage` 에 남습니다.
(설정값만 저장합니다. 영상 데이터는 절대 저장하지 않습니다.)

---

## 할 수 있는 것

- **구간 자르기** — 타임라인 손잡이 / `I`·`O` 키, 구간만 반복 재생, 구간 길이·예상 용량 표시
- **크롭** — 플레이어 위에서 박스를 끌어 자릅니다. 비율 고정 `1:1` `16:9` `4:3` `9:16` `자유`.
  세로 영상에서 정사각형을 뽑을 때 씁니다.
- **배속 · 방향** — 0.5× ~ 4×, 역재생, 핑퐁(정→역)
- **목표 용량 맞추기** — 목표 MB 를 넘으면 `프레임률 → 해상도 → 팔레트 색 수` 순으로 낮춰 다시 굽습니다 (최대 3회).
  못 맞추면 가장 작게 나온 결과와 함께 알려 줍니다.
- **여러 구간 → ZIP** — 한 영상에서 클립을 여러 개 등록해 한꺼번에 굽고 ZIP 으로 받습니다.
- **글자 한 줄 / 로고** — 한글 글꼴(Pretendard)을 같이 넣어 두어 `drawtext` 로 한글이 깨지지 않습니다.
  위치는 네 모서리 + 여백.
- **페이드 인/아웃**, **현재 프레임 PNG 저장**
- **한국어 / English** 전환

### GIF 는 팔레트 2패스로 굽습니다

`palettegen` 으로 그 구간에 딱 맞는 팔레트를 뽑은 뒤 `paletteuse` 로 칠합니다.
디더링은 `sierra2_4a`(기본) · `bayer` · `floyd_steinberg` · `sierra2` · `none` 중에 고릅니다.
`bayer` 가 가장 작게 나옵니다.

---

## 알아 둘 것

### 브라우저

**데스크톱 Chrome / Edge** 기준으로 만들었습니다. 모바일은 고려하지 않았습니다.

### 첫 로드는 약 32MB

ffmpeg 코어(wasm)를 한 번 받아야 합니다. 진행률이 화면에 나옵니다.
받은 뒤에는 Cache Storage 에 넣어 두므로 **두 번째부터는 바로 켜집니다**.

### 300MB 넘는 영상

메모리 부족으로 실패할 수 있습니다. 경고만 하고 진행은 막지 않습니다.
폰에서 먼저 대강 잘라 오는 편이 빠릅니다.

### 아이폰 영상 (HEVC)

브라우저가 코덱을 못 풀면 **미리보기용 영상(VP8/WebM)을 자동으로 만들어** 화면에 걸어 줍니다.
이때도 **굽는 것은 언제나 원본**이라 화질은 그대로입니다. 미리보기를 만드는 동안 진행률이 나옵니다.

### 회전 메타데이터

ffmpeg 이 기본으로 알아서 돌려 주고(`-autorotate`), `<video>` 도 같은 방향으로 보여 주므로
크롭 좌표가 서로 맞습니다. 그래도 옆으로 누워 나오면 **변형 탭 → 회전** 에서 직접 고르면 됩니다.

### MP4 는 소리가 없습니다

`-an` 고정입니다. 오디오 편집은 이 도구가 하는 일이 아닙니다.

### 멀티스레드를 쓰지 않습니다

GitHub Pages 는 `COOP`/`COEP` 헤더를 줄 수 없어서 `SharedArrayBuffer` 가 막힙니다.
그래서 **싱글스레드 코어**(`@ffmpeg/core`, `core-mt` 아님)만 씁니다. 그만큼 느리지만 어디서든 돕니다.

---

## 성능 (참고)

일반 노트북 기준, 720×1280 세로 영상에서 (헤드리스 Chromium 측정값)

| 작업 | 걸린 시간 |
|---|---|
| 5초 구간 → README GIF (480px) | 약 3.6초 |
| 8초 구간 → 카톡 GIF (360px) | 약 3.2초 |
| 3초 구간 → SNS MP4 (720px) | 약 3.1초 |
| 1:1 크롭 + 2배속 + 핑퐁 GIF | 약 1.1초 |

---

## 파일 구조

```
clip-box/
  index.html
  css/
    style.css        # clip-box 전용
    ui.css           # sense-lab 공통 (그대로)
    theme-maker.css  # sense-lab 공통 (그대로)
    all.min.css      # Font Awesome
  js/
    app.js           # 상태, 파일 로드, 클립 목록, 굽기
    timeline.js      # 플레이어 + 구간 드래그 + 크롭 박스
    ffmpeg.js        # 코어 로드, 명령 조립, 진행률, 취소
    presets.js       # 출력 프리셋, 예상 용량, 목표 용량 맞추기
    i18n.js          # 한국어 / English
  vendor/            # ffmpeg.wasm, 코어, JSZip, 한글 글꼴
  assets/            # 글꼴, 이미지
```

빌드 도구가 없습니다. Vanilla JS + ES modules 그대로입니다.
정적 서버에 올리기만 하면 됩니다 (`file://` 로는 ES module 때문에 안 됩니다).

```bash
python3 -m http.server 8000
# http://localhost:8000
```

---

## 쓴 라이브러리 · 라이선스

| 것 | 버전 | 라이선스 |
|---|---|---|
| [`@ffmpeg/ffmpeg`](https://github.com/ffmpegwasm/ffmpeg.wasm) | 0.12.15 | MIT |
| [`@ffmpeg/core`](https://github.com/ffmpegwasm/ffmpeg.wasm) (싱글스레드) | 0.12.10 | **GPL-2.0-or-later** |
| [FFmpeg](https://ffmpeg.org/) | 5.1.4 (코어 안) | **GPL-2.0-or-later** |
| [JSZip](https://stuk.github.io/jszip/) | 3.x | MIT 또는 GPLv3 |
| [Pretendard](https://github.com/orioncactus/pretendard) | 1.3.9 | SIL OFL 1.1 |
| [Font Awesome Free](https://fontawesome.com/) | 6.x | CC BY 4.0 (아이콘) · SIL OFL 1.1 (글꼴) · MIT (코드) |

### ⚠️ ffmpeg 라이선스에 대해

`vendor/ffmpeg-core/` 에 들어 있는 ffmpeg 빌드는 **LGPL 이 아니라 GPL-2.0-or-later** 입니다.
`--enable-gpl --enable-libx264 --enable-libx265` 로 빌드되어 있기 때문입니다 (x264·x265 가 GPL).
`ffmpeg -version` 로도 확인할 수 있습니다.

GPL 코어를 함께 배포하므로 **이 저장소 전체를 GPL-2.0-or-later 로 둡니다.**
LGPL 로 가고 싶다면 x264/x265 없이 코어를 직접 빌드해야 하고,
그러면 **MP4(H.264) 출력이 빠집니다** (GIF·WebP 는 그대로 됩니다).

- FFmpeg 소스: https://github.com/FFmpeg/FFmpeg
- 이 코어의 빌드 스크립트: https://github.com/ffmpegwasm/ffmpeg.wasm

---

## 자매 도구

- [sense-lab](https://github.com/themakerrobot/sense-lab) — 웹캠으로 AI 를 직접 가르쳐 보는 도구.
  clip-box 는 sense-lab 의 `css/`·헤더·푸터·한영 토글을 그대로 씁니다.
