/* 계산 규칙 고정 — node test/logic.test.js
 * 그래프가 그려져도 시간이 0.4초 어긋나 있으면 응력과 가속도를 잘못 짝짓는다.
 * 시간 해석 · 시작 시각 맞춤 · 지연 추정 · 리샘플 · 전처리 · 3D 보간·투영을 손으로 센 값과 대조한다. */
'use strict';
var M = require('../js/engine.js');
var passed = 0, failed = 0;
function ok(c, label, detail) { if (c) passed++; else { failed++; console.log('  X ' + label + (detail ? '\n      ' + detail : '')); } }
function eq(g, w, label) { ok(JSON.stringify(g) === JSON.stringify(w), label, '기대: ' + JSON.stringify(w) + '  실제: ' + JSON.stringify(g)); }
function near(g, w, tol, label) { ok(Math.abs(g - w) <= tol, label, '기대: ' + w + ' ± ' + tol + '  실제: ' + g); }

// ---------- 숫자 · CSV ----------
eq(M.toNum(' 12.5 '), 12.5, '공백 있는 숫자');
ok(isNaN(M.toNum('12.5MPa')), '단위가 붙은 글자는 숫자가 아니다');
eq(M.detectDelimiter('Start Time: 10:20:00\nt;a;b\n0;1;2\n0.1;1;2'), ';', '머리말 쌍점에 속지 않고 세미콜론을 고른다');
eq(M.parseCSV('a,"b,c",d\n1,"x ""y""",3'), [['a', 'b,c', 'd'], ['1', 'x "y"', '3']], '따옴표 안 쉼표·따옴표');
eq(M.splitUnit('응력(MPa)'), { name: '응력', unit: 'MPa' }, '괄호 단위');
eq(M.splitUnit('Acc_Z [g]'), { name: 'Acc_Z', unit: 'g' }, '대괄호 단위');

// ---------- 시간 ----------
eq(M.fmtDateTime(M.parseDateTime('2026-10-15 10:20:01.920')), '2026-10-15 10:20:01.920', '날짜+시각(ms)');
eq(M.fmtDateTime(M.parseDateTime('2026/10/15 10:20:01')), '2026-10-15 10:20:01.000', '슬래시 날짜');
eq(M.fmtDateTime(M.parseDateTime(46310.5)), '2026-10-15 12:00:00.000', '엑셀 일련번호(정오)');
eq(M.parseDateTime('2026-02-30 10:00:00'), null, '없는 날짜는 거른다');
eq(M.parseTOD('14:03:05.250'), 50585.25, '시각만');
eq(M.parseTOD(0.5), 43200, '엑셀 시각 칸(0.5 = 12시)');

// ---------- 표 읽기 ----------
var A = M.readTable(M.parseCSV('# 장비,SG\nTimestamp,s1(MPa)\n2026-10-15 10:00:00.000,1\n2026-10-15 10:00:00.100,2\n2026-10-15 10:00:00.200,3'));
eq([A.timeKind, A.startSource, A.t, A.dt], ['abs', 'column', [0, 0.1, 0.2], 0.1], '줄마다 날짜+시각 → 경과 초');
eq(A.channels.map(function (c) { return c.name + '|' + c.unit; }), ['s1|MPa'], '채널 이름과 단위');
var B = M.readTable(M.parseCSV('Device: X\nStart Time: 2026/10/15 10:00:02.500\n\nt [ms];a [g]\n0;1\n5;2\n10;3'));
eq([B.timeKind, B.startSource, M.fmtDateTime(B.start), B.t], ['rel', 'meta', '2026-10-15 10:00:02.500', [0, 0.005, 0.01]], '경과 ms + 머리말 시작 시각');
var C = M.readTable(M.parseCSV('Sample Rate: 4 Hz\nch1,ch2\n1,5\n2,6\n3,7'));
eq([C.timeCol, C.t, C.channels.length], [-1, [0, 0.25, 0.5], 2], '시간 열 없음 → 샘플링 주기로 만든다');
var D = M.readTable(M.parseCSV('시각,v\n23:59:59.500,1\n23:59:59.900,2\n00:00:00.300,3'));
eq(D.t, [0, 0.4, 0.8], '자정을 넘는 시각');
eq(D.startSource, 'tod', '날짜 없는 시각은 시각만으로 표시');
var E = M.readTable(M.parseCSV('time,v\n0,1\n0.2,x\n0.1,2\n0.3,4'));
ok(E.issues.some(function (s) { return s.indexOf('정렬') >= 0; }), '시간이 거꾸로 가면 정렬하고 알린다');
eq(E.t, [0, 0.1, 0.2, 0.3], '정렬 결과');
ok(E.issues.some(function (s) { return s.indexOf('숫자가 아닌 칸 1개') >= 0; }), '숫자 아닌 칸을 알린다');
var F = M.readTable(M.parseCSV('time,v\n0,1\n1,2'), { start: '2026-10-15 09:00:00' });
eq(F.startSource, 'user', '직접 넣은 시작 시각이 우선');

// ---------- 보간 · 전처리 ----------
eq(M.resample([0, 1, 2], [0, 10, 20], [0, 0.25, 1.5, 2, 2.5]).map(function (v) { return isNaN(v) ? null : v; }), [0, 2.5, 15, 20, null], '선형 보간, 범위 밖은 빈 값');
eq(M.fillGaps([NaN, 1, NaN, 3, NaN]), [1, 1, 2, 3, 3], '빈 값 메우기');
eq(M.movingAverage([0, 3, 6, 9], 3), [1.5, 3, 6, 7.5], '이동평균(가장자리는 있는 점만)');
var fs = 100, tt = M.makeGrid(0, 4, 0.01);
var lpDC = M.lowpass(tt.map(function () { return 5; }), fs, 2);
near(lpDC[200], 5, 1e-9, '저역통과: 직류는 그대로');
var hi = M.lowpass(tt.map(function (t) { return Math.sin(2 * Math.PI * 30 * t); }), fs, 2);
ok(M.stats(hi.slice(50, 350)).p2p < 0.3, '저역통과: 30 Hz 는 2 Hz 차단에서 크게 준다', M.stats(hi.slice(50, 350)).p2p);
var sq = tt.map(function (t) { return t >= 2 ? 1 : 0; }), lsq = M.lowpass(sq, fs, 2);
near(lsq[200], 0.5, 0.05, '앞뒤 두 번 걸어 계단의 가운데가 제자리(시간 지연 없음)');
var spike = tt.map(function (t) { return Math.sin(2 * Math.PI * 3 * t); }); spike[123] = 9;
eq(M.outliers(spike, 8), [123], '튄 점 하나만 이상치');
eq(M.outliers(tt.map(function (t) { return 50 * Math.sin(2 * Math.PI * 3 * t); }), 8), [], '크고 매끈한 신호는 이상치가 아니다');
var t21 = M.makeGrid(0, 2, 0.1), y21 = t21.map(function () { return 10; }); y21[10] = 99;
var pr = M.preprocess(t21, y21, { scale: 2, offset: 1, outK: 3, outMode: 'replace' });
eq([M.stats(pr.y).max, M.stats(pr.y).min, pr.outliers.map(function (o) { return o.i; }), pr.outliers[0].v], [21, 21, [10], 99], '이상치 보간 대체 → 배율·오프셋 순서(이상치 목록엔 원값)');
var z = M.preprocess([0, 0.5, 1, 1.5, 2], [3, 3, 3, 5, 7], { zeroSec: 1, outK: 0 });
eq(z.y, [0, 0, 0, 2, 4], '영점: 앞 1초 평균을 뺀다');

// ---------- 지연 추정 ----------
var g = M.makeGrid(0, 20, 0.01), ev = [3, 7.5, 12, 16];
function pulse(t, L) { var v = 0; ev.forEach(function (e) { var d = t - e - L; if (d >= 0) v += Math.exp(-d * 3) * Math.sin(2 * Math.PI * 4 * d); }); return v; }
var xa = g.map(function (t) { return pulse(t, 0); }), xb = g.map(function (t) { return pulse(t, 0.37); });
var lr = M.xcorr(xa, xb, 0.01, 1);
near(lr.lag, 0.37, 0.006, '교차상관: 같은 신호 0.37초 늦음');
ok(lr.r > 0.95, '같은 신호면 상관이 높다', lr.r);
near(M.xcorr(xb, xa, 0.01, 1).lag, -0.37, 0.006, '순서를 바꾸면 부호가 바뀐다');
var ea = g.map(function (t) { return Math.exp(-Math.pow(t - 10, 2)); }), eb = g.map(function (t) { return Math.exp(-Math.pow(t - 10.37, 2)); });
ok(M.xcorr(ea, eb, 0.01, 0.2).atEdge, '최대 지연이 모자라면 끝에 걸렸다고 알린다');

// ---------- 예제 전체 흐름 ----------
var files = M.sampleFiles();
var ds = files.map(function (f) { var d = M.readTable(M.parseCSV(f.text)); d.name = f.name; return d; });
eq([ds[0].fs, ds[1].fs], [50, 200], '예제: 샘플링 주기 50 Hz · 200 Hz');
eq(M.startOffsets(ds, 0).offsets, [0, 1.92], '예제: 시작 시각 차이 1.92초');
var est = M.estimateFor(ds, 0, '마스트_좌', 1, 'Acc_Z', { maxLag: 2, mode: 'env' });
near(est.lag, M.SAMPLE_TRUTH.lag, 0.02, '예제: 숨겨 둔 지연 0.42초를 찾는다 (응력 ↔ 가속도, 포락선)');
ok(est.r > 0.7, '포락선이면 물리량이 달라도 상관이 높다', est.r);
ok(M.estimateFor(ds, 0, '마스트_좌', 1, 'Acc_Z', { maxLag: 2, mode: 'raw' }).r < 0.5, '응력과 가속도를 원신호로 비교하면 상관이 낮다(그래서 포락선이 기본)');
eq(M.outliers(ds[0].channels[0].y, 8), [M.SAMPLE_TRUTH.glitchA], '예제: 센서 튐 한 점만 이상치');
ds[1].lag = est.lag; ds[1].lagSource = '교차상관'; ds[1].lagR = est.r;
var res = M.sync(ds, { ref: 0 });
eq(res.dt, 0.005, '공통 간격 = 가장 짧은 원래 간격');
near(res.from, 1.92 - est.lag, 0.006, '겹치는 구간의 시작 = B 의 시작');
eq(res.cols.length, 4, '채널 4개');
ok(res.cols[0].stats.max < 200 && res.cols[0].statsAll.max > 900, '통계는 이상치를 빼고, 전체 통계는 따로 남긴다', res.cols[0].stats.max);
var res0 = M.sync(ds.map(function (d) { return Object.assign({}, d, { lag: 0 }); }), { ref: 0 });
eq([res0.cols[0].interp, res0.cols[2].interp], [true, false], '50 Hz 채널은 보간값, 간격·위상이 맞는 200 Hz 채널은 원래 점');
eq(res.cols[2].interp, true, '지연을 빼서 위상이 어긋나면 200 Hz 채널도 보간값');
near(res.offsets[1].shift, 1.92 - est.lag, 1e-6, '최종 이동 = 시작 시각 차이 − 지연');
near(res0.from - res.from, 0.42, 0.006, '지연을 빼면 B 전체가 그만큼 앞으로 온다');
var cut = M.sync(ds, { ref: 0, from: 10, to: 20, dt: 0.01 });
eq([cut.t[0], cut.t[cut.t.length - 1], cut.t.length], [10, 20, 1001], '구간 자르기 + 간격 지정');
var noUse = ds.map(function (d) { return Object.assign({}, d); }); noUse[1].use = { Acc_X: false };
eq(M.sync(noUse, { ref: 0 }).cols.map(function (c) { return c.name; }), ['마스트_좌', '틸트실린더', 'Acc_Z'], '뺀 채널은 결과에 없다');
var rows = M.exportRows(cut);
eq(rows[0].slice(0, 3), ['시간(s)', '시각', '마스트_좌 (MPa) [응력_SG01.csv]'], '내보내기 머리 줄');
eq(rows[1][1], '2026-10-15 10:20:10.000', '내보내기: 기준 시작 + 공통축 초 = 절대 시각');
ok(/0\.42/.test(M.summaryText(res)) || /0\.4\d/.test(M.summaryText(res)), '요약 문장에 지연이 들어간다');
var noStart = [M.readTable(M.parseCSV('t,v\n0,1\n1,2\n2,3')), M.readTable(M.parseCSV('t,v\n0,1\n1,2\n2,3'))];
noStart[0].name = 'a'; noStart[1].name = 'b';
ok(M.startOffsets(noStart, 0).issues.length === 1, '시작 시각이 없으면 0초로 보고 알린다');
var big = M.sync(ds, { ref: 0, maxRows: 1000 });
ok(big.t.length <= 1000 && big.issues.some(function (s) { return s.indexOf('간격을') >= 0; }), '점이 너무 많으면 간격을 늘리고 알린다');
var dec = M.decimate(g, xa.map(function (v, i) { return i === 777 ? 50 : v; }), 100);
ok(dec.y.indexOf(50) >= 0 && dec.t.length <= 200, '그리기용 줄이기에서 봉우리가 살아남는다');

// ---------- 3D ----------
var px = [], py = [], pz = [];
[0, 1, 2].forEach(function (x) { [0, 10].forEach(function (y) { px.push(x); py.push(y); pz.push(2 * x + 3 * y); }); });
var sg = M.surface(px, py, pz);
eq([sg.kind, sg.xs, sg.ys, sg.z], ['grid', [0, 1, 2], [0, 10], [[0, 2, 4], [30, 32, 34]]], '격자 데이터는 측정값 그대로 곡면');
var si = M.surface(px, py, pz, { force: true, nx: 5, ny: 3 });
eq([si.kind, si.z[0][0], si.z[2][4]], ['idw', 0, 34], 'IDW: 측정점 위에서는 측정값');
ok(si.z[1][2] > M.stats(pz).min && si.z[1][2] < M.stats(pz).max, 'IDW: 사이 값은 측정 범위 안');
eq(M.detectGrid([0, 0, 1], [0, 1, 0], [1, 2, 3]), null, '빠진 조합이 있으면 격자가 아니다');
eq(M.tableColumns(M.parseCSV('# 메모\n하중,높이,메모,응력\n1,2,가,3\n4,5,나,6\n7,8,다,9')).map(function (c) { return c.name; }), ['하중', '높이', '응력'], '3D 표: 숫자 열만');
var s3 = M.sample3D();
eq([s3.length - 1, M.surface(s3.slice(1).map(function (r) { return r[0]; }), s3.slice(1).map(function (r) { return r[1]; }), s3.slice(1).map(function (r) { return r[2]; })).kind], [42, 'grid'], '3D 예제: 7×6 시험 매트릭스');
eq(M.project([1, 0, 0], { yaw: 0, pitch: 0 }), { x: 1, y: 0, depth: 0 }, '투영: 정면에서 x 축은 오른쪽');
eq(M.project([0, 0, 1], { yaw: 0, pitch: 0 }), { x: 0, y: 1, depth: 0 }, '투영: z 축은 위');
var pr90 = M.project([1, 0, 0], { yaw: Math.PI / 2, pitch: 0 });
near(pr90.x, 0, 1e-9, '투영: 90도 돌리면 x 축이 깊이로 간다'); near(pr90.depth, 1, 1e-9, '투영: 깊이 1');
eq(M.project([0, 0, 1], { yaw: 0, pitch: 0, zoom: 2 }).y, 2, '투영: 확대 배율');
eq([M.colormap('viridis', 0), M.colormap('viridis', 1), M.colormap('viridis', 5)], [[68, 1, 84], [253, 231, 37], [253, 231, 37]], '색상 맵 끝값(넘치면 자른다)');
eq(M.niceTicks(0, 10, 5), [0, 2, 4, 6, 8, 10], '눈금');


/* ===================== v1.1 — 3D 작업실(붙여넣기 · 삼각망 · 2차 회귀 · 뷰 큐브) ===================== */
var v10 = passed + failed;
function hasS(t, sub, label) { ok(String(t).indexOf(sub) >= 0, label, '「' + sub + '」 없음: ' + String(t).slice(0, 160)); }
// 붙여넣기
eq(M.parsePaste('Mass\tHeight\tV\n0\t300\tSafe\n700\t1,190\t20\n'), [['Mass', 'Height', 'V'], [0, 300, 'Safe'], [700, 1190, 20]], '탭 구분 · 천 단위 쉼표 · 글자 그대로');
eq(M.parsePaste('a,b,c\n1,2,3'), [['a', 'b', 'c'], [1, 2, 3]], '쉼표 구분'); eq(M.parsePaste('a b c\n1 2 3'), [['a', 'b', 'c'], [1, 2, 3]], '공백 구분'); eq(M.parsePaste(''), [], '빈 글');
var cols = M.tableColumnsWithLabels(M.parsePaste('Mass\tHeight\tV\n0\t300\tSafe\n700\t1190\t20\n1400\t2080\t18\n2100\t2970\tSafe'));
eq(cols.map(function (c) { return [c.name, c.numeric, c.labeled]; }), [['Mass', 4, 0], ['Height', 4, 0], ['V', 2, 2]], '라벨 섞인 열도 읽는다');
eq(cols[2].labels, ['Safe', '', '', 'Safe'], '라벨 자리'); eq(M.applyLabelMap(cols[2], { Safe: 40 }).values, [40, 20, 18, 40], '라벨 → 숫자'); eq(M.applyLabelMap(cols[2], {}).replaced, [], '바꾸지 않으면 그대로(NaN)');
// 삼각분할
var tri = M.delaunay([0, 1, 0, 1], [0, 0, 1, 1]); eq(tri.length, 2, '정사각형 4점 → 삼각형 2개'); ok(tri.every(function (t) { return t.length === 3 && t.every(function (i) { return i >= 0 && i < 4; }); }), '꼭짓점 번호는 원래 점');
eq(M.delaunay([0, 1], [0, 0]).length, 0, '점 2개면 없음'); eq(M.delaunay([0, 1, 2], [0, 0, 0]).length, 0, '일직선 3점이면 없음');
eq(M.delaunay([0, 0, 1, 1], [0, 0, 1, 0]).length, 1, '같은 자리 중복 점은 하나로');
var sl = M.sampleLimit(), sc = M.tableColumnsWithLabels(sl); eq(M.delaunay(sc[0].values, sc[1].values).length, 50, '6×6 격자 → 삼각형 50개');
ok(M.delaunay(sc[0].values, sc[1].values).every(function (t) { var a = [sc[0].values[t[0]], sc[1].values[t[0]]], b = [sc[0].values[t[1]], sc[1].values[t[1]]], c = [sc[0].values[t[2]], sc[1].values[t[2]]]; return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0; }), '삼각형은 시계 반대 방향');
// 2차 회귀 — 정확히 2차인 데이터에서 계수가 되살아난다(기획자 계수와 같은 크기 차이: 질량 0~3500 · 높이 300~4750)
var X = [], Y = [], Z = [], T = { a: 40.78295499, b: -0.01088542, c: -0.005595733, d: 8.58113e-7, e: 3.85e-7, f: 7.98193e-7 };
for (var i = 0; i < 6; i++) for (var j = 0; j < 6; j++) { var mx = i * 700, hy = 300 + j * 890; X.push(mx); Y.push(hy); Z.push(M.quadEval(T, mx, hy)); }
var F = M.quadFit(X, Y, Z);
['a', 'b', 'c', 'd', 'e', 'f'].forEach(function (k) { near(F.coef[k], T[k], Math.abs(T[k]) * 1e-6 + 1e-12, '계수 ' + k + ' 복원'); });
near(F.r2, 1, 1e-9, 'R² = 1'); eq(F.n, 36, '점 36개'); near(F.rmse, 0, 1e-6, 'RMSE 0');
near(M.quadEval(F.coef, 700, 4750), 18.34, 0.05, '예측값(700, 4750) ≈ 18.3');
hasS(M.quadFormula(T, ['Mass', 'Height', 'V']), 'V = 40.7830 + -0.0108854·Mass', '회귀식 글'); hasS(M.quadFormula(T, ['Mass', 'Height', 'V']), '·Mass·Height', '교차항');
ok(M.quadFit([0, 1, 2], [0, 1, 2], [1, 2, 3]).error.indexOf('6개 이상') >= 0, '점이 모자라면 알린다');
ok(M.quadFit([0, 1, 2, 3, 4, 5, 6], [0, 0, 0, 0, 0, 0, 0], [1, 2, 3, 4, 5, 6, 7]).error.indexOf('정할 수 없습니다') >= 0, '한 직선 위 점들은 2차 곡면을 정할 수 없다');
var Zn = Z.map(function (v, k) { return v + (k % 2 ? 0.5 : -0.5); }), Fn = M.quadFit(X, Y, Zn); ok(Fn.r2 > 0.98 && Fn.r2 < 1 && Fn.maxAbs > 0.3, '잡음이 있으면 R² < 1 · 최대 잔차');
var st = M.quadStats(T, X, Y, Zn); eq(st.residuals.length, 36, '직접 넣은 계수로 잔차'); ok(Math.abs(st.residuals[0].resid) === 0.5, '잔차 값');
var gr = M.regGrid(T, 0, 3500, 300, 4750, 5); eq([gr.xs.length, gr.ys.length, gr.z.length, gr.z[0].length], [5, 5, 5, 5], '회귀 격자 5×5'); near(gr.z[0][0], T.a + T.c * 300 + T.e * 300 * 300, 1e-9, '격자 값 = 회귀식');
// 라벨을 숫자로 바꾸면 R² 가 떨어진다(라벨은 한계 없음이지 측정값이 아니다)
var sz = M.applyLabelMap(sc[2], { Safe: 40 }).values, Fs = M.quadFit(sc[0].values, sc[1].values, sz); ok(Fs.r2 > 0.5 && Fs.r2 < 0.95, '예제(라벨 → 40)는 R² 가 0.5~0.95');
// 뷰 큐브
var iso = { yaw: -0.65, pitch: -0.55 }, faces = M.cubeFaces(iso);
eq(faces.map(function (f) { return f.name; }).sort(), ['FRONT', 'RIGHT', 'TOP'], '등각에서 보이는 면 3개'); ok(faces[0].depth <= faces[1].depth, '가까운 면이 앞');
eq(M.cubeFaces({ yaw: 0, pitch: 0 }).map(function (f) { return f.name; }), ['FRONT'], '정면에서는 FRONT 만');
eq(M.cubeFaces(M.CUBE_VIEWS.TOP).map(function (f) { return f.name; }), ['TOP'], 'TOP 뷰에서는 TOP 만');
eq(M.cubeHit(iso, 0, 0.6), 'TOP', '위쪽을 누르면 TOP'); eq(M.cubeHit(iso, -0.4, -0.3), 'FRONT', '왼쪽 아래는 FRONT'); eq(M.cubeHit(iso, 0.5, -0.3), 'RIGHT', '오른쪽 아래는 RIGHT'); eq(M.cubeHit(iso, 3, 3), null, '큐브 밖은 없음');
eq(M.pointInPoly(0.5, 0.5, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]), true, '다각형 안'); eq(M.pointInPoly(2, 0.5, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]), false, '다각형 밖');
eq(Object.keys(M.CUBE_VIEWS).length, 7, '뷰 7개(면 6 + 등각)');
// 예제
eq(sl.length, 37, '예제 36점'); eq(sl.filter(function (r) { return r[2] === 'Safe'; }).length, 12, '예제 Safe 12칸');

console.log('v1.0 ' + v10 + ' · v1.1 ' + (passed + failed - v10) + '개 검사');

console.log('\n규칙 통과 ' + passed + ' · 실패 ' + failed);
process.exit(failed ? 1 : 0);
