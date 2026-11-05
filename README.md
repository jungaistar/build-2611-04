# build-2611-04 · 계측 데이터 처리 · 3D 그래프

생성형 AI 업무자동화 전문가과정 **2차수** 수강생 프로젝트 04 — 기획 노현석.

**바로 쓰기: https://build-2611-04.jobability.co.kr/**

샘플링 주기·시작 시각·시간 형식이 다른 계측기 CSV·엑셀을 한 시간축으로 맞춥니다.
시작 시각으로 먼저 맞추고, 남은 어긋남은 기준 신호와의 교차상관으로 추정해 보정한 뒤 선형 보간으로 리샘플합니다.
전처리(배율·오프셋·영점·이동평균·저역통과·이상치·구간 자르기), 엑셀·CSV 내보내기, 독립변수 2개·종속변수 1개 3D 그래프(Canvas, 회전·확대·PNG)를 함께 제공합니다.
파일은 브라우저 안에서만 처리하며 서버로 올라가지 않습니다.

| 파일 | 역할 |
|---|---|
| `js/engine.js` | 계산 엔진(읽기·시간 해석·지연 추정·리샘플·전처리·3D 보간·투영) — 판정은 전부 여기 |
| `js/app.js` | 화면 |
| `test/logic.test.js` | 계산 규칙 테스트 `node test/logic.test.js` |
| `test/smoke.browser.js` | 화면 연기 테스트(playwright) |
| `CLAUDE.md` | 작업 지시서 + 기획서 원문 |

예제 데이터는 실제 사내 데이터가 아닙니다.

## v1.1 (2026-11-04) — 3D 작업실

`surface.html`: 엑셀에서 복사한 표(독립변수 2 · 종속변수 1, Safe 같은 라벨 허용)를 붙여 넣으면 측정점 삼각망 면 · 2차 회귀 곡면+측정점 · 회귀 곡면 위 예측점을 창 여러 개로 함께 보고, 창끼리 뷰 동기화하거나 따로 돌리며, 그래프 구석의 뷰 큐브 면(FRONT·REAR·LEFT·RIGHT·TOP·BOTTOM)을 눌러 정렬합니다. 회귀식(최소제곱, R²·RMSE)은 계수 직접 입력도 됩니다. 엔진 `js/engine.js`(delaunay · quadFit · cubeFaces …), 화면 `js/surface.js`.

## 기획서 · 버전

- 사이트 「기획서」 페이지: https://build-2611-04.jobability.co.kr/plan.html — 워드 판 내려받기
- 워드 판: `docs/기획서/build-2611-04_노현석_계측데이터처리3D그래프_기획서_v<버전>.docx` (버전마다 남김)
- 원본: `docs/plan.json` → 생성기 `build-2611-00/tools/plandoc/make_plan.py` 로 워드·그림·plan.html·CHANGELOG.md 를 다시 만든다
- 버전을 올릴 때: `plan.json` 의 `version` 을 바꾸고 `versions` 맨 앞에 바뀐 점을 적은 뒤 생성기를 다시 돌린다
