# TouchDeck — 경량 Windows 터치 런처 & Stream Deck 대안 구축 계획서

> 작성: 2026-11-17  
> 스택: **Tauri v2 (Rust 백엔드 + React / TypeScript / Vite 프론트엔드)**

---

## 1. 프로젝트 목표 및 배경

웹서버·SQLite DB·외부 에이전트를 별도로 띄워야 하는 원격 제어형 스트림덱 스택 대신, 단일 Windows PC/터치모니터 환경에 최적화된 가벼운 런처를 목표로 한다.

**TouchDeck**은 이를 **단일 네이티브 데스크톱 앱 1개**로 대체한다:
- 웹서버·SQLite DB·외부 에이전트·Watchdog 없음
- Windows 터치모니터 친화적인 다크 반투명/테마 그리드 UI (Pretendard 폰트 기본 적용)
- 바로가기(`.lnk`) / 실행파일(`.exe`) / 폴더 / URL을 **드래그 앤 드롭**하면 즉시 원본 경로 해석 + 256×256 Jumbo 아이콘 추출 + 버튼 등록
- 이미 실행 중인 앱/폴더는 **최소화 복원(`SW_RESTORE`) + 포그라운드 강제 활성화** (작업표시줄 깜빡임 해결)
- 시스템 볼륨·음소거·미디어 재생 제어·단축키 등 Stream Deck 기본 액션 내장
- 폴더 단위 포터블 구성 지원 (다른 PC로 폴더만 복사하면 동일 설정/테마로 즉시 실행)

---

## 2. 기술 스택 및 환경

| 영역 | 기술 | 비고 |
|---|---|---|
| 데스크톱 런타임 | **Tauri v2** | Windows 내장 WebView2 활용, 백엔드 Rust |
| 백엔드 / Win32 | **Rust** (`windows` crate, `image`, `serde`) | 창 제어, `.lnk` 파싱, 256px 아이콘 추출, Core Audio, SendInput |
| 프론트엔드 UI | **React 19 + TypeScript + Vite** | 프레임리스 반투명 창, CSS Grid, 드래그 재배치, 테마/버튼 편집 UI |
| 데이터 저장 | **JSON + 로컬 `assets/` 폴더** | `%APPDATA%\TouchDeck\` 또는 실행 파일 옆 `data/` (포터블 모드) |

### 현재 PC 툴체인 확인 결과
- Node.js `v24.22.3` / npm: 설치됨
- Git `2.56.0`: 설치됨
- Microsoft Edge WebView2 Runtime: 설치됨
- Visual Studio 2019 C++ Build Tools (`VC\Tools\MSVC`): 설치됨
- **Rust (`rustup` / `rustc` / `cargo`)**: 미설치 → Phase 1에서 `Rustlang.Rustup` 설치 필요

---

## 3. 데이터 모델 (`config.json`)

```jsonc
{
  "version": 1,
  "window": {
    "x": 1235,
    "y": 1516,
    "alwaysOnTop": false,
    "desktopLayer": false,
    "locked": false
  },
  "grid": {
    "columns": 5,
    "rows": 4,
    "cellSize": 136,
    "gap": 10,
    "borderRadius": 14
  },
  "theme": {
    "backgroundType": "solid",      // "solid" | "gradient" | "image"
    "backgroundColor": "#2A2A2A",
    "backgroundOpacity": 82,        // 0 ~ 100
    "gradientEndColor": "#16181D",
    "backgroundImage": null,        // assets/bg_xxx.png
    "backgroundBlur": 8,
    "backgroundDim": 35,
    "fontFamily": "Pretendard",
    "defaultButtonColor": "#333333",
    "defaultButtonOpacity": 90
  },
  "pages": [
    {
      "id": "page-1",
      "name": "메인",
      "slots": {
        "0": {
          "id": "btn-1",
          "label": "ORCA",
          "showLabel": true,
          "fontSize": 13,
          "textColor": "#FFFFFF",
          "bgColor": null,          // null이면 theme.defaultButtonColor 사용
          "bgOpacity": null,
          "iconPath": "assets/icon_orca.png",
          "action": {
            "type": "app",          // "app" | "folder" | "url" | "media" | "volume" | "hotkey" | "page"
            "exe": "C:\\Users\\...\\Orca.exe",
            "args": "",
            "workDir": "",
            "procName": "Orca",
            "classHint": "",
            "titleHint": ""
          }
        }
      }
    }
  ]
}
```

---

## 4. 아키텍처 & 주요 모듈 설계

### 4.1 Rust 백엔드 (`src-tauri/src/`)
1. **`config.rs`**: 포터블(`.\data\`) 우선 감지 및 `%APPDATA%\TouchDeck\` 폴백, 원자적 JSON 저장, 드롭된 커스텀 이미지 `assets/` 복사 관리
2. **`win_shell.rs`**:
   - `.lnk` 파싱 (`IShellLinkW`): `TargetPath`, `Arguments`, `WorkingDirectory`, `IconLocation`, 표시 이름 추출
   - 256×256 Jumbo 아이콘 추출 (`SHGetFileInfoW` + `SHGetImageList(SHIL_JUMBO=4)` + `IImageList::GetIcon` → HICON DIB/RGBA 변환 → `assets/` PNG 저장)
   - `.url` 인터넷 바로가기 / 폴더(`explorer.exe` 아이콘) 자동 처리
3. **`win_focus.rs`**:
   - 기존 `FocusLauncher.cs`의 검증된 창 제어 로직 포팅:
     - `EnumWindows`로 대상 프로세스 유효 최상위 창 탐색 (`IsWindowVisible`, `GW_OWNER == 0`, `WS_EX_TOOLWINDOW` 제외)
     - 최소화 시 `ShowWindow(SW_RESTORE)` + `AttachThreadInput` + `AllowSetForegroundWindow` + `SwitchToThisWindow` + `TOPMOST` 토글 폴백
     - `app-*` 버전 폴더 자동 폴백 (`Claude` 등 업데이트 대응)
     - `Shell.Application` (`IShellWindows`) 탐색기 기존 폴더 창 재사용
     - Chrome / URL 포그라운드 권한 전달 및 복원 감시
4. **`win_media.rs`**:
   - 미디어 제어: `SendInput` (`VK_MEDIA_PLAY_PAUSE`, `VK_MEDIA_NEXT_TRACK`, `VK_MEDIA_PREV_TRACK`, `VK_MEDIA_STOP`)
   - 시스템 볼륨/뮤트: Windows Core Audio (`IMMDeviceEnumerator` → `IAudioEndpointVolume`)로 볼륨 조절/뮤트 토글 및 현재 상태(`level`, `muted`) 조회
   - 단축키 매크로: 조합키 파싱 후 `SendInput`
5. **`win_window.rs`**:
   - 프레임리스 투명 창 위치/크기 저장
   - `alwaysOnTop` 토글 및 바탕화면 바로 위 고정(`Progman`/`WorkerW` 옵션)
   - Windows 시작 프로그램 등록/해제 (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\TouchDeck.lnk`)

### 4.2 프론트엔드 UI (`src/`)
1. **패널 메인 (`DeckGrid`)**:
   - 프레임리스 반투명 창, 상단/모서리 슬림 드래그 바 (잠금 시 숨김 가능)
   - `grid.columns × grid.rows`와 `grid.cellSize`에 맞춰 창 크기 자동 계산
   - **페이지 넘김**: 하단 페이지 도트 + 이전/다음 버튼 + 터치/마우스 스와이프 지원, 드래그 중 페이지 가장자리에 대면 자동 페이지 전환
   - **드래그 앤 드롭 등록**:
     - 탐색기/바탕화면에서 `.lnk`, `.exe`, 폴더, `.url` 파일을 빈 칸(또는 기존 칸)에 드롭 → 백엔드 즉시 분석 후 256px 아이콘 + 버튼 자동 생성
     - 기존 버튼에 `.png`/`.jpg`/`.ico`/`.svg` 이미지 파일을 드롭 → 해당 버튼 아이콘 즉시 교체
     - 패널 내 버튼끼리 드래그 앤 드롭 → 위치 교환/이동
2. **버튼 컨텍스트 메뉴 & 편집 모달 (`ButtonEditorModal`)**:
   - 라벨, 글자 표시 여부, 글자 크기/색상
   - 액션 타입 선택:
     - 앱 실행/창 복원 (실행 파일 또는 `.lnk` 찾아보기 → 자동 채움)
     - 폴더 열기 / 웹 URL 열기
     - 볼륨 조절 (`+`, `-`, `음소거`, 단계 설정) — 음소거/볼륨 상태를 버튼 배지에 표시
     - 미디어 제어 (`재생/일시정지`, `다음 곡`, `이전 곡`, `정지`)
     - 단축키 매크로 / 페이지 이동
   - 외관: 아이콘 이미지 선택/초기화, 버튼 배경색 및 투명도 개별 슬라이더
3. **테마 & 레이아웃 설정 패널 (`SettingsDrawer`)**:
   - 그리드 설정: 열(columns), 행(rows), 칸 크기(px), 간격, 모서리 둥글기 슬라이더
   - 테마 설정: 단색/그라데이션/배경 이미지 선택, 패널 투명도, 배경 블러/어둡기, 기본 버튼 색·투명도, 폰트
   - 페이지 관리: 페이지 추가/이름 변경/삭제/순서 변경
   - 창 동작: 항상 위(`alwaysOnTop`), 위치 잠금, 시작 프로그램 등록, 포터블 데이터 폴더 열기
   - **설정 가져오기**: `launchers.json` 파일 선택으로 기존 버튼 일괄 불러오기 지원

---

## 5. 단계별 실행 계획

- **Phase 1 — 개발 환경 & 프로젝트 스캐폴딩**
  - Git 초기화 및 `PLAN.md` 작성
  - `Rustlang.Rustup` 설치 및 Tauri v2 + Vite + React + TypeScript 프로젝트 생성
  - 프레임리스 반투명 창, `config.json` 로드/저장, 동적 그리드 & 멀티 페이지 전환 기본 UI 구현
- **Phase 2 — Windows 네이티브 코어 (`win_shell`, `win_focus`)**
  - `.lnk` 바로가기 해석 + 256×256 Jumbo 아이콘 PNG 추출
  - Tauri 파일 드래그 앤 드롭 연동 (`.lnk`/`.exe`/폴더 드롭 시 자동 등록)
  - 앱/폴더/URL 실행 및 최소화 복원·포그라운드 강제 전환 구현
- **Phase 3 — Stream Deck 액션 & 커스터마이징 UI**
  - 볼륨/음소거(Core Audio 실시간 상태 반영), 미디어 제어, 단축키 매크로 구현
  - 버튼 편집 모달 (이미지 교체, 투명도, 색상, 액션 설정) & 드래그 자리 이동
  - 전체 테마 설정 UI (배경 이미지/블러/투명도, 칸 크기·행/열 조절, 페이지 관리)
- **Phase 4 — 마이그레이션·포터블 패키징·검증**
  - `launchers.json` 기반 버튼 일괄 가져오기(Import) 지원
  - Windows 단일 배포/포터블 빌드(`TouchDeck.exe`) 검증 및 터치모니터 실사용 테스트

---

## 6. 할 일 (TODO)

- **다국어 지원 (한국어 · 영어 · 일본어)**
  - Windows 표시 언어를 읽어 일치하는 언어로 설정한다.
  - 지원하지 않는 언어이면 영어를 기본값으로 쓴다.
  - 설정에서 언어를 직접 고를 수 있다(자동 / 한국어 / English / 日本語).
  - 중국어(간체)는 수요가 확인되면 추가한다.
