# Project Deep Blue

크롬에서 바로 실행되는 **풀 3D 선상 낚시 · 보트 운전 · 해저 작살** 게임입니다. 설치·빌드·서버 없이 브라우저만 있으면 됩니다.

### ▶ [지금 플레이하기](https://leepillwoo.github.io/Project-DeepBlue/)

데스크톱 Chrome, 키보드와 마우스 기준입니다. 처음 접속 때 약 40 MB를 받고, 로딩은 10~15초쯤 걸립니다.

| 선상 낚시 | 보트 운전 |
|---|---|
| ![선상 낚시와 크루](docs/images/fishing.jpg) | ![파도를 가르는 보트](docs/images/helm.jpg) |
| **해적섬과 범선** | **해저 작살·관찰** |
| ![해적섬과 범선](docs/images/island.jpg) | ![바다거북과 리프](docs/images/dive.jpg) |

## 주요 기능

- **낚시**: 캐스팅 파워, 텐션·드랙 파이팅, 줄이 끊긴 대어를 다이빙해서 추적
- **운전**: 선체 5개 지점의 부력을 파도에서 직접 계산 — 맞파도에서는 뜨고 떨어지며 물보라
- **작살**: 2차 항력 탄도, 조준 보정, 물고기·상어·해파리 AI, 문어와 바다거북, 채집물과 보물상자
- **바다**: 해적섬·등대·범선, 어부가 탄 어선, 트롤선, 갈매기, 미니맵
- **도감**: 17종, 종별 기록과 찾는 법 힌트 (브라우저에 저장)
- **사운드**: 효과음 37종 전부 WebAudio 합성(샘플 파일 없음)

## 로컬에서 실행

저장소를 받아 `index.html`을 Chrome으로 더블클릭하면 됩니다. 오프라인에서도 동작합니다.

GitHub Pages(위 링크)는 `main` 브랜치를 그대로 띄우므로, 푸시하면 1~2분 안에 반영됩니다.

기획서 원본은 `docs/gemini-code-1794302900744.html`에 있습니다.

## 조작

| 모드 | 키 |
|---|---|
| 공통 | 마우스 = 시점, `Tab` = 도감(열려 있는 동안 게임 정지, `↑↓` 스크롤), `Esc` = 일시정지 |
| 선상 낚시 | `좌클릭` 길게 눌렀다 놓기 = 캐스팅 / 누르는 동안 = 릴링, `우클릭` = 줌, `E` = 운전, `F` = 다이빙(REEF 부표 근처에서만), `T` = 시간대 |
| 운전 | `W`/`S` 스로틀 전진·후진, `A`/`D` 조타, 마우스 = 추적 카메라 회전, `E` = 엔진을 끄고 닻을 내린 뒤 낚시 위치로 |
| 해저 작살 | `WASD` 유영, `Space`/`C` 상승·하강, `Shift` 질주, `좌클릭` 발사, `우클릭` 조준, `E` 채집·줍기, `L` 라이트, `F` 보트로 복귀(어디서든) |

- **입질**: 물고기가 먼저 루어를 톡톡 건드립니다(그때 챔질하면 놀라 달아남). 확 끌고 가는 순간 **새로** 좌클릭해야 걸리고, 버튼을 계속 누르고 있으면 걸리지 않습니다. 기다리는 동안 좌클릭을 짧게 끊어 치면 입질이 빨라집니다.
- **파이팅**: 물고기가 질주하면 릴을 놓고(드랙), 버티기·점프·지침 상태에서는 감습니다. 줄이 끊어지면 14초 안에 `F`로 뛰어들어 지친 대어를 작살로 마무리할 수 있습니다.
- **작살**: 천천히 다가가면 물고기가 달아나지 않습니다. 조준원이 **연두색**으로 바뀌면(이름·거리 표시) 그 물고기의 이동 방향까지 계산해 맞춰 줍니다. 바위나 지형에 가려 있으면 조준이 잡히지 않습니다.
- **운전**: 선체 5개 지점의 부력을 파도 높이에서 직접 계산합니다. 속도가 붙으면 활주하면서 선체가 뜨고, 맞파도(섬 방향)에서는 파도를 넘다 떨어지며 물보라가 터집니다. 뒷파도에서는 파도를 타고 가속됩니다.
- **미니맵**(우상단): 보트·REEF(다이빙 포인트)·해적섬·해적선·다른 배. 다이빙 중에는 내 위치 기준으로 돌아가고, 보트가 범위 밖이면 가장자리에 방향이 표시됩니다. 화면에도 `▲ 보트 N m` 표식이 따라다닙니다.

## 바다에 있는 것들

- **해적섬**(시작 지점에서 남서쪽 약 260 m): Megascans 해안 절벽 + 모래톱·야자수·해적기·보물상자, 등대, 정박한 범선(Poly Haven 난파선 모델에 돛을 올린 것)
- **다른 배**: 낚시 중인 어선 2척(어부 캐릭터 탑승), 큰 원을 그리며 지나가는 트롤선. 부딪히면 밀려납니다.
- **크루**: 갑판에서 대기하다가 낚시에 성공하면 춤을 추고, 운전 모드에서는 타륜을 잡습니다(손 위치는 IK).
- **수중**: 문어(먹물을 뿜고 두 번 달아난 뒤 지침 → 작살 또는 `E`), 바다거북(보호종 — 다가가면 관찰 기록), 성게·거미고둥·불가사리(`E` 채집), 난파선 옆 보물상자
- **도감**: 17종. 낚시·작살·채집·관찰로 등록되며 종별 기록과 찾는 법 힌트가 나옵니다. 저장은 브라우저 `localStorage`.

## 구조

```
index.html              진입점 + HUD(DOM/CSS)
lib/three.min.js        three.js r160 (MIT)
assets/                 에셋 팩(생성물) — manifest.js 가 불러올 팩 목록
src/engine/             core(수학·지오메트리·입력) · assets(팩 로더·스키닝 캐릭터) · post(HDR·블룸·톤매핑) · fx(파티클) · audio(합성 사운드)
src/world/              env(하늘·구름) · ocean(파도) · world(해저 지형 함수) · reef(수중 머티리얼·산호초·난파선) · sea(섬·등대·다른 배·갈매기)
src/game/               boat(보트·부력·운전) · fish(어종 표·물고기) · fishing · dive(작살·AI·채집·문어·거북) · crew · dex(도감) · ui(HUD·미니맵) · main(상태 머신·카메라)
tools/                  개발용 — 게임 실행에는 필요 없음
  assets.config.mjs       어떤 모델이 어느 팩에 들어가는지
  build_assets.mjs        팩 생성 + CREDITS.md 생성
  blender_prep.py         무거운 GLB 데시메이트 (Blender CLI)
  fab/                    Fab 무료 에셋 검색·다운로드 (로그인된 크롬 사용)
  dev/                    헤드리스 검증 하네스, GLB 뷰어, 팩 뷰어
  build_demo.mjs          claude.ai Artifact 용 데모 페이지(demo/) 생성 — GitHub Pages 에는 필요 없음
raw/fab, raw/prep       원본·중간 GLB (게임 실행에는 필요 없음, 약 1.2 GB — 지워도 됩니다)
docs/                   기획서 원본
```

스크립트는 ES 모듈이 아니라 전역 `DB` 네임스페이스를 공유하는 일반 `<script>` 입니다. `file://` 에서는 모듈·`fetch` 가 막히기 때문입니다. 같은 이유로 모델·텍스처도 JS 파일(`assets/*.js`)에 base64 로 들어 있습니다.

## 에셋 추가하기

1. **찾기** — `cd tools/fab && node fabfind.mjs boats "fishing boat" "trawler"` → `out/fab_boats.jpg` 번호표와 라이선스·uid 목록
2. **받기** — `node fabget.mjs ../../raw/fab <uid> <uid> …` → `raw/fab/*.glb`, 출처는 `raw/fab/credits.json` 에 기록
3. **줄이기**(수십만 폴리곤일 때) — `blender -b --python tools/blender_prep.py -- raw/fab/x.glb raw/prep/x.glb 30000`
4. **등록** — `tools/assets.config.mjs` 에 한 줄 추가 (`glb:` 또는 `prep:`, 텍스처 크기, 넣을 팩)
5. **빌드** — `cd tools && npm i && node build_assets.mjs sea` (인자 없으면 전체) → `assets/sea.js`, `assets/manifest.js`, `CREDITS.md`
6. 코드에서는 `DB.Assets.object('이름')`(정적 모델) 또는 `DB.Assets.character('이름')`(스키닝 + 애니메이션)

Fab 스크립트는 `chrome.exe --remote-debugging-port=9333 --user-data-dir=%LOCALAPPDATA%\DeepBlue-FabProfile` 로 띄워 직접 로그인해 둔 크롬에 붙습니다. "Download" 버튼만 누르며, 라이선스를 골라 "Buy now"(0원 포함)를 거쳐야 하는 에셋은 건드리지 않고 목록만 알려 줍니다.

캐릭터 애니메이션은 같은 Mixamo 리그끼리 리타게팅됩니다(`assets.config.mjs` 의 `clips: [{ from: '다른.glb', anim: 'idle' }]`).

## 검증

- `index.html?selftest` — 낚시 파이팅 규칙 3종, 작살 사거리, 운전(최고 속도·조타·섬 충돌·정박), 조준 보정 명중, 전체 효과음 렌더링을 자동 점검하고 콘솔에 PASS/FAIL 을 찍습니다.
- `tools/dev/shot.mjs` — 실제 GPU 로 헤드리스 크롬을 돌려 스크린샷을 찍습니다. `DB.debug.*`(`drive`, `tp`, `dive`, `key`, `view` …)로 상태를 만들 수 있습니다.

## URL 옵션

- `?q=low|medium|high|ultra` 품질 (기본 high, 프레임이 떨어지면 해상도를 자동으로 낮춤)
- `?tod=day|golden|morning` 시작 시간대
- `?autostart` 타이틀 건너뛰기, `?selftest` 자가 검증

## 에셋 출처

전체 목록은 [CREDITS.md](CREDITS.md) (빌드 스크립트가 생성).

- **Fab — Quixel Megascans** (Fab Standard License): 산호·바위·해안 절벽·나무 보트·술통
- **Fab — CC-BY 4.0** (출처 표기 필수): 크루 캐릭터 *Rumba Dancing* — Dom Baker / 대기·걷기 애니메이션 *Thailand Girl* — Tony Flanagan / 어선·어부 — Charlie catling / 트롤선 — Romain Ferre / 등대 — DylanHayes / 야자수 — UPWARD / 보물상자 — GG Beta Pie / 바다거북 — Forge of Fantasy / 참치 — GoldenZtuff / 상어 — Optic Idealist
- **Poly Haven** (CC0): 이끼 바위, 범선, 소품, 해저 텍스처
- 보트·낚싯대·작살총·문어·성게와 나머지 물고기, 모든 효과음은 코드로 생성합니다.
