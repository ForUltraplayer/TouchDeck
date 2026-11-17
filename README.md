# TouchDeck

Windows 터치모니터 및 데스크톱 환경을 위한 **초경량 Stream Deck 대안 런처**입니다.  
웹서버, SQLite DB, 별도 에이전트 없이 **단일 네이티브 앱(Tauri v2 + Rust)** 으로 동작하며, 시스템 트레이에서 조용히 관리됩니다.

---

## 주요 기능

- **드래그 앤 드롭 원클릭 등록**
  - 바탕화면 바로가기(`.lnk`), 실행 파일(`.exe`, `.cmd`, `.bat`, `.vbs`), 폴더, `.url` 파일을 빈 칸에 끌어다 놓으면 원본 경로·인자·작업 디렉토리를 자동 해석합니다.
  - Windows `IShellLinkW` + `SHIL_JUMBO` API로 **256×256 고해상도 아이콘**을 추출해 PNG로 저장합니다.
  - 기존 버튼 위에 이미지 파일(`.png`, `.jpg`, `.webp`, `.ico`)을 드롭하면 아이콘이 즉시 교체됩니다.
- **실행 중인 창 복원 & 포그라운드 강제 활성화**
  - 이미 실행 중인 앱을 눌렀을 때 작업표시줄 아이콘만 깜빡이는 Windows 포그라운드 잠금 문제를 해결했습니다.
  - 최소화(`SW_RESTORE`) 해제 후 `AttachThreadInput` · `SwitchToThisWindow` 조합으로 창을 맨 앞으로 올립니다.
  - 탐색기 폴더는 `IShellWindows`로 이미 열린 동일 경로 창을 찾아 중복 실행 없이 활성화합니다.
  - 버전 폴더(`app-*`) 구조의 앱 업데이트 시 최신 버전 폴더를 자동 탐색합니다.
- **Stream Deck 기본 제어 액션**
  - **시스템 볼륨**: 볼륨 올리기/내리기, 음소거 토글 (Windows Core Audio `IAudioEndpointVolume`, 버튼 위 실시간 `%` / `MUTE` 배지 표시)
  - **미디어 제어**: 재생/일시정지, 다음 곡, 이전 곡, 정지
  - **단축키 매크로**: 사용자 지정 조합키(`Ctrl + Shift + M` 등) 전송
  - **페이지 이동**: 멀티 페이지 구성, 하단 탭/화살표 및 터치 스와이프 전환
- **디자인 & 레이아웃 커스터마이징**
  - 가로/세로 칸 수(`2×1` ~ `10×8`), 칸 크기(`76px` ~ `180px`), 간격, 모서리 둥글기 실시간 조절
  - 패널 전체 배경: **단색 + 투명도 / 그라데이션 / 커스텀 배경 이미지(블러·어둡기 조절)**
  - 버튼별 개별 배경색·투명도·글자 크기/색상·아이콘 지정
  - **편집 모드**: 마우스 및 터치 드래그로 버튼 자리 이동·교환
- **트레이 관리 & 포터블 이식성**
  - 작업표시줄에 표시되지 않고(`skipTaskbar`) 시스템 트레이 아이콘(보이기/숨기기/설정/종료)으로 관리합니다.
  - 실행 파일 옆에 `data/` 폴더(또는 `portable.flag`)를 두면 포터블 모드로 동작해 폴더째 다른 PC로 복사하면 동일 설정·아이콘이 그대로 유지됩니다.
  - Windows 시작 프로그램 자동 실행 등록/해제 지원.

---

## 기술 스택

| 영역 | 기술 |
|---|---|
| 데스크톱 런타임 | [Tauri v2](https://v2.tauri.app/) (Windows WebView2) |
| 백엔드 / Win32 | Rust (`windows` crate, `image`, `serde`) |
| 프론트엔드 | React 19, TypeScript, Vite, `lucide-react` |

---

## 빌드 및 실행 방법 (Windows)

### 사전 요구사항
- Node.js 18+
- Rust (`rustup`)
- Visual Studio Build Tools (C++를 사용한 데스크톱 개발)
- Microsoft Edge WebView2 Runtime (Windows 10/11 기본 내장)

### 개발 실행
```bash
npm install
npm run tauri dev
```

### 단일 실행 파일 빌드 (포터블)
```bash
npm run tauri build -- --no-bundle
```
빌드 완료 후 `src-tauri/target/release/touchdeck.exe`를 원하는 폴더에 두고 실행할 수 있습니다.  
같은 폴더에 `data/` 디렉토리를 만들거나 설정에서 **"포터블 모드 전환"**을 누르면 설정(`config.json`)과 아이콘(`assets/`)이 로컬에 저장됩니다.

---

## 폴더 구조

```text
TouchDeck/
├── src/                        # React + TypeScript UI
│   ├── App.tsx                 # 패널, 드래그 앤 드롭, 페이지 전환, 창 크기 동기화
│   └── components/
│       ├── ButtonTile.tsx      # 타일 렌더링 및 터치/포인터 드래그
│       ├── ButtonEditorModal.tsx
│       └── SettingsDrawer.tsx
└── src-tauri/src/              # Rust Win32 네이티브 백엔드
    ├── config.rs               # 설정 저장/로드 및 포터블 경로 관리
    ├── win_shell.rs            # .lnk/.url 해석 및 256px Jumbo 아이콘 추출
    ├── win_focus.rs            # 창 복원 및 포그라운드 활성화, 탐색기 중복 방지
    ├── win_media.rs            # Core Audio 볼륨 제어, 미디어 키, 단축키
    ├── win_window.rs           # 시작 프로그램 바로가기 관리
    └── lib.rs                  # Tauri 커맨드 및 시스템 트레이
```
