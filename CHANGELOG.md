# CHANGELOG — build-2611-04 계측 데이터 처리 · 3D 그래프

버전마다 기획서 워드 판을 `docs/기획서/` 에 남긴다(옛 판을 지우지 않는다).

## v1.1 — 2026-11-04

- 기획자 메일(2026-11-04, 한신대 메일 「건설기계 AI 역량 강화 프로젝트 관련」, Plotly html 2개 + Mass×Height→Velocity Limit 표 + 2차 회귀 계수 f~a)과 패들릿 글(뷰 큐브 면 정렬 · 창 여러 개) 대응
- 3D 작업실(surface.html · js/surface.js): 붙여넣기 · 삼각망 면 · 2차 회귀 곡면+측정점 · 예측점 · 창 여러 개 · 뷰 동기화/개별 · 뷰 큐브 · 회귀식/계수 입력 · PNG · 엑셀
- 엔진: parsePaste · tableColumnsWithLabels · applyLabelMap · delaunay · quadFit/quadEval/quadStats/quadFormula/regGrid · cubeFaces/cubeHit · sampleLimit
- 테스트 판정 71→119 · 화면 23→47

기획서: `docs/기획서/build-2611-04_노현석_계측데이터처리3D그래프_기획서_v1.1.docx`

## v1.0 — 2026-11-02

- 첫 판 — 시간 동기화(시작 시각·교차상관·리샘플)·전처리·엑셀 내보내기·3D 그래프
- 기획서 워드 판·파이프라인·아키텍처·와이어프레임 추가

기획서: `docs/기획서/build-2611-04_노현석_계측데이터처리3D그래프_기획서_v1.0.docx`
