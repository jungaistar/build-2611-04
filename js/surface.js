/* 3D 작업실 화면 — 삼각분할 · 회귀 · 투영 · 큐브 판정은 engine.js 가 한다. 여기서는 읽고, 창을 관리하고, 그린다. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var M = window.Meas;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var FONT = '"Apple SD Gothic Neo","Malgun Gothic",sans-serif';
  var KINDS = { mesh: '측정점 삼각망 면', reg: '회귀 곡면 + 측정점', pred: '회귀 곡면 + 예측점', points: '측정점만' };
  var state = { cols: [], labelMap: {}, fit: null, coefSrc: '', pred: null, shared: { yaw: -0.65, pitch: -0.55, zoom: 1 }, panels: [], seq: 0 };
  function msg(id, html, cls) { $(id).innerHTML = html ? '<div class="' + (cls || 'note') + '">' + html + '</div>' : ''; }
  function stat(k, v) { return '<div class="stat"><b>' + v + '</b>' + k + '</div>'; }
  function fmt(v) { if (!isFinite(v)) return '—'; var a = Math.abs(v); return a >= 1000 ? String(Math.round(v)) : a >= 10 ? String(M.round(v, 1)) : String(M.round(v, 3)); }

  /* ---------- 1. 데이터 ---------- */
  function loadRows(rows, srcName) {
    var cols = M.tableColumnsWithLabels(rows);
    if (cols.length < 3) { msg('d-msg', '숫자 열이 3개 이상 필요합니다(X · Y · Z). 읽은 열: ' + cols.length, 'warn'); return; }
    state.cols = cols; state.labelMap = {}; state.fit = null; state.coefSrc = ''; state.pred = null;
    $('axes').hidden = false;
    ['ax-x', 'ax-y', 'ax-z'].forEach(function (id, k) { $(id).innerHTML = cols.map(function (c, i) { return '<option value="' + i + '"' + (i === Math.min(k, cols.length - 1) ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join(''); });
    if (!state.panels.length) ['mesh', 'reg', 'pred'].forEach(addPanel);
    msg('d-msg', esc(srcName) + ' — ' + rows.length + '줄 · 열 ' + cols.map(function (c) { return c.name; }).join(' · '), 'ok');
    refit(); renderAll();
  }
  function cur() {
    var ix = +$('ax-x').value, iy = +$('ax-y').value, iz = +$('ax-z').value, cx = state.cols[ix], cy = state.cols[iy], cz = state.cols[iz];
    if (!cx || !cy || !cz) return null;
    var zz = M.applyLabelMap(cz, state.labelMap);
    return { names: [cx.name, cy.name, cz.name], x: cx.values, y: cy.values, z: zz.values, labels: cz.labels, replaced: zz.replaced, zcol: cz };
  }
  function renderLabels() {
    var d = cur(); if (!d) return;
    var set = {}; d.labels.forEach(function (l) { if (l) set[l] = (set[l] || 0) + 1; });
    var keys = Object.keys(set);
    $('label-box').innerHTML = keys.length ? '<span class="sub">Z 라벨: </span>' + keys.map(function (k) { return '<label class="lab">' + esc(k) + '(' + set[k] + ') → <input type="text" data-label="' + esc(k) + '" value="' + esc(state.labelMap[k] == null ? '' : state.labelMap[k]) + '" placeholder="숫자 또는 빈칸(뺌)" inputmode="decimal"></label>'; }).join('') : '';
    var n = d.x.filter(function (v, i) { return isFinite(v) && isFinite(d.y[i]) && isFinite(d.z[i]); }).length;
    $('d-info').innerHTML = '<div class="stats">' + stat('점(숫자 Z)', n) + (keys.length ? stat('라벨 점', d.labels.filter(Boolean).length + (d.replaced.length ? ' (숫자로 바꿈 ' + d.replaced.length + ')' : ' (곡면에서 뺌)')) : '') + stat('X 범위', fmt(M.stats(d.x).min) + ' ~ ' + fmt(M.stats(d.x).max)) + stat('Y 범위', fmt(M.stats(d.y).min) + ' ~ ' + fmt(M.stats(d.y).max)) + '</div>';
  }

  /* ---------- 2. 회귀 ---------- */
  function refit() {
    var d = cur(); if (!d) return;
    if (state.coefSrc === 'manual' && state.fit) { var st = M.quadStats(state.fit.coef, d.x, d.y, d.z); state.fit = Object.assign({}, st, { coef: state.fit.coef, src: 'manual', n: st.residuals.length }); }
    else { var f = M.quadFit(d.x, d.y, d.z); state.fit = f.error ? null : f; state.fitError = f.error || ''; state.coefSrc = f.error ? '' : 'fit'; }
    renderFit();
  }
  function renderFit() {
    var d = cur(); $('s-fit').hidden = !d; $('s-views').hidden = !d; if (!d) return;
    var f = state.fit;
    if (!f) { $('fit-info').innerHTML = '<div class="warn">' + esc(state.fitError || '회귀를 맞추지 못했습니다.') + ' 삼각망 면과 측정점은 그대로 봅니다.</div>'; }
    else {
      $('fit-info').innerHTML = '<div class="formula"><code id="formula">' + esc(M.quadFormula(f.coef, d.names)) + '</code></div><div class="stats">' +
        stat('계수 출처', f.src === 'manual' ? '직접 입력' : '<span class="calc-i">계산</span> 최소제곱(점 ' + f.n + '개)') + stat('R²', f.r2 == null ? '—' : M.round(f.r2, 4)) + stat('RMSE', fmt(f.rmse)) + stat('최대 |잔차|', fmt(f.maxAbs)) + '</div>' +
        (f.r2 != null && f.r2 < 0.8 ? '<div class="warn">R² 가 0.8 아래입니다 — 2차 곡면으로는 잘 맞지 않는 데이터이거나 라벨(Safe 등)을 숫자로 바꾼 값이 섞였을 수 있습니다.</div>' : '');
    }
    var c = f ? f.coef : { a: '', b: '', c: '', d: '', e: '', f: '' };
    $('coefs').innerHTML = ['f', 'e', 'd', 'c', 'b', 'a'].map(function (k) { return '<label>' + k + '<input type="text" data-coef="' + k + '" value="' + (c[k] === '' ? '' : Number(c[k]).toPrecision(8)) + '" inputmode="decimal"></label>'; }).join('');
    renderPred();
  }
  function applyCoef() {
    var coef = {}, okAll = true;
    ['a', 'b', 'c', 'd', 'e', 'f'].forEach(function (k) { var v = M.toNum(document.querySelector('[data-coef="' + k + '"]').value); if (!isFinite(v)) okAll = false; coef[k] = v; });
    if (!okAll) { msg('d-msg', '계수 6개를 모두 숫자로 넣어 주세요.', 'warn'); return; }
    state.fit = { coef: coef, src: 'manual' }; state.coefSrc = 'manual'; refit(); renderAll();
  }
  function renderPred() {
    var d = cur(), f = state.fit;
    if (!d || !f || !state.pred) { $('pred-out').innerHTML = state.pred && !f ? '<span class="warn-i">회귀식이 없어 예측할 수 없습니다</span>' : ''; return; }
    var p = state.pred, z = M.quadEval(f.coef, p.x, p.y), sx = M.stats(d.x), sy = M.stats(d.y);
    var outside = p.x < sx.min || p.x > sx.max || p.y < sy.min || p.y > sy.max;
    $('pred-out').innerHTML = '<b>' + esc(d.names[2]) + ' ≈ ' + fmt(z) + '</b> <span class="calc-i">계산</span>' + (outside ? ' <span class="warn-i">측정 범위 밖(외삽)</span>' : '');
    p.z = z;
  }

  /* ---------- 3. 창(패널) ---------- */
  function addPanel(kind) {
    var id = 'p' + (++state.seq);
    state.panels.push({ id: id, kind: KINDS[kind] ? kind : 'reg', view: null, drag: null });
    renderPanels();
  }
  function viewOf(p) { return $('sync').checked || !p.view ? state.shared : p.view; }
  function renderPanels() {
    $('panels').innerHTML = state.panels.map(function (p) {
      return '<div class="panel" data-id="' + p.id + '"><div class="panel-h"><select data-kind="' + p.id + '">' + Object.keys(KINDS).map(function (k) { return '<option value="' + k + '"' + (k === p.kind ? ' selected' : '') + '>' + esc(KINDS[k]) + '</option>'; }).join('') + '</select>' +
        '<span class="cube-btns">' + ['FRONT', 'REAR', 'LEFT', 'RIGHT', 'TOP', 'BOTTOM', 'ISO'].map(function (n) { return '<button class="x" data-face="' + n + '" data-id="' + p.id + '" type="button">' + n + '</button>'; }).join('') + '</span>' +
        '<button class="x" data-png="' + p.id + '" type="button">PNG</button><button class="x" data-del="' + p.id + '" type="button">닫기</button></div>' +
        '<div class="canvas-wrap"><canvas data-canvas="' + p.id + '" aria-label="' + esc(KINDS[p.kind]) + '"></canvas></div><div class="panel-f sub" data-foot="' + p.id + '"></div></div>';
    }).join('');
    state.panels.forEach(bindPanel);
    drawAll();
  }
  function bindPanel(p) {
    var cv = document.querySelector('canvas[data-canvas="' + p.id + '"]');
    cv.addEventListener('pointerdown', function (e) {
      var r = cv.getBoundingClientRect(), hit = cubeAt(p, cv, e.clientX - r.left, e.clientY - r.top);
      if (hit) { setFace(p, hit); return; }
      var v = viewOf(p); p.drag = { x: e.clientX, y: e.clientY, yaw: v.yaw, pitch: v.pitch }; cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', function (e) {
      if (!p.drag) return; var v = viewOf(p);
      v.yaw = p.drag.yaw + (e.clientX - p.drag.x) * 0.01; v.pitch = Math.max(-1.56, Math.min(1.56, p.drag.pitch + (e.clientY - p.drag.y) * 0.01));
      $('sync').checked ? drawAll() : draw(p);
    });
    ['pointerup', 'pointercancel'].forEach(function (t) { cv.addEventListener(t, function () { p.drag = null; }); });
    cv.addEventListener('wheel', function (e) { e.preventDefault(); var v = viewOf(p); v.zoom = Math.max(0.3, Math.min(5, v.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))); $('sync').checked ? drawAll() : draw(p); }, { passive: false });
  }
  function ownView(p) { if (!p.view) p.view = Object.assign({}, state.shared); return p.view; }
  function setFace(p, name) {
    var t = M.CUBE_VIEWS[name]; if (!t) return;
    var v = $('sync').checked ? state.shared : ownView(p);
    v.yaw = t.yaw; v.pitch = t.pitch;
    $('sync').checked ? drawAll() : draw(p);
  }
  // 큐브 그림: 캔버스 오른쪽 위, 반지름 cubeR 픽셀. 클릭 좌표 → 면 이름
  function cubeGeom(cv) { var W = cv.clientWidth || 600; return { cx: W - 58, cy: 58, r: 22 }; }
  function cubeAt(p, cv, x, y) {
    var g = cubeGeom(cv), v = viewOf(p);
    if (Math.abs(x - g.cx) > g.r * 1.9 || Math.abs(y - g.cy) > g.r * 1.9) return null;
    return M.cubeHit({ yaw: v.yaw, pitch: v.pitch }, (x - g.cx) / g.r, -(y - g.cy) / g.r);
  }
  function drawCube(g2, cv, view) {
    var g = cubeGeom(cv), faces = M.cubeFaces(view).slice().reverse();   // 먼 면부터
    faces.forEach(function (f) {
      g2.beginPath(); f.pts.forEach(function (pt, i) { var X = g.cx + pt.x * g.r, Y = g.cy - pt.y * g.r; i ? g2.lineTo(X, Y) : g2.moveTo(X, Y); }); g2.closePath();
      g2.fillStyle = f.name === 'TOP' ? '#dbe7f3' : f.name === 'BOTTOM' ? '#c5d2df' : '#edf2f7'; g2.fill(); g2.strokeStyle = '#5b6b7b'; g2.lineWidth = 1; g2.stroke();
      var cx = f.pts.reduce(function (a, q) { return a + q.x; }, 0) / 4, cy = f.pts.reduce(function (a, q) { return a + q.y; }, 0) / 4;
      g2.fillStyle = '#152232'; g2.font = 'bold 7px ' + FONT; g2.textAlign = 'center'; g2.fillText(f.name, g.cx + cx * g.r, g.cy - cy * g.r + 2.5); g2.textAlign = 'left';
    });
    // 축 표시
    var ax = [['X', [1.9, 0, 0], '#c8341f'], ['Y', [0, 1.9, 0], '#0a6045'], ['Z', [0, 0, 1.9], '#154b6e']];
    ax.forEach(function (a) { var q = M.project(a[1], { yaw: view.yaw, pitch: view.pitch, zoom: 1 }); g2.strokeStyle = a[2]; g2.beginPath(); g2.moveTo(g.cx, g.cy); g2.lineTo(g.cx + q.x * g.r * 0.7, g.cy - q.y * g.r * 0.7); g2.stroke(); g2.fillStyle = a[2]; g2.font = 'bold 9px ' + FONT; g2.fillText(a[0], g.cx + q.x * g.r * 0.8, g.cy - q.y * g.r * 0.8 + 3); });
  }
  function drawAll() { state.panels.forEach(draw); }
  function draw(p) {
    var cv = document.querySelector('canvas[data-canvas="' + p.id + '"]'); if (!cv) return;
    var d = cur(), view = viewOf(p), dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 600, H = Math.round(W * 0.72);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.font = '12px ' + FONT;
    var foot = document.querySelector('[data-foot="' + p.id + '"]');
    if (!d) { g.fillStyle = '#5b6b7b'; g.fillText('데이터를 먼저 붙여 넣어 주세요.', 16, 28); return; }
    var keep = []; for (var i = 0; i < d.x.length; i++) if (isFinite(d.x[i]) && isFinite(d.y[i]) && isFinite(d.z[i])) keep.push(i);
    var xs = keep.map(function (i) { return d.x[i]; }), ys = keep.map(function (i) { return d.y[i]; }), zs = keep.map(function (i) { return d.z[i]; });
    if (keep.length < 3) { g.fillStyle = '#5b6b7b'; g.fillText('숫자 점이 3개 이상 필요합니다.', 16, 28); return; }
    var sx = M.stats(xs), sy = M.stats(ys), sz = M.stats(zs), f = state.fit, cmap = $('cmap').value, n = +$('grid').value || 30;
    var grid = f && (p.kind === 'reg' || p.kind === 'pred') ? M.regGrid(f.coef, sx.min, sx.max, sy.min, sy.max, n) : null;
    if (grid) { var flat = [].concat.apply([], grid.z); var sg = M.stats(flat); sz = { min: Math.min(sz.min, sg.min), max: Math.max(sz.max, sg.max) }; }
    if (state.pred && p.kind === 'pred' && isFinite(state.pred.z)) sz = { min: Math.min(sz.min, state.pred.z), max: Math.max(sz.max, state.pred.z) };
    var sc = Math.min(W * 0.8, H) * 0.34 * view.zoom, ox = W * 0.46, oy = H * 0.52;
    var nx = function (v) { return ((v - sx.min) / ((sx.max - sx.min) || 1)) * 2 - 1; }, ny = function (v) { return ((v - sy.min) / ((sy.max - sy.min) || 1)) * 2 - 1; };
    var nz = function (v) { return (((v - sz.min) / ((sz.max - sz.min) || 1)) * 2 - 1) * 0.75; }, cz = function (v) { return (v - sz.min) / ((sz.max - sz.min) || 1); };
    var P = function (x, y, z) { var q = M.project([x, y, z], view); return { x: ox + q.x * sc, y: oy - q.y * sc, d: q.depth }; };
    // 축 · 바닥
    g.strokeStyle = '#e1e7ed'; g.lineWidth = 1;
    for (var k = -1; k <= 1.0001; k += 0.5) { line(g, P(k, -1, -0.75), P(k, 1, -0.75)); line(g, P(-1, k, -0.75), P(1, k, -0.75)); }
    g.strokeStyle = '#5b6b7b'; line(g, P(-1, -1, -0.75), P(1, -1, -0.75)); line(g, P(-1, -1, -0.75), P(-1, 1, -0.75)); line(g, P(-1, -1, -0.75), P(-1, -1, 0.75));
    g.fillStyle = '#5b6b7b';
    M.niceTicks(sx.min, sx.max, 4).forEach(function (v) { var q = P(nx(v), -1.12, -0.75); g.fillText(fmt(v), q.x - 10, q.y + 12); });
    M.niceTicks(sy.min, sy.max, 4).forEach(function (v) { var q = P(1.1, ny(v), -0.75); g.fillText(fmt(v), q.x + 4, q.y + 4); });
    M.niceTicks(sz.min, sz.max, 4).forEach(function (v) { var q = P(-1, -1, nz(v)); g.fillText(fmt(v), q.x - 40, q.y + 4); });
    g.fillStyle = '#152232'; g.font = 'bold 12px ' + FONT;
    var lx = P(0, -1.32, -0.75), ly = P(1.32, 0, -0.75), lz = P(-1, -1, 0.92);
    g.fillText('X ' + d.names[0], lx.x - 30, lx.y + 16); g.fillText('Y ' + d.names[1], ly.x + 6, ly.y + 14); g.fillText('Z ' + d.names[2], lz.x - 20, lz.y);
    var items = [];
    if (p.kind === 'mesh') {
      M.delaunay(xs, ys).forEach(function (t) {
        var q = t.map(function (i) { return P(nx(xs[i]), ny(ys[i]), nz(zs[i])); }), zm = (zs[t[0]] + zs[t[1]] + zs[t[2]]) / 3;
        items.push({ d: (q[0].d + q[1].d + q[2].d) / 3, q: q, c: M.colormap(cmap, cz(zm)), edge: true });
      });
    }
    if (grid) {
      for (var j = 0; j < grid.ys.length - 1; j++) for (var i2 = 0; i2 < grid.xs.length - 1; i2++) {
        var z4 = [grid.z[j][i2], grid.z[j][i2 + 1], grid.z[j + 1][i2 + 1], grid.z[j + 1][i2]];
        var q4 = [P(nx(grid.xs[i2]), ny(grid.ys[j]), nz(z4[0])), P(nx(grid.xs[i2 + 1]), ny(grid.ys[j]), nz(z4[1])), P(nx(grid.xs[i2 + 1]), ny(grid.ys[j + 1]), nz(z4[2])), P(nx(grid.xs[i2]), ny(grid.ys[j + 1]), nz(z4[3]))];
        items.push({ d: (q4[0].d + q4[1].d + q4[2].d + q4[3].d) / 4, q: q4, c: M.colormap(cmap, cz((z4[0] + z4[1] + z4[2] + z4[3]) / 4)), alpha: 0.85 });
      }
    }
    if (p.kind !== 'pred') for (var m = 0; m < xs.length; m++) { var pt = P(nx(xs[m]), ny(ys[m]), nz(zs[m])); items.push({ d: pt.d - 0.002, p: pt, c: M.colormap(cmap, cz(zs[m])), rep: d.replaced.indexOf(keep[m]) >= 0 }); }
    if (p.kind === 'pred' && state.pred && isFinite(state.pred.z)) { var pp = P(nx(state.pred.x), ny(state.pred.y), nz(state.pred.z)); items.push({ d: pp.d - 0.01, p: pp, c: [200, 52, 31], big: true }); var base = P(nx(state.pred.x), ny(state.pred.y), -0.75); items.push({ d: pp.d - 0.009, ln: [base, pp] }); }
    items.sort(function (a, b) { return b.d - a.d; });
    items.forEach(function (it) {
      if (it.q) { g.beginPath(); g.moveTo(it.q[0].x, it.q[0].y); for (var r = 1; r < it.q.length; r++) g.lineTo(it.q[r].x, it.q[r].y); g.closePath(); g.globalAlpha = it.alpha || 1; g.fillStyle = 'rgb(' + it.c.join(',') + ')'; g.fill(); g.globalAlpha = 1; g.strokeStyle = it.edge ? 'rgba(21,34,50,.35)' : 'rgba(21,34,50,.12)'; g.lineWidth = 0.6; g.stroke(); }
      else if (it.ln) { g.strokeStyle = '#c8341f'; g.setLineDash([4, 3]); g.lineWidth = 1.2; line(g, it.ln[0], it.ln[1]); g.setLineDash([]); }
      else { g.beginPath(); g.arc(it.p.x, it.p.y, it.big ? 6 : 3.4, 0, 2 * Math.PI); g.fillStyle = 'rgb(' + it.c.join(',') + ')'; g.fill(); g.strokeStyle = it.rep ? '#c8341f' : '#152232'; g.lineWidth = it.rep ? 1.6 : 0.8; g.stroke(); }
    });
    // 색 막대 · 제목 · 큐브
    var bx = W - 46, by = H * 0.3, bh = H * 0.5;
    for (var s = 0; s < 100; s++) { g.fillStyle = 'rgb(' + M.colormap(cmap, 1 - s / 99).join(',') + ')'; g.fillRect(bx, by + bh * s / 100, 14, bh / 100 + 1); }
    g.strokeStyle = '#5b6b7b'; g.strokeRect(bx, by, 14, bh); g.fillStyle = '#152232'; g.font = '11px ' + FONT; g.textAlign = 'right'; g.fillText(fmt(sz.max), bx - 4, by + 9); g.fillText(fmt(sz.min), bx - 4, by + bh); g.textAlign = 'left';
    g.fillStyle = '#152232'; g.font = 'bold 13px ' + FONT; g.fillText(KINDS[p.kind] + ' — ' + d.names[2], 14, 20);
    g.font = '11px ' + FONT; g.fillStyle = '#5b6b7b';
    g.fillText(p.kind === 'mesh' ? '면 = 측정점 들로네 삼각망(보간 없음)' : grid ? '곡면 = 회귀식(' + (f.src === 'manual' ? '직접 입력 계수' : '계산') + ') · 점 = 측정값' + (d.replaced.length ? ' · 빨간 테두리 = 라벨을 숫자로 바꾼 점' : '') : f ? '' : '회귀식 없음 — 측정점만', 14, 36);
    drawCube(g, cv, view);
    if (foot) foot.textContent = (p.kind === 'pred' && state.pred ? '예측점 (' + fmt(state.pred.x) + ', ' + fmt(state.pred.y) + ') → ' + fmt(state.pred.z) + ' · ' : '') + 'yaw ' + M.round(view.yaw, 2) + ' · pitch ' + M.round(view.pitch, 2) + ($('sync').checked ? ' · 동기화' : ' · 개별');
  }
  function line(g, a, b) { g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
  function renderAll() { renderLabels(); renderFit(); drawAll(); }

  /* ---------- 엑셀 ---------- */
  function exportXlsx() {
    var d = cur(); if (!d) return; var wb = XLSX.utils.book_new(), f = state.fit;
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[d.names[0], d.names[1], d.names[2], '라벨', '회귀 예측', '잔차']].concat(d.x.map(function (v, i) { var pr = f && isFinite(d.x[i]) && isFinite(d.y[i]) ? M.quadEval(f.coef, d.x[i], d.y[i]) : ''; return [v, d.y[i], isFinite(d.z[i]) ? d.z[i] : '', d.labels[i] || '', pr === '' ? '' : M.round(pr, 6), pr === '' || !isFinite(d.z[i]) ? '' : M.round(d.z[i] - pr, 6)]; }))), '점');
    if (f) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['회귀식', M.quadFormula(f.coef, d.names)], ['출처', f.src === 'manual' ? '직접 입력' : '최소제곱(계산)'], ['R²', f.r2 == null ? '' : f.r2], ['RMSE', f.rmse], [], ['f', 'e', 'd', 'c', 'b', 'a'], [f.coef.f, f.coef.e, f.coef.d, f.coef.c, f.coef.b, f.coef.a]]), '회귀계수');
      var keep = d.x.map(function (v, i) { return i; }).filter(function (i) { return isFinite(d.x[i]) && isFinite(d.y[i]); }), sx = M.stats(keep.map(function (i) { return d.x[i]; })), sy = M.stats(keep.map(function (i) { return d.y[i]; }));
      var gr = M.regGrid(f.coef, sx.min, sx.max, sy.min, sy.max, +$('grid').value || 30);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[d.names[1] + ' \\ ' + d.names[0]].concat(gr.xs.map(function (v) { return M.round(v, 6); }))].concat(gr.ys.map(function (yv, j) { return [M.round(yv, 6)].concat(gr.z[j].map(function (v) { return M.round(v, 6); })); }))), '회귀격자');
      if (state.pred) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[d.names[0], d.names[1], d.names[2] + '(예측)'], [state.pred.x, state.pred.y, state.pred.z]]), '예측');
    }
    XLSX.writeFile(wb, '3D작업실_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }

  /* ---------- 이벤트 ---------- */
  $('btn-paste').addEventListener('click', function () { var rows = M.parsePaste($('paste').value); if (rows.length < 4) { msg('d-msg', '머리글 포함 4줄 이상 붙여 넣어 주세요.', 'warn'); return; } loadRows(rows, '붙여 넣은 표'); });
  $('btn-sample').addEventListener('click', function () { var rows = M.sampleLimit(); $('paste').value = rows.map(function (r) { return r.join('\t'); }).join('\n'); loadRows(rows, '예제(가짜 질량 × 높이 → 한계 속도, Safe 12칸)'); });
  $('btn-clear').addEventListener('click', function () { $('paste').value = ''; state.cols = []; state.fit = null; state.pred = null; $('axes').hidden = true; $('s-fit').hidden = true; $('s-views').hidden = true; $('d-info').innerHTML = ''; msg('d-msg', ''); });
  $('f-file').addEventListener('change', function (e) {
    var f = e.target.files[0]; if (!f) return; var rd = new FileReader(), isX = /\.xlsx?$/i.test(f.name);
    rd.onload = function (ev) { var rows = isX ? (function () { var wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' }); return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' }); })() : M.parsePaste(ev.target.result); loadRows(rows, f.name); };
    if (isX) rd.readAsArrayBuffer(f); else rd.readAsText(f); e.target.value = '';
  });
  ['ax-x', 'ax-y', 'ax-z'].forEach(function (id) { $(id).addEventListener('change', function () { state.coefSrc = ''; state.pred = null; refit(); renderAll(); }); });
  $('label-box').addEventListener('change', function (e) { var k = e.target.dataset.label; if (k == null) return; var v = e.target.value.trim(); if (v === '') delete state.labelMap[k]; else state.labelMap[k] = v; refit(); renderAll(); });
  $('btn-coef-apply').addEventListener('click', applyCoef);
  $('btn-coef-fit').addEventListener('click', function () { state.coefSrc = ''; refit(); renderAll(); });
  $('btn-formula-copy').addEventListener('click', function () { var t = $('formula'); if (!t) return; var btn = this; (navigator.clipboard ? navigator.clipboard.writeText(t.textContent) : Promise.resolve()).then(function () { btn.textContent = '복사했습니다'; setTimeout(function () { btn.textContent = '회귀식 복사'; }, 1200); }); });
  $('btn-pred').addEventListener('click', function () { var x = M.toNum($('px').value), y = M.toNum($('py').value); if (!isFinite(x) || !isFinite(y)) { $('pred-out').innerHTML = '<span class="warn-i">x · y 를 숫자로 넣어 주세요</span>'; return; } state.pred = { x: x, y: y }; renderPred(); drawAll(); });
  $('sync').addEventListener('change', function () { if (this.checked) state.panels.forEach(function (p) { p.view = null; }); else state.panels.forEach(function (p) { p.view = Object.assign({}, state.shared); }); drawAll(); });
  ['cmap', 'grid'].forEach(function (id) { $(id).addEventListener('change', drawAll); });
  $('btn-add').addEventListener('click', function () { addPanel('reg'); });
  $('panels').addEventListener('change', function (e) { var id = e.target.dataset.kind; if (!id) return; var p = state.panels.filter(function (x) { return x.id === id; })[0]; p.kind = e.target.value; draw(p); });
  $('panels').addEventListener('click', function (e) {
    var t = e.target, id = t.dataset.id || t.dataset.png || t.dataset.del; if (!id) return;
    var p = state.panels.filter(function (x) { return x.id === id; })[0]; if (!p) return;
    if (t.dataset.face) setFace(p, t.dataset.face);
    else if (t.dataset.png) { var cv = document.querySelector('canvas[data-canvas="' + id + '"]'); var a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = '3D_' + p.kind + '_' + new Date().toISOString().slice(0, 10) + '.png'; document.body.appendChild(a); a.click(); a.remove(); }
    else if (t.dataset.del) { state.panels = state.panels.filter(function (x) { return x.id !== id; }); renderPanels(); }
  });
  $('btn-xlsx').addEventListener('click', exportXlsx);
  var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(drawAll, 150); });
  window.__surface = { state: state, cur: cur, draw: drawAll };
  if (location.hash === '#example') $('btn-sample').click();
})();
