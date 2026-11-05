/* 화면 — 판정·계산은 engine.js(Meas)가 한다. 여기서는 읽고, 그리고, 고른 값을 넘길 뿐이다. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var R = Meas.round;
  var COLORS = ['#154b6e', '#c8341f', '#2c8a6b', '#b07a12', '#7a5bb8', '#0b6e99', '#8a4b9c', '#5b6b7b'];
  var state = { files: [], res: null, hide: {}, lagInfo: {} };
  // files[i] = { name, rows, opt{timeCol,timeUnit,fs,start}, ds(readTable 결과 + name·pre·lag·use), refCh/tgtCh/mode/maxLag }

  /* ---------- 읽기 ---------- */
  function readFiles(list) {
    var arr = Array.prototype.slice.call(list), left = arr.length;
    arr.forEach(function (f) {
      var rd = new FileReader(), isX = /\.xlsx?$/i.test(f.name);
      rd.onload = function (e) {
        try {
          if (isX) {
            var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
            var sheets = wb.SheetNames.filter(function (n) { return XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1 }).length > 2; });
            sheets.forEach(function (n) { addFile(sheets.length > 1 ? f.name + ' · ' + n : f.name, XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' })); });
          } else addFile(f.name, Meas.parseCSV(e.target.result));
        } catch (err) { status('<div class="warn">「' + esc(f.name) + '」을 읽지 못했습니다: ' + esc(err.message) + '</div>'); }
        if (--left === 0) afterLoad();
      };
      if (isX) rd.readAsArrayBuffer(f); else rd.readAsText(f);
    });
  }
  function addFile(name, rows) {
    var f = { name: name, rows: rows, opt: {} };
    reread(f); state.files.push(f);
  }
  function reread(f) {
    var old = f.ds;
    f.ds = Meas.readTable(f.rows, f.opt);
    f.ds.name = f.name;
    f.ds.pre = old ? old.pre : {}; f.ds.use = old ? old.use : {};
    f.ds.lag = old ? old.lag : 0; f.ds.lagSource = old ? old.lagSource : '';
    f.ds.lagR = old ? old.lagR : NaN;
    f.ds.channels.forEach(function (c) { if (!f.ds.pre[c.name]) f.ds.pre[c.name] = Object.assign({}, Meas.PRE_DEFAULT); });
  }
  function status(h) { $('data-status').innerHTML = h; }
  function afterLoad() {
    status(state.files.length ? '<div class="ok">파일 ' + state.files.length + '개를 읽었습니다. 아래 카드에서 시간 열·시작 시각을 확인하세요.</div>' : '');
    renderFiles();
    if (!state.files.length) { ['s-sync', 's-pre', 's-result'].forEach(function (id) { $(id).hidden = true; }); return; }
    ['s-sync', 's-pre', 's-result'].forEach(function (id) { $(id).hidden = false; });
    fillSync();
    autoLagAll();
    renderPre();
    run();
  }

  /* ---------- 파일 카드 ---------- */
  var SRC = { column: '파일의 시간 열', meta: '파일 머리말', user: '직접 입력', tod: '시각만(날짜 없음)', none: '없음' };
  var KIND = { abs: '날짜+시각', tod: '시각만', rel: '경과 시간', gen: '샘플링 주기로 만듦' };
  function renderFiles() {
    $('files').innerHTML = state.files.map(function (f, i) {
      var d = f.ds, opts = '<option value="-1"' + (d.timeCol === -1 ? ' selected' : '') + '>없음(샘플링 주기로)</option>' +
        d.headers.map(function (h, k) { return '<option value="' + k + '"' + (k === d.timeCol ? ' selected' : '') + '>' + esc(h) + '</option>'; }).join('');
      var units = ['auto', 's', 'ms', 'us', 'min'].map(function (u) { return '<option' + ((f.opt.timeUnit || 'auto') === u ? ' selected' : '') + '>' + u + '</option>'; }).join('');
      return '<div class="fcard" data-i="' + i + '">' +
        '<div class="fhead"><b>' + esc(f.name) + '</b><button class="x" data-del="' + i + '">빼기</button></div>' +
        '<div class="stats">' + stat('샘플', d.n.toLocaleString()) + stat('샘플링', isFinite(d.fs) ? d.fs + ' Hz' : '—') + stat('길이', R(d.duration, 3) + ' 초') + stat('시간 형식', KIND[d.timeKind]) + '</div>' +
        '<p class="sub" style="margin:10px 0 4px">시작 시각 <b>' + (d.start != null ? esc(d.startSource === 'tod' ? Meas.fmtDateTime(d.start).slice(11) : Meas.fmtDateTime(d.start)) : '없음') + '</b> <span class="src src-' + d.startSource + '">' + SRC[d.startSource] + '</span></p>' +
        '<div class="form">' +
        '<label>시간 열 <select data-k="timeCol">' + opts + '</select></label>' +
        '<label>시간 단위 <select data-k="timeUnit">' + units + '</select></label>' +
        '<label' + (d.timeCol === -1 ? '' : ' hidden') + '>샘플링(Hz) <input type="number" data-k="fs" value="' + esc(f.opt.fs || (d.meta.fs || '')) + '"></label>' +
        '<label class="wide2">시작 시각 직접 넣기 <input type="text" data-k="start" value="' + esc(f.opt.start || '') + '" placeholder="예: 2026-10-15 10:20:00.000"></label>' +
        '</div>' +
        '<div class="chs">' + d.channels.map(function (c) {
          return '<label class="chk"><input type="checkbox" data-use="' + esc(c.name) + '"' + (d.use[c.name] === false ? '' : ' checked') + '> ' + esc(c.name) + (c.unit ? ' <small>' + esc(c.unit) + '</small>' : '') + '</label>';
        }).join('') + '</div>' +
        (d.issues.length ? '<div class="warn"><b>확인할 것 ' + d.issues.length + '건</b><ul>' + d.issues.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>' : '') +
        '</div>';
    }).join('');
  }
  function stat(k, v) { return '<div class="stat"><b>' + v + '</b>' + k + '</div>'; }
  $('files').addEventListener('change', function (e) {
    var card = e.target.closest('.fcard'); if (!card) return;
    var f = state.files[+card.dataset.i], k = e.target.dataset.k;
    if (e.target.dataset.use) { f.ds.use[e.target.dataset.use] = e.target.checked; renderPre(); run(); return; }
    if (!k) return;
    var v = e.target.value;
    if (k === 'timeCol') f.opt.timeCol = +v;
    else if (k === 'fs') f.opt.fs = +v || undefined;
    else f.opt[k] = v;
    reread(f); setTimeout(function () { renderFiles(); fillSync(); renderPre(); run(); }, 0);
  });
  $('files').addEventListener('click', function (e) {
    var d = e.target.dataset.del; if (d == null) return;
    state.files.splice(+d, 1); afterLoad();
  });

  /* ---------- 동기화 설정 ---------- */
  function ds() { return state.files.map(function (f) { return f.ds; }); }
  function refIdx() { return Math.min(+$('ref').value || 0, state.files.length - 1); }
  function fillSync() {
    var r = refIdx();
    $('ref').innerHTML = state.files.map(function (f, i) { return '<option value="' + i + '"' + (i === r ? ' selected' : '') + '>' + esc(f.name) + '</option>'; }).join('');
    var rf = state.files[r], keep = $('ref-ch').value;
    $('ref-ch').innerHTML = rf.ds.channels.map(function (c) { return '<option' + (c.name === keep ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('');
    var minDt = Math.min.apply(null, state.files.map(function (f) { return f.ds.dt; }).filter(isFinite));
    if (!$('dt').value || $('dt').dataset.auto === '1') { $('dt').value = isFinite(minDt) ? R(minDt, 6) : ''; $('dt').dataset.auto = '1'; }
    renderLagRows();
  }
  function renderLagRows() {
    var r = refIdx();
    $('lag-rows').innerHTML = state.files.map(function (f, i) {
      if (i === r) return '';
      var d = f.ds, info = state.lagInfo[i] || {};
      var chs = d.channels.map(function (c) { return '<option' + (c.name === f.tgtCh ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('');
      return '<div class="lagrow" data-i="' + i + '"><b>' + esc(f.name) + '</b>' +
        '<label>대상 신호 <select data-k="tgtCh">' + chs + '</select></label>' +
        '<label>방식 <select data-k="mode"><option value="env"' + (f.mode !== 'raw' ? ' selected' : '') + '>크기 포락선(물리량이 다를 때)</option><option value="raw"' + (f.mode === 'raw' ? ' selected' : '') + '>원신호(같은 신호일 때)</option></select></label>' +
        '<label>최대 지연(초) <input type="number" data-k="maxLag" value="' + (f.maxLag || 2) + '" step="0.5" min="0.1" style="width:80px"></label>' +
        '<button class="btn" data-act="est">지연 자동 추정</button>' +
        '<label>지연(초) <input type="number" data-k="lag" value="' + R(d.lag || 0, 6) + '" step="0.001" style="width:110px"></label>' +
        '<span class="laginfo">' + (d.lagSource === '교차상관' ? '<span class="calc-i">추정</span> 교차상관 r=' + d.lagR : d.lagSource === '직접 입력' ? '직접 입력' : '보정 없음') +
        (info.warn ? ' <span class="wtxt">' + esc(info.warn) + '</span>' : '') + (info.error ? ' <span class="wtxt">' + esc(info.error) + '</span>' : '') + '</span></div>';
    }).join('') || '<p class="sub">파일이 하나라 맞출 상대가 없습니다. 전처리·내보내기·3D 그래프는 그대로 쓸 수 있습니다.</p>';
  }
  function estimate(i) {
    var f = state.files[i], r = refIdx();
    if (!f.tgtCh) f.tgtCh = f.ds.channels[0] && f.ds.channels[0].name;
    var e = Meas.estimateFor(ds(), r, $('ref-ch').value, i, f.tgtCh, { maxLag: f.maxLag || 2, mode: f.mode || 'env' });
    state.lagInfo[i] = e;
    if (!e.error) { f.ds.lag = e.lag; f.ds.lagSource = '교차상관'; f.ds.lagR = e.r; }
  }
  function autoLagAll() { state.files.forEach(function (f, i) { if (i !== refIdx() && f.ds.channels.length && f.ds.lagSource !== '직접 입력') estimate(i); }); renderLagRows(); }
  $('lag-rows').addEventListener('change', function (e) {
    var row = e.target.closest('.lagrow'); if (!row) return;
    var i = +row.dataset.i, f = state.files[i], k = e.target.dataset.k;
    if (k === 'lag') { f.ds.lag = +e.target.value || 0; f.ds.lagSource = '직접 입력'; f.ds.lagR = NaN; state.lagInfo[i] = {}; }
    else if (k === 'maxLag') f.maxLag = +e.target.value || 2;
    else f[k] = e.target.value;
    // 바꾼 칸을 지우고 다시 그리면 이어지는 blur·change 가 사라진 칸에서 터진다 — 이벤트가 끝난 뒤 그린다
    setTimeout(function () { renderLagRows(); run(); }, 0);
  });
  $('lag-rows').addEventListener('click', function (e) {
    if (e.target.dataset.act !== 'est') return;
    estimate(+e.target.closest('.lagrow').dataset.i); renderLagRows(); run();
  });
  $('ref').addEventListener('change', function () {
    state.files.forEach(function (f) { f.ds.lag = 0; f.ds.lagSource = ''; f.tgtCh = null; }); state.lagInfo = {};
    $('ref-ch').value = ''; fillSync(); autoLagAll(); run();
  });
  $('ref-ch').addEventListener('change', function () { autoLagAll(); run(); });
  $('dt').addEventListener('change', function () { $('dt').dataset.auto = '0'; run(); });
  ['span', 'cut-from', 'cut-to'].forEach(function (id) { $(id).addEventListener('change', run); });

  /* ---------- 전처리 표 ---------- */
  var PRE_COLS = [['scale', '배율', 0.1], ['offset', '오프셋', 0.1], ['zeroSec', '영점(앞 N초)', 0.5], ['ma', '이동평균(점)', 1], ['lpHz', '저역통과(Hz)', 1], ['outK', '이상치 기준(배)', 1]];
  function renderPre() {
    var h = '<thead><tr><th>파일</th><th>채널</th>' + PRE_COLS.map(function (c) { return '<th>' + c[1] + '</th>'; }).join('') + '<th>이상치 처리</th></tr></thead><tbody>';
    state.files.forEach(function (f, i) {
      f.ds.channels.forEach(function (c) {
        if (f.ds.use[c.name] === false) return;
        var p = f.ds.pre[c.name];
        h += '<tr data-i="' + i + '" data-ch="' + esc(c.name) + '"><td>' + esc(f.name) + '</td><td>' + esc(c.name) + (c.unit ? ' <small>' + esc(c.unit) + '</small>' : '') + '</td>' +
          PRE_COLS.map(function (pc) { return '<td><input type="number" data-k="' + pc[0] + '" value="' + p[pc[0]] + '" step="' + pc[2] + '" style="width:84px"></td>'; }).join('') +
          '<td><select data-k="outMode"><option value="mark"' + (p.outMode !== 'replace' ? ' selected' : '') + '>표시만</option><option value="replace"' + (p.outMode === 'replace' ? ' selected' : '') + '>보간으로 바꾸기</option></select></td></tr>';
      });
    });
    $('pre-table').innerHTML = h + '</tbody>';
  }
  $('pre-table').addEventListener('change', function (e) {
    var tr = e.target.closest('tr'); if (!tr || !e.target.dataset.k) return;
    var p = state.files[+tr.dataset.i].ds.pre[tr.dataset.ch], k = e.target.dataset.k;
    p[k] = k === 'outMode' ? e.target.value : (e.target.value === '' ? Meas.PRE_DEFAULT[k] : +e.target.value);
    run();
  });

  /* ---------- 실행 · 결과 ---------- */
  function num(id) { var v = $(id).value; return v === '' ? null : +v; }
  function run() {
    if (!state.files.length) return;
    state.res = Meas.sync(ds(), { ref: refIdx(), dt: num('dt') || undefined, span: $('span').value, from: num('cut-from'), to: num('cut-to') });
    var res = state.res;
    $('sync-status').innerHTML = (res.issues.length ? '<div class="warn"><ul>' + res.issues.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>' : '') +
      (res.t.length ? '<div class="stats">' + stat('공통 시간축', R(res.from, 3) + ' ~ ' + R(res.to, 3) + ' 초') + stat('간격', res.dt + ' 초') + stat('점', res.t.length.toLocaleString()) + stat('채널', res.cols.length) + '</div>' : '');
    renderOffsets(); renderLagChart(); renderToggle(); renderTS(); renderStats();
    $('summary').textContent = Meas.summaryText(res);
    if ($('src3').value === 'sync') fill3Axes();
  }
  function renderOffsets() {
    var res = state.res; if (!res.offsets.length) { $('offsets').innerHTML = ''; return; }
    $('offsets').innerHTML = '<div class="tablewrap" style="margin-top:12px"><table><thead><tr><th>파일</th><th>시작 시각</th><th>근거</th><th>시작 차이(초)</th><th>지연(초)</th><th>지연 근거</th><th>최종 이동(초)</th></tr></thead><tbody>' +
      res.offsets.map(function (o) {
        return '<tr><td>' + esc(o.name) + '</td><td class="mono">' + esc(o.start != null ? Meas.fmtDateTime(o.start) : '—') + '</td><td>' + SRC[o.startSource] + '</td><td class="num">' + o.startOffset +
          '</td><td class="num">' + o.lag + (o.lagSource === '교차상관' ? '<span class="calc">추정</span>' : '') + '</td><td>' + esc(o.lagSource + (isFinite(o.lagR) ? ' r=' + o.lagR : '')) + '</td><td class="num">' + o.shift + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  // 지연 보정 전후: 기준 신호의 가장 큰 봉우리 둘레 4초를 정규화해 겹쳐 본다
  function renderLagChart() {
    var r = refIdx(), others = state.files.map(function (f, i) { return i; }).filter(function (i) { return i !== r && state.files[i].ds.channels.length; });
    if (!others.length) { $('lagchart').innerHTML = '<p class="sub">맞출 상대 파일이 없습니다.</p>'; return; }
    var i = others[0], f = state.files[i], D = ds(), so = Meas.startOffsets(D, r).offsets;
    var rc = D[r].channels.filter(function (c) { return c.name === $('ref-ch').value; })[0], tc = f.ds.channels.filter(function (c) { return c.name === (f.tgtCh || f.ds.channels[0].name); })[0];
    if (!rc || !tc) { $('lagchart').innerHTML = ''; return; }
    var yr = Meas.despike(Meas.preprocess(D[r].t, rc.y, D[r].pre[rc.name]).y), yt = Meas.despike(Meas.preprocess(f.ds.t, tc.y, f.ds.pre[tc.name]).y);
    var envR = Meas.envelope(yr, D[r].dt), st = Meas.stats(envR), tPk = D[r].t[st.iMax] + so[r];
    var lo = tPk - 1.2, hi = tPk + 2.8, g = Meas.makeGrid(lo, hi, Math.max(0.002, Math.min(D[r].dt, f.ds.dt)));
    var a = Meas.resample(D[r].t.map(function (x) { return x + so[r]; }), yr, g);
    var b0 = Meas.resample(f.ds.t.map(function (x) { return x + so[i]; }), yt, g);
    var b1 = Meas.resample(f.ds.t.map(function (x) { return x + so[i] - (f.ds.lag || 0); }), yt, g);
    $('lagchart').innerHTML = svgChart(g, [
      { name: '기준 ' + rc.name, y: a, color: COLORS[0] },
      { name: tc.name + ' (시작 시각만 맞춤)', y: b0, color: '#9aa9b8', dash: true },
      { name: tc.name + ' (지연 ' + R(f.ds.lag || 0, 4) + '초 보정)', y: b1, color: COLORS[1] }], { norm: true, h: 260 });
  }
  function renderToggle() {
    $('ch-toggle').innerHTML = state.res.cols.map(function (c, k) {
      var key = Meas.colLabel(c);
      return '<label class="chk"><input type="checkbox" data-key="' + esc(key) + '"' + (state.hide[key] ? '' : ' checked') + '> <i style="background:' + COLORS[k % COLORS.length] + '"></i>' + esc(c.name) + ' <small>' + esc(c.file) + '</small></label>';
    }).join('');
  }
  $('ch-toggle').addEventListener('change', function (e) { if (e.target.dataset.key) { state.hide[e.target.dataset.key] = !e.target.checked; renderTS(); } });
  ['norm', 'v-from', 'v-to'].forEach(function (id) { $(id).addEventListener('change', renderTS); });
  function renderTS() {
    var res = state.res; if (!res || !res.t.length) { $('ts').innerHTML = ''; return; }
    var a = num('v-from'), b = num('v-to'), i0 = 0, i1 = res.t.length - 1;
    if (a != null) while (i0 < i1 && res.t[i0] < a) i0++;
    if (b != null) while (i1 > i0 && res.t[i1] > b) i1--;
    var t = res.t.slice(i0, i1 + 1), lines = [];
    res.cols.forEach(function (c, k) {
      if (state.hide[Meas.colLabel(c)]) return;
      var y = c.values.slice(i0, i1 + 1), d = Meas.decimate(t, y, 900);
      var marks = c.outliers.filter(function (o) { return o.t >= t[0] && o.t <= t[t.length - 1]; }).map(function (o) {
        var j = Math.max(0, Math.min(res.t.length - 1, Math.round((o.t - res.t[0]) / res.dt))); return { t: o.t, v: c.values[j] };
      });
      // 높이 범위는 이상치를 뺀 통계로 — 센서 튐 한 점에 나머지가 납작해지지 않게(넘치는 점은 가장자리에 붙는다)
      lines.push({ name: c.name + (c.unit ? ' (' + c.unit + ')' : ''), t: d.t, y: d.y, color: COLORS[k % COLORS.length], marks: marks, range: [c.stats.min, c.stats.max] });
    });
    var units = res.cols.map(function (c) { return c.unit; }).filter(function (u, i, s) { return s.indexOf(u) === i; });
    $('ts').innerHTML = svgChart(t, lines, { norm: $('norm').checked, h: 380, warnUnits: !$('norm').checked && units.length > 1 });
  }
  // 겹친 시계열 SVG. norm 이면 채널마다 최소~최대를 같은 높이로 펼친다.
  function svgChart(t, lines, o) {
    var W = 1000, H = o.h || 360, L = 60, Rm = 14, T = 14, B = 34, pw = W - L - Rm, ph = H - T - B;
    if (!t.length) return '';
    var t0 = t[0], t1 = t[t.length - 1] || t0 + 1, ranges = lines.map(function (l) { if (l.range && isFinite(l.range[0])) return l.range; var s = Meas.stats(l.y); return [s.min, s.max]; });
    var gmin = Math.min.apply(null, ranges.map(function (r) { return r[0]; }).filter(isFinite)), gmax = Math.max.apply(null, ranges.map(function (r) { return r[1]; }).filter(isFinite));
    if (!isFinite(gmin)) { gmin = 0; gmax = 1; } if (gmax === gmin) gmax = gmin + 1;
    var X = function (v) { return L + (v - t0) / ((t1 - t0) || 1) * pw; };
    var Y = function (v, k) {
      var lo = o.norm ? ranges[k][0] : gmin, hi = o.norm ? ranges[k][1] : gmax; if (!(hi > lo)) hi = lo + 1;
      return Math.max(T, Math.min(T + ph, T + ph - (v - lo) / (hi - lo) * ph));
    };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    Meas.niceTicks(t0, t1, 8).forEach(function (v) { var x = X(v); s += '<line class="grid" x1="' + x + '" y1="' + T + '" x2="' + x + '" y2="' + (T + ph) + '"/><text class="ax" x="' + x + '" y="' + (H - 12) + '" text-anchor="middle">' + v + '</text>'; });
    if (o.norm) [0, 0.5, 1].forEach(function (f) { var y = T + ph - f * ph; s += '<line class="grid" x1="' + L + '" y1="' + y + '" x2="' + (L + pw) + '" y2="' + y + '"/><text class="ax" x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + (f === 0 ? '최소' : f === 1 ? '최대' : '') + '</text>'; });
    else Meas.niceTicks(gmin, gmax, 6).forEach(function (v) { var y = T + ph - (v - gmin) / (gmax - gmin) * ph; s += '<line class="grid" x1="' + L + '" y1="' + y + '" x2="' + (L + pw) + '" y2="' + y + '"/><text class="ax" x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + v + '</text>'; });
    s += '<text class="ax" x="' + (L + pw) + '" y="' + (H - 1) + '" text-anchor="end">시간(초)</text>';
    lines.forEach(function (l, k) {
      var lt = l.t || t, pts = [], segs = [];
      for (var i = 0; i < l.y.length; i++) {
        if (!isFinite(l.y[i])) { if (pts.length) segs.push(pts); pts = []; continue; }
        pts.push(R(X(lt[i]), 1) + ',' + R(Y(l.y[i], k), 1));
      }
      if (pts.length) segs.push(pts);
      segs.forEach(function (p) { s += '<polyline points="' + p.join(' ') + '" style="stroke:' + l.color + ';stroke-width:1.6' + (l.dash ? ';stroke-dasharray:5 4' : '') + '"/>'; });
      (l.marks || []).forEach(function (m) { if (isFinite(m.v)) s += '<circle class="omark" cx="' + R(X(m.t), 1) + '" cy="' + R(Y(m.v, k), 1) + '" r="5"><title>이상치 ' + R(m.t, 3) + '초</title></circle>'; });
    });
    s += '</svg><div class="legend">' + lines.map(function (l) { return '<span><i style="background:' + l.color + '"></i> ' + esc(l.name) + '</span>'; }).join('') + '</div>';
    if (o.warnUnits) s += '<div class="note">단위가 다른 채널을 한 축에 그렸습니다. 모양을 비교하려면 「정규화」를 켜세요.</div>';
    return s;
  }
  function renderStats() {
    var res = state.res;
    $('stat-table').innerHTML = '<thead><tr><th>채널</th><th>파일</th><th>단위</th><th>값</th><th>최대</th><th>최대 시각(초)</th><th>최소</th><th>평균</th><th>RMS</th><th>범위(p-p)</th><th>이상치(통계 제외)</th><th>전처리</th></tr></thead><tbody>' +
      res.cols.map(function (c) {
        var s = c.stats, f = function (v) { return isFinite(v) ? R(v, 4) : '—'; };
        return '<tr' + (c.outliers.length ? ' class="flag"' : '') + '><td>' + esc(c.name) + '</td><td>' + esc(c.file) + '</td><td>' + esc(c.unit) + '</td><td>' + (c.interp ? '<span class="calc">보간값</span>' : '원래 점') +
          '</td><td class="num">' + f(s.max) + '</td><td class="num">' + (s.iMax >= 0 ? R(res.t[s.iMax], 3) : '—') + '</td><td class="num">' + f(s.min) + '</td><td class="num">' + f(s.mean) + '</td><td class="num">' + f(s.rms) + '</td><td class="num">' + f(s.p2p) +
          '</td><td class="num">' + c.outliers.length + '</td><td>' + esc(c.pre) + '</td></tr>';
      }).join('') + '</tbody>';
  }

  /* ---------- 내보내기 ---------- */
  function stamp() { return new Date().toISOString().slice(0, 10); }
  function exportXlsx() {
    var res = state.res; if (!res || !res.t.length) return;
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(Meas.exportRows(res)), '동기화데이터');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['파일', '시작 시각', '시작 시각 근거', '시작 차이(초)', '지연(초)', '지연 근거', '상관 r', '최종 이동(초)']].concat(res.offsets.map(function (o) {
      return [o.name, o.start != null ? Meas.fmtDateTime(o.start) : '', SRC[o.startSource], o.startOffset, o.lag, o.lagSource + (o.lagSource === '교차상관' ? '(추정값)' : ''), isFinite(o.lagR) ? o.lagR : '', o.shift];
    })).concat([[], ['공통 시간축', R(res.from, 6) + ' ~ ' + R(res.to, 6) + ' 초'], ['간격(초)', res.dt], ['점 수', res.t.length], ['보간', '공통 시간축에 없는 시각의 값은 앞뒤 원래 샘플을 선형 보간한 계산값입니다.']])), '처리이력');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['채널', '파일', '단위', '값 구분', '최대', '최대 시각(초)', '최소', '평균', 'RMS', '범위', '이상치 수(통계에서 뺌)', '전처리', '이상치 포함 최대', '이상치 포함 최소']].concat(res.cols.map(function (c) {
      var s = c.stats; return [c.name, c.file, c.unit, c.interp ? '보간값(계산)' : '원래 점', R(s.max, 6), s.iMax >= 0 ? res.t[s.iMax] : '', R(s.min, 6), R(s.mean, 6), R(s.rms, 6), R(s.p2p, 6), c.outliers.length, c.pre, R(c.statsAll.max, 6), R(c.statsAll.min, 6)];
    }))), '채널통계');
    var out = [['파일', '채널', '공통축 시각(초)', '원래 값']];
    res.cols.forEach(function (c) { c.outliers.forEach(function (o) { out.push([c.file, c.name, o.t, o.v]); }); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(out), '이상치');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(Meas.summaryText(res).split('\n').map(function (l) { return [l]; })), '요약');
    XLSX.writeFile(wb, '계측_동기화_' + stamp() + '.xlsx');
  }
  function download(name, text, type) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/csv;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  $('btn-xlsx').addEventListener('click', exportXlsx);
  $('btn-csv').addEventListener('click', function () { if (state.res && state.res.t.length) download('계측_동기화_' + stamp() + '.csv', Meas.toCSV(Meas.exportRows(state.res))); });

  /* ---------- AI(선택) ---------- */
  $('ai-key').value = localStorage.getItem('b04-ai-key') || '';
  $('ai-prov').value = localStorage.getItem('b04-ai-prov') || 'openai';
  $('ai-key').addEventListener('change', function () { localStorage.setItem('b04-ai-key', $('ai-key').value.trim()); });
  $('ai-prov').addEventListener('change', function () { localStorage.setItem('b04-ai-prov', $('ai-prov').value); });
  $('ai-run').addEventListener('click', function () {
    var key = $('ai-key').value.trim(), text = $('summary').textContent, prov = $('ai-prov').value;
    if (!key) { $('ai-out').innerHTML = '<div class="warn">API 키를 넣어 주세요. 키 없이도 위 요약 문장은 그대로 쓸 수 있습니다.</div>'; return; }
    if (!text) return;
    if (!confirm('요약 문장(파일 이름·채널 이름·통계 숫자 포함)을 외부 AI(' + (prov === 'openai' ? 'OpenAI' : 'Anthropic') + ')로 보냅니다. 사내 보안 기준에 맞는지 확인하셨나요?')) return;
    var prompt = '다음은 계측 데이터 동기화·전처리 결과 요약입니다. 시험 보고서의 「계측 데이터 처리」 절에 넣을 수 있게 간결한 한국어 문단으로 다듬어 주세요. 숫자는 바꾸지 말고, 추정값(교차상관 지연·보간)은 추정이라고 밝혀 주세요.\n\n' + text;
    $('ai-out').innerHTML = '<p class="sub">AI 에 요청 중입니다…</p>';
    var req = prov === 'openai'
      ? fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] }) })
      : fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] }) });
    req.then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error((j.error && j.error.message) || r.status); return j; }); })
      .then(function (j) {
        var out = prov === 'openai' ? j.choices[0].message.content : j.content.map(function (c) { return c.text || ''; }).join('');
        $('ai-out').innerHTML = '<div class="aibox"><b>AI 초안 — 검토 필요</b><pre class="summary">' + esc(out) + '</pre></div>';
      })
      .catch(function (err) { $('ai-out').innerHTML = '<div class="warn">AI 요청이 실패했습니다: ' + esc(err.message) + '</div>'; });
  });

  /* ---------- 3D ---------- */
  var view = { yaw: -0.65, pitch: -0.55, zoom: 1 }, src3 = { cols: [] };
  function load3(cols) { src3.cols = cols; fill3Axes(true); }
  function fill3Axes(fresh) {
    if ($('src3').value === 'sync') {
      var res = state.res;
      src3.cols = res && res.t.length ? [{ name: '시간(s)', values: res.t }].concat(res.cols.map(function (c) { return { name: c.name + (c.unit ? '(' + c.unit + ')' : ''), values: c.values }; })) : [];
    }
    var names = src3.cols.map(function (c) { return c.name; });
    ['ax-x', 'ax-y', 'ax-z'].forEach(function (id, k) {
      var keep = fresh ? '' : $(id).value, sel = names.indexOf(keep) >= 0 ? keep : names[Math.min(k, names.length - 1)];
      $(id).innerHTML = names.map(function (n) { return '<option' + (n === sel ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('');
    });
    draw3();
  }
  function colOf(id) { var n = $(id).value; return src3.cols.filter(function (c) { return c.name === n; })[0]; }
  function current3() {
    var cx = colOf('ax-x'), cy = colOf('ax-y'), cz = colOf('ax-z');
    if (!cx || !cy || !cz) return null;
    var x = cx.values, y = cy.values, z = cz.values, step = Math.max(1, Math.ceil(x.length / 4000));
    if (step > 1) { var f = function (a) { return a.filter(function (_, i) { return i % step === 0; }); }; x = f(x); y = f(y); z = f(z); }
    var n = Math.max(5, Math.min(80, +$('grid3').value || 30));
    var S = Meas.surface(x, y, z, { nx: n, ny: n, force: $('force3').checked });
    if (S) { S.names = [cx.name, cy.name, cz.name]; S.step = step; }
    return S;
  }
  function draw3() {
    var cv = $('c3d'), S = current3(), dpr = window.devicePixelRatio || 1;
    var W = cv.clientWidth || 960, H = Math.round(W * 0.62);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.font = '12px "Apple SD Gothic Neo","Malgun Gothic",sans-serif';
    if (!S) { g.fillStyle = '#5b6b7b'; g.fillText('X·Y·Z 로 쓸 숫자 열이 3개 이상 필요합니다.', 20, 30); $('info3').innerHTML = ''; return; }
    var mode = $('mode3').value, cmap = $('cmap').value, sc = Math.min(W * 0.8, H) * 0.33 * view.zoom, ox = W * 0.45, oy = H * 0.5;
    var nx = function (v) { return ((v - S.xmin) / ((S.xmax - S.xmin) || 1)) * 2 - 1; }, ny = function (v) { return ((v - S.ymin) / ((S.ymax - S.ymin) || 1)) * 2 - 1; };
    var nz = function (v) { return (((v - S.zmin) / ((S.zmax - S.zmin) || 1)) * 2 - 1) * 0.75; }, cz = function (v) { return (v - S.zmin) / ((S.zmax - S.zmin) || 1); };
    var P = function (x, y, z) { var p = Meas.project([x, y, z], view); return { x: ox + p.x * sc, y: oy - p.y * sc, d: p.depth }; };
    // 바닥 격자와 축
    g.strokeStyle = '#e1e7ed'; g.lineWidth = 1;
    for (var k = -1; k <= 1.0001; k += 0.5) { line(g, P(k, -1, -0.75), P(k, 1, -0.75)); line(g, P(-1, k, -0.75), P(1, k, -0.75)); }
    g.strokeStyle = '#5b6b7b';
    line(g, P(-1, -1, -0.75), P(1, -1, -0.75)); line(g, P(-1, -1, -0.75), P(-1, 1, -0.75)); line(g, P(-1, -1, -0.75), P(-1, -1, 0.75));
    g.fillStyle = '#5b6b7b';
    Meas.niceTicks(S.xmin, S.xmax, 4).forEach(function (v) { var p = P(nx(v), -1.12, -0.75); g.fillText(fmt(v), p.x - 10, p.y + 12); });
    Meas.niceTicks(S.ymin, S.ymax, 4).forEach(function (v) { var p = P(1.1, ny(v), -0.75); g.fillText(fmt(v), p.x + 4, p.y + 4); });
    Meas.niceTicks(S.zmin, S.zmax, 4).forEach(function (v) { var p = P(-1, -1, nz(v)); g.fillText(fmt(v), p.x - 40, p.y + 4); });
    g.fillStyle = '#152232'; g.font = 'bold 12.5px "Apple SD Gothic Neo","Malgun Gothic",sans-serif';
    var lx = P(0, -1.32, -0.75), ly = P(1.32, 0, -0.75), lz = P(-1, -1, 0.92);
    g.fillText('X ' + S.names[0], lx.x - 30, lx.y + 16); g.fillText('Y ' + S.names[1], ly.x + 6, ly.y + 14); g.fillText('Z ' + S.names[2], lz.x - 20, lz.y);
    // 곡면: 먼 칸부터 칠한다(화가 알고리즘)
    var items = [];
    if (mode !== 'points') {
      for (var j = 0; j < S.ys.length - 1; j++) for (var i = 0; i < S.xs.length - 1; i++) {
        var zs = [S.z[j][i], S.z[j][i + 1], S.z[j + 1][i + 1], S.z[j + 1][i]];
        if (!zs.every(isFinite)) continue;
        var q = [P(nx(S.xs[i]), ny(S.ys[j]), nz(zs[0])), P(nx(S.xs[i + 1]), ny(S.ys[j]), nz(zs[1])), P(nx(S.xs[i + 1]), ny(S.ys[j + 1]), nz(zs[2])), P(nx(S.xs[i]), ny(S.ys[j + 1]), nz(zs[3]))];
        items.push({ d: (q[0].d + q[1].d + q[2].d + q[3].d) / 4, q: q, c: Meas.colormap(cmap, cz((zs[0] + zs[1] + zs[2] + zs[3]) / 4)) });
      }
    }
    if (mode !== 'surface') {
      var pt = S.points;
      for (var m = 0; m < pt.x.length; m++) { var p = P(nx(pt.x[m]), ny(pt.y[m]), nz(pt.z[m])); items.push({ d: p.d - 0.001, p: p, c: Meas.colormap(cmap, cz(pt.z[m])) }); }
    }
    items.sort(function (a, b) { return b.d - a.d; });
    var dense = S.xs.length > 40;
    items.forEach(function (it) {
      var col = 'rgb(' + it.c.join(',') + ')';
      if (it.q) {
        g.beginPath(); g.moveTo(it.q[0].x, it.q[0].y); for (var r = 1; r < 4; r++) g.lineTo(it.q[r].x, it.q[r].y); g.closePath();
        g.fillStyle = col; g.fill(); g.strokeStyle = dense ? col : 'rgba(21,34,50,.28)'; g.lineWidth = 0.6; g.stroke();
      } else {
        g.beginPath(); g.arc(it.p.x, it.p.y, mode === 'points' ? 3.2 : 3.6, 0, 2 * Math.PI); g.fillStyle = col; g.fill();
        g.strokeStyle = '#152232'; g.lineWidth = 0.8; g.stroke();
      }
    });
    // 색 막대 — PNG 에도 함께 들어간다
    var bx = W - 46, by = H * 0.18, bh = H * 0.6;
    for (var s = 0; s < 100; s++) { g.fillStyle = 'rgb(' + Meas.colormap(cmap, 1 - s / 99).join(',') + ')'; g.fillRect(bx, by + bh * s / 100, 16, bh / 100 + 1); }
    g.strokeStyle = '#5b6b7b'; g.strokeRect(bx, by, 16, bh); g.fillStyle = '#152232'; g.font = '11.5px "Apple SD Gothic Neo","Malgun Gothic",sans-serif';
    g.textAlign = 'right'; g.fillText(fmt(S.zmax), bx - 4, by + 9); g.fillText(fmt(S.zmin), bx - 4, by + bh); g.textAlign = 'left';
    g.fillStyle = '#152232'; g.font = 'bold 13px "Apple SD Gothic Neo","Malgun Gothic",sans-serif';
    g.fillText(S.names[2] + ' — ' + S.names[0] + ' × ' + S.names[1], 16, 22);
    g.font = '11.5px "Apple SD Gothic Neo","Malgun Gothic",sans-serif'; g.fillStyle = '#5b6b7b';
    g.fillText(S.kind === 'grid' ? '곡면 = 측정 격자 그대로' : '곡면 = IDW 보간(측정점 사이는 추정값)', 16, 40);
    $('info3').innerHTML = '<div class="stats">' + stat('측정점', S.points.x.length.toLocaleString() + (S.step > 1 ? ' (' + S.step + '점마다 1점)' : '')) +
      stat('곡면', S.kind === 'grid' ? '측정 격자 ' + S.xs.length + '×' + S.ys.length : '<span class="calc-i">추정</span> IDW ' + S.xs.length + '×' + S.ys.length) +
      stat('Z 범위', fmt(S.zmin) + ' ~ ' + fmt(S.zmax)) + '</div>';
  }
  function line(g, a, b) { g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
  function fmt(v) { var a = Math.abs(v); return a >= 1000 ? String(Math.round(v)) : a >= 10 ? String(R(v, 1)) : String(R(v, 3)); }
  var drag = null;
  $('c3d').addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch }; $('c3d').setPointerCapture(e.pointerId); });
  $('c3d').addEventListener('pointermove', function (e) {
    if (!drag) return;
    view.yaw = drag.yaw + (e.clientX - drag.x) * 0.01;
    view.pitch = Math.max(-1.55, Math.min(0.3, drag.pitch + (e.clientY - drag.y) * 0.01));
    draw3();
  });
  ['pointerup', 'pointercancel'].forEach(function (t) { $('c3d').addEventListener(t, function () { drag = null; }); });
  $('c3d').addEventListener('wheel', function (e) { e.preventDefault(); zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });
  function zoom(f) { view.zoom = Math.max(0.3, Math.min(5, view.zoom * f)); draw3(); }
  $('v-in').addEventListener('click', function () { zoom(1.2); });
  $('v-out').addEventListener('click', function () { zoom(1 / 1.2); });
  $('v-reset').addEventListener('click', function () { view = { yaw: -0.65, pitch: -0.55, zoom: 1 }; draw3(); });
  $('v-top').addEventListener('click', function () { view.yaw = 0; view.pitch = -1.55; draw3(); });
  $('btn-png').addEventListener('click', function () {
    var a = document.createElement('a'); a.href = $('c3d').toDataURL('image/png'); a.download = '3D그래프_' + stamp() + '.png'; document.body.appendChild(a); a.click(); a.remove();
  });
  ['ax-x', 'ax-y', 'ax-z', 'mode3', 'grid3', 'force3', 'cmap'].forEach(function (id) { $(id).addEventListener('change', draw3); });
  $('src3').addEventListener('change', function () {
    var v = $('src3').value; $('f3-wrap').hidden = v !== 'file';
    if (v === 'sample') load3(Meas.tableColumns(Meas.sample3D()));
    else if (v === 'sync') { $('mode3').value = 'points'; fill3Axes(true); }
    else { src3.cols = []; fill3Axes(true); }
  });
  $('f3d').addEventListener('change', function (e) {
    var f = e.target.files[0]; if (!f) return;
    var rd = new FileReader(), isX = /\.xlsx?$/i.test(f.name);
    rd.onload = function (ev) {
      var rows = isX ? (function () { var wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' }); return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' }); })() : Meas.parseCSV(ev.target.result);
      load3(Meas.tableColumns(rows));
    };
    if (isX) rd.readAsArrayBuffer(f); else rd.readAsText(f);
  });
  var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(draw3, 150); });

  /* ---------- 연결 ---------- */
  $('file').addEventListener('change', function (e) { if (e.target.files.length) readFiles(e.target.files); e.target.value = ''; });
  var drop = $('drop');
  ['dragover', 'dragenter'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function () { drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { e.preventDefault(); if (e.dataTransfer.files.length) readFiles(e.dataTransfer.files); });
  $('btn-sample').addEventListener('click', function () {
    state.files = []; state.lagInfo = {}; state.hide = {}; $('dt').value = ''; $('ref').innerHTML = '';
    Meas.sampleFiles().forEach(function (f) { addFile(f.name + ' (예제)', Meas.parseCSV(f.text)); });
    afterLoad();
  });
  $('btn-sample-dl').addEventListener('click', function () { Meas.sampleFiles().forEach(function (f, i) { setTimeout(function () { download(f.name, '﻿' + f.text); }, i * 400); }); });
  $('btn-reset').addEventListener('click', function () { state.files = []; state.res = null; state.lagInfo = {}; $('dt').value = ''; afterLoad(); });

  load3(Meas.tableColumns(Meas.sample3D()));
  window.__app = { state: state, view: view };       // 연기 테스트용
})();
