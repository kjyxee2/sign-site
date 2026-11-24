# 수어 번역 플레이어

유튜브 링크를 넣으면 한국어 자막을 수어 단어(gloss)로 번역합니다. 그리고 VRM 아바타가 영상 재생 시간에 맞춰 수어 동작을 보여 줍니다.

- **왼쪽**: 유튜브 영상(공식 IFrame 임베드)과 한국어 자막
- **오른쪽**: 수어 아바타와 지금 표현 중인 수어 단어
- 재생·일시정지·탐색할 때 아바타와 자막이 영상 시간을 따라갑니다.
- 휴대폰에서는 영상이 위, 아바타가 아래로 쌓입니다.

> 자동 번역 결과입니다. 한국수어 의미·문법 전문가 검수를 거치지 않았습니다.

## 구조

```
sign-site/
├── frontend/            정적 사이트 (GitHub Pages에 올라가는 부분)
│   ├── index.html, style.css
│   ├── config.js        백엔드 주소 설정
│   └── js/
│       ├── app.js       화면 흐름, 유튜브 동기화, 자막 표시
│       ├── avatar.js    VRM 아바타 로드·렌더링 (three.js + three-vrm, CDN)
│       ├── retarget.js  3D 키포인트 → VRM 관절 회전 (기존 프로젝트 코드 복사)
│       └── timeline.js  유튜브 시간 → 아바타 자세 계산
├── backend/             FastAPI 백엔드 (GPU 서버에서 실행)
│   ├── app.py           API + 로컬 확인용 정적 파일 제공
│   ├── translator.py    KoBART text→gloss 모델 추론
│   ├── motion.py        gloss → AI Hub 수어 동작(3D 키포인트) 검색·로드
│   ├── subtitles.py     .srt/.vtt 파싱, 유튜브 자막 가져오기
│   ├── settings.py      경로·옵션 (환경변수로 변경 가능)
│   └── requirements.txt
├── tests/               단위 테스트, 헤드리스 브라우저 확인 스크립트
├── run_local.sh         서버 실행 스크립트 (포트 8000)
└── .github/workflows/pages.yml   GitHub Pages 자동 배포
```

### 동작 흐름

1. 자막 준비: 업로드한 `.srt`/`.vtt` 파일을 쓰거나, 유튜브 한국어 자막을 자동으로 가져옵니다(`youtube-transcript-api`). 자동 생성 자막은 잘게 끊긴 조각을 구 단위로 합칩니다.
2. 번역: 자막 한 줄마다 학습한 KoBART 모델이 gloss 배열을 만듭니다. 예: `"교통안전에 유의하세요."` → `["교통1","조심1"]`
3. 동작 연결: gloss 끝의 번호와 기호(`1`, `#`)를 떼어 라벨(`교통`)로 만듭니다. 그 라벨을 AI Hub 수어 데이터의 WORD 녹화(우선)나 SEN 문장 녹화 속 구간에서 찾습니다. 키포인트 프레임을 읽고 검증한 뒤 브라우저로 보냅니다.
4. 재생: 브라우저가 키포인트를 VRM 관절 회전으로 바꿉니다. 각 자막 줄의 시작 시각부터 동작을 차례로 재생하고, 동작 사이는 0.3초로 부드럽게 잇습니다. 다음 자막 전에 다 못 끝내면 최대 1.8배까지 빨라지고, 그래도 넘치면 다음 자막에서 끊깁니다.
5. 표시: 동작 데이터가 없는 단어는 오른쪽 자막에 회색 점선으로 표시합니다. 이때 아바타는 직전 자세를 유지합니다.

### 사용하는 서버 파일 (저장소에 넣지 않음)

| 항목 | 기본 경로 (`backend/settings.py`) | 환경변수 |
|---|---|---|
| 학습한 KoBART 모델 | `sign/avatar_mvp/integrated/text2gloss_train_20261123/checkpoints/best` (epoch 5, DEV gloss WER 0.454) | `SIGN_MODEL_DIR` |
| 모델 보조 코드 (`model_utils.py`) | `.../text2gloss_train_20261123` | `SIGN_MODEL_CODE_DIR` |
| 동작 카탈로그 | `data_audit_20261112/sequence_catalog.csv` | `SIGN_SEQUENCE_CATALOG` |
| 카탈로그 코드 (`catalog.py`) | `sign/avatar_mvp/integrated` | `SIGN_CATALOG_CODE_DIR` |
| 3D 키포인트 원본 | `sign/004.수어영상`, `sign_more/004.수어영상` | (`SIGN_WORKSPACE` 기준) |
| VRM 아바타 | `sign/assets/avatar/test.vrm` (16.6MB) | `SIGN_AVATAR_VRM` |

이 파일들은 읽기만 합니다. 수정하거나 옮기지 않습니다. 모델(약 500MB)과 아바타는 백엔드가 서버에서 직접 읽습니다. 그래서 GitHub 저장소에는 코드만 올라갑니다. `.gitignore`가 `*.safetensors`, `*.vrm`, `*.zip` 같은 큰 파일을 제외합니다.

## 로컬 실행 (GPU 서버)

```bash
cd /data1/workspaces/cy0410/sign-site
./run_local.sh            # 포그라운드 실행
./run_local.sh --daemon   # 백그라운드 실행 (로그: logs/server.log, PID: logs/server.pid)
kill "$(cat logs/server.pid)"   # 백그라운드 서버 종료
```

- 서버는 `127.0.0.1:8000`에 뜹니다. 같은 주소에서 API(`/api/...`)와 사이트(`/`)를 함께 제공합니다.
- Python은 모델 학습에 쓴 기존 venv를 그대로 씁니다(torch 2.5.1, transformers 4.46.3). 다른 Python을 쓰려면 `SIGN_PYTHON=/path/to/python`을 지정합니다.
- FastAPI 같은 웹 패키지는 공용 venv를 건드리지 않도록 `./.deps`에 설치됩니다(첫 실행 때 자동 설치).
- GPU는 `cuda:0`을 자동으로 씁니다. 다른 장치를 쓰려면 `SIGN_DEVICE=cuda:3` 또는 `SIGN_DEVICE=cpu`를 지정합니다. 모델은 시작할 때 백그라운드에서 불러오며 10초 정도 걸립니다.
- 상태 확인: `curl http://127.0.0.1:8000/api/health`

### 노트북 브라우저에서 보기

노트북 터미널(WSL/맥)에서 SSH 포트 포워딩을 켜 둡니다.

```bash
ssh -N -L 8000:127.0.0.1:8000 <사용자>@<GPU서버 주소>
```

그다음 브라우저에서 **http://localhost:8000** 을 엽니다.

### 테스트

```bash
PY=/data1/workspaces/cy0410/sign/avatar_mvp/integrated/context_selector_20261119/.venv/bin/python
PYTHONPATH=.deps:. $PY -m unittest discover -s tests -v        # 자막 파싱 등 단위 테스트

# 헤드리스 브라우저 확인 (서버 실행 중일 때): 유튜브 재생·탐색 동기화, 모바일 배치
T=/data1/workspaces/cy0410/sign/avatar_mvp/.tools
PLAYWRIGHT_BROWSERS_PATH=$T/browsers PLAYWRIGHT_PACKAGE=$T/playwright/driver/package \
  $T/playwright/driver/node tests/browser_check.cjs http://127.0.0.1:8000/ DFzHl3hhexs
```

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/health` | 모델·동작 색인 로드 상태 |
| GET | `/api/youtube/captions?url=<링크>` | 유튜브 한국어 자막 → `{segments:[{start,end,text}]}` (사람이 만든 자막 우선) |
| POST | `/api/subtitles/parse` (multipart `file`) | `.srt`/`.vtt` → `{segments}` (UTF-8/CP949, 5MB 이하) |
| POST | `/api/translate` `{segments}` | 줄마다 `glosses:[{gloss,label,motion}]`와 동작 연결 비율 |
| GET | `/api/clip?label=<라벨>` | 해당 단어의 3D 키포인트 프레임 `{duration, frames:[{t,pose,hand_l,hand_r}]}` |
| GET | `/api/avatar.vrm` | VRM 아바타 |

## GitHub Pages 배포

GitHub Pages는 정적 파일만 제공하므로 화면(`frontend/`)만 Pages에 올립니다. 모델을 돌리는 백엔드는 GPU 서버에서 따로 실행합니다.

### 1. 저장소에 올리기

```bash
cd /data1/workspaces/cy0410/sign-site
git init -b main
git add .
git status            # .deps/, logs/, 모델·VRM 파일이 목록에 없는지 확인
git commit -m "Sign translation site"
git remote add origin https://github.com/<계정>/<저장소>.git
git push -u origin main
```

### 2. Pages 켜기

1. GitHub 저장소에서 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 바꿉니다.
2. `main`에 push하면 `.github/workflows/pages.yml`이 `frontend/` 폴더를 배포합니다.
3. 배포 주소는 `https://<계정>.github.io/<저장소>/`입니다.

### 3. 백엔드를 인터넷에 HTTPS로 공개하기

Pages는 `https://`로 열리기 때문에 백엔드도 **HTTPS** 주소여야 합니다(브라우저가 http 요청을 막습니다). 학교 서버 포트를 직접 열 수 없으면 터널을 씁니다. 예:

```bash
# Cloudflare Tunnel (계정 없이 임시 주소)
cloudflared tunnel --url http://127.0.0.1:8000
# → https://xxxx.trycloudflare.com 같은 주소가 출력됨
```

### 4. 프론트엔드에 백엔드 주소 알려주기

다음 중 하나를 고르면 됩니다.

- **저장소 변수(권장)**: **Settings → Secrets and variables → Actions → Variables**에 `SIGN_API_BASE = https://xxxx.trycloudflare.com`을 추가하고 다시 배포합니다. 워크플로가 `config.js`를 자동으로 씁니다.
- **파일 수정**: `frontend/config.js`의 `''`를 백엔드 주소로 바꿔 커밋합니다.
- **임시 확인**: `https://<계정>.github.io/<저장소>/?api=https://xxxx.trycloudflare.com`

### 5. CORS

백엔드는 기본으로 `https://*.github.io`와 `http://localhost`에서 오는 요청을 허용합니다. 다른 도메인을 쓰면 서버 실행 전에 지정합니다.

```bash
SIGN_ALLOWED_ORIGINS=https://sign.example.com ./run_local.sh --daemon
```

비밀값(API 키 등)은 쓰지 않습니다. 나중에 필요해지면 코드에 넣지 말고 환경변수나 GitHub Secrets를 씁니다.

## 한계

- **모델 분야**: 번역 모델은 AI Hub 수어 스크립트(날씨·재난·뉴스 위주)로 학습했습니다. 일상 대화나 광고 문장에서는 엉뚱한 gloss가 나올 수 있습니다.
- **동작 연결률**: 모델 gloss 중 실제 수어 동작이 있는 단어는 검증 데이터 기준 약 36%이고, 시험한 교통안전 영상에서는 61%였습니다. 동작이 없는 단어는 회색으로 표시하고 아바타는 표현하지 않습니다(지문자 대체 없음).
- **동작 정확도**: 같은 라벨의 녹화 중 검증을 통과한 첫 번째 것을 씁니다. 동음이의어(예: 여러 뜻의 `가다`)는 구분하지 않습니다.
- **타이밍**: 자막 시작 시각에 맞춰 재생합니다. 실제 발화와 정밀하게 맞추지는 않습니다.
- **임베드 제한**: 다른 사이트 임베드를 막은 유튜브 영상은 재생할 수 없습니다.
- **자동 자막 가져오기**: 유튜브 쪽 차단이나 요청 제한으로 실패할 수 있습니다. 그때는 자막 파일을 올리면 됩니다.
