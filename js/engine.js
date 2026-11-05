/* 계측 데이터 처리 · 3D 그래프 — 계산 엔진
 *
 * 화면(app.js)은 판정하지 않는다. 파일 읽기·시간 해석·지연 추정·리샘플·전처리·3D 보간·투영은
 * 전부 여기서 계산하고 test/logic.test.js 로 고정한다. 브라우저와 node 양쪽에서 읽힌다.
 *
 * 시간은 전부 「초」로 다룬다.
 *   데이터셋 하나 = { name, start(절대 시각 ms 또는 null), t[](시작에서 지난 초), channels:[{name, unit, y[]}] }
 *   공통 시간축   = 기준 데이터셋의 시작을 0초로 둔 축.
 *   데이터셋 i 의 공통축 시각 = t + shift_i,  shift_i = (start_i - start_기준)/1000 - lag_i
 *   lag_i 는 「기준보다 몇 초 늦게 찍혔는가」 — 교차상관으로 추정하거나 직접 넣는다.
 */
(function (root) {
  'use strict';
  var DAY = 86400000;

  /* ---------- 숫자 ---------- */
  function toNum(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (v == null) return NaN;
    var s = String(v).trim();
    if (!s) return NaN;
    if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return NaN;
    return parseFloat(s);
  }
  function finite(a) { return a.filter(function (v) { return isFinite(v); }); }
  function median(a) {
    var b = finite(a).sort(function (x, y) { return x - y; });
    if (!b.length) return NaN;
    var m = b.length >> 1;
    return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
  }
  function round(v, n) { var k = Math.pow(10, n == null ? 6 : n); return Math.round(v * k) / k; }
  function stats(y) {
    var n = 0, s = 0, s2 = 0, mn = Infinity, mx = -Infinity, iMn = -1, iMx = -1;
    for (var i = 0; i < y.length; i++) {
      var v = y[i]; if (!isFinite(v)) continue;
      n++; s += v; s2 += v * v;
      if (v < mn) { mn = v; iMn = i; } if (v > mx) { mx = v; iMx = i; }
    }
    if (!n) return { n: 0, min: NaN, max: NaN, mean: NaN, rms: NaN, std: NaN, p2p: NaN, iMin: -1, iMax: -1 };
    var mean = s / n;
    return { n: n, min: mn, max: mx, mean: mean, rms: Math.sqrt(s2 / n), std: Math.sqrt(Math.max(0, s2 / n - mean * mean)), p2p: mx - mn, iMin: iMn, iMax: iMx };
  }

  /* ---------- CSV ---------- */
  // 구분자는 마지막 줄들(데이터 부분)에서 가장 일정하게 나오는 것을 고른다 — 머리말 줄에는 쉼표·쌍점이 섞여 있다.
  function detectDelimiter(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
    var tail = lines.slice(-30), best = ',', bestScore = 0;
    [',', ';', '\t', '|'].forEach(function (d) {
      var counts = tail.map(function (l) { return l.split(d).length - 1; });
      var c = counts[counts.length - 1] || 0;
      if (!c) return;
      var same = counts.filter(function (x) { return x === c; }).length;
      var score = same * 10 + c;
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  }
  function parseCSV(text, delim) {
    text = String(text).replace(/^﻿/, '');
    var d = delim || detectDelimiter(text), rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"' && cell === '') q = true;
      else if (c === d) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  /* ---------- 시간 ---------- */
  var RE_DT = /(\d{4})[-./](\d{1,2})[-./](\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}(?:[.,]\d+)?))?/;
  var RE_TOD = /^(\d{1,2}):(\d{2})(?::(\d{2}(?:[.,]\d+)?))?$/;
  // 날짜+시각 → ms. 시간대는 따지지 않는다(계측기 두 대가 같은 현장 시계라고 본다) — 전부 UTC 로 읽어 하루씩 밀리지 않게 한다.
  function parseDateTime(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) {
      if (isNaN(v) || v.getFullYear() < 1901) return null;
      return Date.UTC(v.getFullYear(), v.getMonth(), v.getDate(), v.getHours(), v.getMinutes(), v.getSeconds(), v.getMilliseconds());
    }
    if (typeof v === 'number') {
      if (!isFinite(v) || v < 20000 || v > 80000) return null;       // 엑셀 일련번호(날짜+소수 시각)
      return Math.round((v - 25569) * DAY);
    }
    var m = String(v).match(RE_DT);
    if (!m) return null;
    var sec = m[6] ? parseFloat(m[6].replace(',', '.')) : 0;
    var ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0) + Math.round(sec * 1000);
    var chk = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (chk.getUTCMonth() !== +m[2] - 1 || +m[4] > 23 || +m[5] > 59 || sec >= 61) return null;
    return ms;
  }
  // 시각만(14:03:05.250) → 그날 0시에서 지난 초. 엑셀의 시각 칸(0~1 소수)도 받는다.
  function parseTOD(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) {
      if (isNaN(v)) return null;
      return v.getHours() * 3600 + v.getMinutes() * 60 + v.getSeconds() + v.getMilliseconds() / 1000;
    }
    if (typeof v === 'number') return v >= 0 && v < 1 ? round(v * 86400, 4) : null;
    var m = String(v).trim().match(RE_TOD);
    if (!m) return null;
    var h = +m[1], mi = +m[2], s = m[3] ? parseFloat(m[3].replace(',', '.')) : 0;
    if (h > 23 || mi > 59 || s >= 61) return null;
    return round(h * 3600 + mi * 60 + s, 6);
  }
  function fmtDateTime(ms) {
    if (ms == null || !isFinite(ms)) return '';
    var d = new Date(ms);
    var p = function (n, k) { n = String(n); while (n.length < (k || 2)) n = '0' + n; return n; };
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' +
      p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + '.' + p(d.getUTCMilliseconds(), 3);
  }

  /* ---------- 표 → 데이터셋 ---------- */
  // 열 이름 뒤의 단위: 「응력(MPa)」 「Acc_Z [g]」 「t / s」
  function splitUnit(h) {
    var s = String(h == null ? '' : h).trim();
    var m = s.match(/^(.*?)\s*[([\[]\s*([^)\]]*)\s*[)\]]\s*$/) || s.match(/^(.*?)\s+\/\s*(\S+)$/);
    return m ? { name: m[1].trim() || s, unit: m[2].trim() } : { name: s, unit: '' };
  }
  // 시간 열로 보는 이름. 늘릴 때는 코드가 아니라 이 표를 늘린다.
  var TIME_NAMES = /^(time|t|sec|secs|seconds?|timestamp|date ?time|elapsed|시간|시각|경과시간|경과 시간|측정시각|일시|초)$/i;
  var TIME_UNITS = { s: 1, sec: 1, '초': 1, ms: 0.001, msec: 0.001, us: 1e-6, 'μs': 1e-6, min: 60, '분': 60 };
  function cellKind(v) {
    if (v == null || v === '') return 'empty';
    if (v instanceof Date) return 'date';
    if (typeof v === 'number') return isFinite(v) ? 'num' : 'text';
    var s = String(v).trim();
    if (!s) return 'empty';
    if (isFinite(toNum(s))) return 'num';
    if (RE_DT.test(s)) return 'date';
    if (RE_TOD.test(s)) return 'tod';
    return 'text';
  }
  function dataLike(row) {
    var n = 0, f = 0;
    (row || []).forEach(function (c) { var k = cellKind(c); if (k !== 'empty') { f++; if (k !== 'text') n++; } });
    return { filled: f, data: n };
  }
  function findHeader(rows) {
    for (var i = 0; i < Math.min(rows.length, 80); i++) {
      var r = rows[i] || [], a = dataLike(r);
      if (String(r[0] || '').trim().charAt(0) === '#') continue;
      if (a.filled >= 2 && a.data === a.filled) return { header: -1, first: i };        // 머리 줄 없이 바로 숫자
      var nx = dataLike(rows[i + 1]);
      if (a.filled >= 2 && a.data < a.filled / 2 && nx.filled >= 2 && nx.data >= nx.filled * 0.6) return { header: i, first: i + 1 };
    }
    return { header: -1, first: 0 };
  }
  // 머리말에서 시작 시각·샘플링 주기를 찾는다
  function readMeta(rows, upto) {
    var meta = { start: null, startTOD: null, fs: null, date: null, lines: [] };
    for (var i = 0; i < upto; i++) {
      var line = (rows[i] || []).map(function (c) { return c instanceof Date ? fmtDateTime(parseDateTime(c)) : String(c == null ? '' : c); }).join(' ').trim();
      if (!line) continue;
      meta.lines.push(line);
      var low = line.toLowerCase();
      if (/(start|시작|trigger|트리거|기록\s*시각|측정\s*일시)/i.test(low)) {
        var dt = parseDateTime(line);
        if (dt != null && meta.start == null) meta.start = dt;
        else if (meta.startTOD == null) {
          var m = line.match(/(\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?)\s*$/);
          if (m) meta.startTOD = parseTOD(m[1]);
        }
      }
      if (/(date|날짜|측정일)/i.test(low) && meta.date == null) {
        var md = line.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
        if (md) meta.date = Date.UTC(+md[1], +md[2] - 1, +md[3]);
      }
      var f = line.match(/(sample\s*rate|sampling|샘플링|주파수|rate)\D*?(\d+(?:\.\d+)?)\s*(k?hz)/i);
      if (f && meta.fs == null) meta.fs = parseFloat(f[2]) * (/k/i.test(f[3]) ? 1000 : 1);
      var p = line.match(/(interval|주기|간격|dt)\D*?(\d+(?:\.\d+)?)\s*(ms|s|초)\b/i);
      if (p && meta.fs == null) meta.fs = 1 / (parseFloat(p[2]) * (p[3] === 'ms' ? 0.001 : 1));
    }
    if (meta.start == null && meta.startTOD != null && meta.date != null) meta.start = meta.date + Math.round(meta.startTOD * 1000);
    return meta;
  }

  /* 표(행 배열)를 데이터셋으로 바꾼다.
   * opts.timeCol  : 시간 열 번호(-1 = 시간 열 없음 → 샘플링 주기로 만든다)
   * opts.timeUnit : 'auto' | 's' | 'ms' | 'us' | 'min'
   * opts.fs       : 시간 열이 없을 때 쓰는 샘플링 주파수(Hz)
   * opts.start    : 시작 시각을 직접 넣을 때 (문자열 또는 ms) — 파일 값보다 우선 */
  function readTable(rows, opts) {
    opts = opts || {};
    rows = (rows || []).map(function (r) { return Array.isArray(r) ? r : []; });
    var issues = [], hd = findHeader(rows), meta = readMeta(rows, hd.header >= 0 ? hd.header : hd.first);
    var body = rows.slice(hd.first).filter(function (r) { return dataLike(r).filled > 0; });
    var width = body.reduce(function (a, r) { return Math.max(a, r.length); }, 0);
    var headers = [];
    for (var c = 0; c < width; c++) {
      var h = hd.header >= 0 ? rows[hd.header][c] : '';
      headers.push(String(h == null || h === '' ? '열' + (c + 1) : h).trim());
    }
    // 시간 열 고르기
    var tc = opts.timeCol;
    if (tc == null) {
      tc = -1;
      for (var k = 0; k < width; k++) if (TIME_NAMES.test(splitUnit(headers[k]).name.replace(/_/g, ' ').trim())) { tc = k; break; }
      if (tc < 0 && body.length > 1) {
        var k0 = cellKind(body[0][0]);
        if (k0 === 'date' || k0 === 'tod') tc = 0;
        else if (k0 === 'num' && !meta.fs) {
          var inc = true;
          for (var j = 1; j < Math.min(body.length, 50); j++) if (!(toNum(body[j][0]) > toNum(body[j - 1][0]))) { inc = false; break; }
          if (inc) tc = 0;
        }
      }
    }
    // 시간 값 해석
    var kind = 'gen', t = [], start = null, startSource = 'none', keep = [];
    var unitName = tc >= 0 ? splitUnit(headers[tc]).unit.toLowerCase() : '';
    var unit = opts.timeUnit && opts.timeUnit !== 'auto' ? opts.timeUnit : (TIME_UNITS[unitName] != null ? unitName : 's');
    var mul = TIME_UNITS[unit] != null ? TIME_UNITS[unit] : 1;
    if (tc >= 0) {
      var first = null;
      for (var q = 0; q < body.length && first == null; q++) { var kk = cellKind(body[q][tc]); if (kk !== 'empty' && kk !== 'text') first = body[q][tc]; }
      var fk = cellKind(first);
      if (fk === 'date' || (fk === 'num' && toNum(first) > 20000 && /date|time|시각|일시|stamp/i.test(headers[tc]) && !unitName)) kind = 'abs';
      else if (fk === 'tod' || (first instanceof Date && first.getFullYear() < 1901)) kind = 'tod';
      else kind = 'rel';
      if (first instanceof Date && first.getFullYear() < 1901) kind = 'tod';
      var bad = 0, prevTod = null, wrap = 0;
      body.forEach(function (r, i) {
        var v = r[tc], s = null;
        if (kind === 'abs') { var ms = parseDateTime(v); if (ms != null) { if (start == null) start = ms; s = (ms - start) / 1000; } }
        else if (kind === 'tod') {
          var tod = parseTOD(v);
          if (tod != null) {
            if (prevTod != null && tod + wrap < prevTod - 43200) wrap += 86400;   // 자정을 넘겼다
            tod += wrap; prevTod = tod;
            if (start == null) start = tod; s = round(tod - start, 6);
          }
        } else { var x = toNum(v); if (isFinite(x)) s = x * mul; }
        if (s == null || !isFinite(s)) { bad++; return; }
        t.push(s); keep.push(i);
      });
      if (bad) issues.push('시간을 읽지 못한 줄 ' + bad + '개는 뺐습니다.');
      if (kind === 'abs') { startSource = 'column'; }
      else if (kind === 'tod') {
        var todStart = start; start = null;
        var day = meta.date != null ? meta.date : meta.start != null ? Math.floor(meta.start / DAY) * DAY : null;
        if (day != null) { start = day + Math.round(todStart * 1000); startSource = 'column'; }
        else { start = Math.round(todStart * 1000); startSource = 'tod'; }   // 날짜 없이 시각만 — 1970-01-01 의 그 시각으로 둔다
      } else {
        var t0 = t.length ? t[0] : 0;
        t = t.map(function (x) { return x - t0; });
        if (t0) issues.push('시간 열이 ' + round(t0, 4) + '초에서 시작해 0초로 옮겼습니다.');
      }
    } else {
      var fs = opts.fs || meta.fs;
      if (!fs) { fs = 1; issues.push('시간 열과 샘플링 주기를 찾지 못했습니다. 샘플링 주파수를 직접 넣어 주세요(지금은 1 Hz 로 봤습니다).'); }
      body.forEach(function (r, i) { keep.push(i); t.push(round(i / fs, 9)); });
    }
    // 경과 초만 있는 파일은 머리말의 시작 시각을 쓴다(시각 열이 있는 파일은 열 값이 우선)
    if (kind === 'rel' || kind === 'gen') {
      if (meta.start != null) { start = meta.start; startSource = 'meta'; }
      else if (meta.startTOD != null) { start = Math.round(meta.startTOD * 1000); startSource = 'tod'; }
    }
    if (opts.start != null && opts.start !== '') {
      var us = typeof opts.start === 'number' ? opts.start : parseDateTime(opts.start);
      if (us == null && typeof opts.start === 'string') { var ut = parseTOD(opts.start); if (ut != null) us = Math.round(ut * 1000); }
      if (us != null) { start = us; startSource = 'user'; }
      else issues.push('직접 넣은 시작 시각 「' + opts.start + '」을 읽지 못했습니다(예: 2026-10-15 10:20:00.000).');
    }
    // 시간이 거꾸로 가는 줄
    var back = 0;
    for (var b = 1; b < t.length; b++) if (t[b] <= t[b - 1]) back++;
    var order = t.map(function (_, i) { return i; });
    if (back) {
      issues.push('시간이 앞으로 가지 않는 줄 ' + back + '개가 있어 시간 순서로 정렬했습니다(같은 시각은 뒤 줄을 뺐습니다).');
      order.sort(function (a, b2) { return t[a] - t[b2] || a - b2; });
      order = order.filter(function (o, i) { return i === 0 || t[o] !== t[order[i - 1]]; });
    }
    var tt = order.map(function (o) { return t[o]; });
    // 채널: 채운 칸의 절반 이상이 숫자인 열
    var channels = [];
    for (var cc = 0; cc < width; cc++) {
      if (cc === tc) continue;
      var nNum = 0, nFill = 0, y = order.map(function (o) {
        var v = body[keep[o]][cc], x = toNum(v);
        if (cellKind(v) !== 'empty') nFill++;
        if (isFinite(x)) nNum++;
        return x;
      });
      if (!nFill || nNum < nFill * 0.5) continue;
      var su = splitUnit(headers[cc]);
      if (nNum < y.length) issues.push('「' + su.name + '」에 숫자가 아닌 칸 ' + (y.length - nNum) + '개 — 빈 값으로 두고 앞뒤를 이어 그립니다.');
      channels.push({ name: su.name, unit: su.unit, col: cc, y: y });
    }
    if (!channels.length) issues.push('숫자 채널을 찾지 못했습니다.');
    var dts = [];
    for (var d = 1; d < Math.min(tt.length, 5001); d++) dts.push(tt[d] - tt[d - 1]);
    var dt = dts.length ? round(median(dts), 9) : NaN;
    if (dts.length > 10) {
      var irregular = dts.filter(function (x) { return Math.abs(x - dt) > dt * 0.5; }).length;
      if (irregular > dts.length * 0.02) issues.push('샘플 간격이 일정하지 않은 곳이 ' + irregular + '군데 있습니다 — 리샘플 때 선형 보간으로 메웁니다.');
    }
    return {
      headers: headers, timeCol: tc, timeKind: kind, timeUnit: unit, t: tt, start: start, startSource: startSource,
      channels: channels, dt: dt, fs: dt > 0 ? round(1 / dt, 4) : NaN,
      duration: tt.length ? tt[tt.length - 1] - tt[0] : 0, n: tt.length, meta: meta, issues: issues
    };
  }

  /* ---------- 보간 · 리샘플 ---------- */
  // t 는 오름차순. 범위 밖이나 이웃이 빈 값이면 NaN.
  function resample(t, y, grid) {
    var out = new Array(grid.length), j = 0, n = t.length;
    for (var i = 0; i < grid.length; i++) {
      var g = grid[i];
      if (!n || g < t[0] - 1e-9 || g > t[n - 1] + 1e-9) { out[i] = NaN; continue; }
      while (j < n - 2 && t[j + 1] < g) j++;
      while (j > 0 && t[j] > g) j--;
      var t0 = t[j], t1 = t[Math.min(j + 1, n - 1)], y0 = y[j], y1 = y[Math.min(j + 1, n - 1)];
      if (Math.abs(g - t0) < 1e-9) { out[i] = y0; continue; }
      if (Math.abs(g - t1) < 1e-9) { out[i] = y1; continue; }
      out[i] = t1 === t0 ? y0 : y0 + (y1 - y0) * (g - t0) / (t1 - t0);
    }
    return out;
  }
  function makeGrid(from, to, dt) {
    var n = Math.floor((to - from) / dt + 1e-6) + 1, g = new Array(Math.max(0, n));
    for (var i = 0; i < n; i++) g[i] = round(from + i * dt, 9);
    return g;
  }
  // 빈 값을 앞뒤 값으로 선형으로 메운다(양 끝은 가까운 값)
  function fillGaps(y) {
    var out = y.slice(), n = out.length, last = -1;
    for (var i = 0; i < n; i++) {
      if (!isFinite(out[i])) continue;
      if (last < 0) for (var a = 0; a < i; a++) out[a] = out[i];
      else if (i - last > 1) for (var b = last + 1; b < i; b++) out[b] = out[last] + (out[i] - out[last]) * (b - last) / (i - last);
      last = i;
    }
    if (last >= 0) for (var c = last + 1; c < n; c++) out[c] = out[last];
    return out;
  }

  /* ---------- 전처리 ---------- */
  function movingAverage(y, win) {
    win = Math.max(1, Math.round(win)); if (win <= 1) return y.slice();
    var h = Math.floor(win / 2), out = new Array(y.length);
    for (var i = 0; i < y.length; i++) {
      var s = 0, n = 0;
      for (var k = Math.max(0, i - h); k <= Math.min(y.length - 1, i - h + win - 1); k++) if (isFinite(y[k])) { s += y[k]; n++; }
      out[i] = n ? s / n : NaN;
    }
    return out;
  }
  // 1차 저역통과를 앞→뒤, 뒤→앞 두 번 — 위상(시간) 지연이 생기지 않는다. 지연이 생기면 동기화를 망친다.
  function lowpass(y, fs, fc) {
    if (!(fc > 0) || !(fs > 0) || fc >= fs / 2) return y.slice();
    var dt = 1 / fs, rc = 1 / (2 * Math.PI * fc), a = dt / (rc + dt);
    var x = fillGaps(y), f = new Array(x.length), i;
    if (!x.length) return [];
    f[0] = x[0];
    for (i = 1; i < x.length; i++) f[i] = f[i - 1] + a * (x[i] - f[i - 1]);
    var g = new Array(x.length); g[x.length - 1] = f[x.length - 1];
    for (i = x.length - 2; i >= 0; i--) g[i] = g[i + 1] + a * (f[i] - g[i + 1]);
    return g.map(function (v, k) { return isFinite(y[k]) ? v : NaN; });
  }
  /* 이상치 = 「앞뒤 점에서 혼자 튄 점」(센서 튐·통신 잡음). 앞뒤 이웃 평균과의 차 d 를 모든 점에서 구하고,
   * d 의 강건한 퍼짐(1.4826 × MAD)의 k 배를 넘는 점만 고른다. 충격 응답처럼 여러 점에 걸쳐 오르내리는 실제 신호는
   * 이웃과 함께 움직이므로 d 가 작다 — 창 안 중앙값과 비교하는 방식(햄펠)은 충격의 첫 봉우리를 이상치로 잘못 잡았다. */
  function outliers(y, k) {
    k = k || 8;
    var n = y.length, d = new Array(n), res = [];
    for (var i = 0; i < n; i++) {
      d[i] = NaN; if (!isFinite(y[i])) continue;
      var a = i - 1, b = i + 1;
      while (a >= 0 && !isFinite(y[a])) a--;
      while (b < n && !isFinite(y[b])) b++;
      if (a < 0 && b >= n) continue;
      var nb;
      if (a >= 0 && b < n) nb = (y[a] + y[b]) / 2;
      else {                                            // 양 끝: 한쪽 두 점으로 이어 그은 값과 비교
        var dir = a < 0 ? 1 : -1, p1 = i + dir, p2 = i + 2 * dir;
        nb = p2 >= 0 && p2 < n && isFinite(y[p1]) && isFinite(y[p2]) ? 2 * y[p1] - y[p2] : (a < 0 ? y[b] : y[a]);
      }
      d[i] = y[i] - nb;
    }
    var md = median(d), mad = median(d.map(function (v) { return Math.abs(v - md); }));
    var s = 1.4826 * mad;
    if (!(s > 0)) { var st = stats(d.map(function (v) { return Math.abs(v - md); })); s = st.mean * 1.25; }
    if (!(s > 0)) return res;
    for (var j = 0; j < n; j++) if (isFinite(d[j]) && Math.abs(d[j] - md) > k * s) res.push(j);
    // 튄 점 바로 옆 점도 d 가 커진다(튄 값의 절반) — 더 크게 튄 쪽만 남긴다
    return res.filter(function (i) {
      return !res.some(function (o) { return Math.abs(o - i) === 1 && Math.abs(d[o]) > Math.abs(d[i]); });
    });
  }
  var PRE_DEFAULT = { scale: 1, offset: 0, zeroSec: 0, ma: 0, lpHz: 0, outK: 8, outMode: 'mark' };
  /* 순서(테스트로 고정): ① 이상치 찾기(원값) → ② 보간으로 바꾸기(고른 경우) → ③ 배율·오프셋 → ④ 영점(앞 N초 평균 빼기)
   *                     → ⑤ 이동평균 → ⑥ 저역통과. 원래 샘플에서 한 다음 리샘플한다(필터는 원래 주기 기준). */
  function preprocess(t, y, p) {
    p = Object.assign({}, PRE_DEFAULT, p || {});
    var out = p.outK > 0 ? outliers(y, p.outK) : [];
    var v = y.slice(), marks = out.map(function (i) { return { i: i, t: t[i], v: y[i] }; });
    if (p.outMode === 'replace' && out.length) { out.forEach(function (i) { v[i] = NaN; }); v = fillGaps(v).map(function (x, i) { return isFinite(y[i]) || out.indexOf(i) >= 0 ? x : NaN; }); }
    v = v.map(function (x) { return x * p.scale + p.offset; });
    if (p.zeroSec > 0 && t.length) {
      var lim = t[0] + p.zeroSec, s = 0, n = 0;
      for (var i = 0; i < t.length && t[i] <= lim; i++) if (isFinite(v[i])) { s += v[i]; n++; }
      if (n) { var z = s / n; v = v.map(function (x) { return x - z; }); }
    }
    if (p.ma > 1) v = movingAverage(v, p.ma);
    if (p.lpHz > 0) { var dt = t.length > 1 ? (t[t.length - 1] - t[0]) / (t.length - 1) : 1; v = lowpass(v, 1 / dt, p.lpHz); }
    return { y: v, outliers: marks };
  }
  function describePre(p) {
    p = Object.assign({}, PRE_DEFAULT, p || {});
    var a = [];
    if (p.scale !== 1 || p.offset !== 0) a.push('×' + p.scale + (p.offset >= 0 ? ' +' : ' ') + p.offset);
    if (p.zeroSec > 0) a.push('영점(앞 ' + p.zeroSec + '초 평균)');
    if (p.ma > 1) a.push('이동평균 ' + p.ma + '점');
    if (p.lpHz > 0) a.push('저역통과 ' + p.lpHz + ' Hz');
    if (p.outK > 0) a.push('이상치 기준 ' + p.outK + '배 ' + (p.outMode === 'replace' ? '보간 대체' : '표시만'));
    return a.join(' · ') || '없음';
  }

  /* ---------- 지연 추정(교차상관) ---------- */
  // a, b 는 같은 간격 배열. 결과 lag>0 = b 가 a 보다 lag 초 늦게 찍혔다.
  function xcorr(a, b, dt, maxLag) {
    var n = Math.min(a.length, b.length), K = Math.max(1, Math.min(n - 2, Math.round(maxLag / dt)));
    var na = normalize(a.slice(0, n)), nb = normalize(b.slice(0, n)), best = -Infinity, bk = 0, r = {};
    for (var k = -K; k <= K; k++) {
      var s = 0, c = 0;
      for (var i = Math.max(0, -k); i < n && i + k < n; i++) { s += na[i] * nb[i + k]; c++; }
      r[k] = c > n * 0.25 ? s / c : -Infinity;
      if (r[k] > best) { best = r[k]; bk = k; }
    }
    var d = 0;
    if (bk > -K && bk < K && isFinite(r[bk - 1]) && isFinite(r[bk + 1])) {
      var den = r[bk - 1] - 2 * r[bk] + r[bk + 1];
      if (den < 0) d = 0.5 * (r[bk - 1] - r[bk + 1]) / den;
    }
    return { lag: round((bk + d) * dt, 6), r: round(best, 4), atEdge: Math.abs(bk) === K };
  }
  function normalize(y) {
    var x = fillGaps(y), st = stats(x), sd = st.std || 1;
    return x.map(function (v) { return (v - st.mean) / sd; });
  }
  // 크기 포락선: 느린 추세(정하중 등)를 빼고 절댓값을 매끄럽게 — 응력과 가속도처럼 물리량이 달라도 「충격이 온 때」는 같다.
  function envelope(y, dt) {
    var slow = movingAverage(fillGaps(y), Math.max(3, Math.round(1 / dt)));
    var hp = y.map(function (v, i) { return Math.abs(v - slow[i]); });
    return movingAverage(hp, Math.max(1, Math.round(0.05 / dt)));
  }
  /* 기준 신호와 대상 신호의 지연. tRef/yRef, tTgt/yTgt 는 이미 시작 시각 차이를 반영한 공통축 시각.
   * mode 'env'(기본, 물리량이 다를 때) | 'raw'(같은 물리량·같은 신호일 때) */
  function estimateLag(tRef, yRef, tTgt, yTgt, opt) {
    opt = opt || {};
    var maxLag = opt.maxLag || 2, mode = opt.mode || 'env';
    var lo = Math.max(tRef[0], tTgt[0]), hi = Math.min(tRef[tRef.length - 1], tTgt[tTgt.length - 1]);
    if (!(hi - lo > maxLag * 2)) return { lag: 0, r: NaN, error: '두 신호가 겹치는 구간이 최대 지연의 두 배보다 짧습니다.' };
    var dRef = median(tRef.slice(1, 2000).map(function (x, i) { return x - tRef[i]; }));
    var dTgt = median(tTgt.slice(1, 2000).map(function (x, i) { return x - tTgt[i]; }));
    var dt = round(opt.dt || Math.max(Math.min(dRef, dTgt), (hi - lo) / 20000, 1e-4), 9);
    if (opt.despike !== false) { yRef = despike(yRef); yTgt = despike(yTgt); }   // 센서 튐 한 점이 상관을 통째로 끌어내린다
    var g = makeGrid(lo, hi, dt), a = resample(tRef, yRef, g), b = resample(tTgt, yTgt, g);
    if (mode === 'env') { a = envelope(a, dt); b = envelope(b, dt); }
    var res = xcorr(a, b, dt, maxLag);
    res.dt = dt; res.mode = mode;
    if (res.atEdge) res.warn = '최대 지연 끝에서 최댓값이 나왔습니다 — 최대 지연을 늘려 다시 추정해 보세요.';
    else if (res.r < 0.3) res.warn = '상관이 낮습니다(r=' + res.r + ') — 두 신호에 같은 사건(충격·시동 등)이 들어 있는지 확인하세요.';
    return res;
  }

  function despike(y, k) {
    var o = outliers(y, k || 8); if (!o.length) return y;
    var v = y.slice(); o.forEach(function (i) { v[i] = NaN; });
    return fillGaps(v);
  }
  // 화면에서 쓰는 지연 추정: 시작 시각 차이와 전처리를 반영한 뒤 estimateLag
  function estimateFor(datasets, ref, refCh, tgt, tgtCh, opt) {
    var so = startOffsets(datasets, ref), R = datasets[ref], T = datasets[tgt];
    var cr = R.channels.filter(function (c) { return c.name === refCh; })[0], ct = T.channels.filter(function (c) { return c.name === tgtCh; })[0];
    if (!cr || !ct) return { lag: 0, r: NaN, error: '채널을 찾지 못했습니다.' };
    var yr = preprocess(R.t, cr.y, R.pre && R.pre[refCh]).y, yt = preprocess(T.t, ct.y, T.pre && T.pre[tgtCh]).y;
    var tr = R.t.map(function (x) { return x + so.offsets[ref]; }), tt = T.t.map(function (x) { return x + so.offsets[tgt]; });
    return estimateLag(tr, yr, tt, yt, opt);
  }

  /* ---------- 동기화 ---------- */
  /* datasets: readTable 결과 배열(각각 .name, .pre{채널이름: 전처리값}, .lag(초), .use{채널이름: false 면 뺌})
   * cfg: { ref: 기준 번호, dt: 공통 간격(없으면 가장 짧은 원래 간격), span: 'overlap'|'union', from, to(공통축 초) } */
  function startOffsets(datasets, ref) {
    var issues = [], r = datasets[ref], todOnly = datasets.some(function (d) { return d.startSource === 'tod'; });
    var offs = datasets.map(function (d, i) {
      if (i === ref) return 0;
      if (d.start == null || r.start == null) { issues.push('「' + d.name + '」' + (r.start == null && i !== ref ? '(또는 기준)' : '') + '에 시작 시각이 없어 0초에서 같이 시작한 것으로 봤습니다.'); return 0; }
      var a = d.start, b = r.start;
      if (todOnly) { a = ((a % DAY) + DAY) % DAY; b = ((b % DAY) + DAY) % DAY; }
      return round((a - b) / 1000, 6);
    });
    if (todOnly) issues.push('날짜 없이 시각만 있는 파일이 있어 시각(시:분:초)끼리만 맞췄습니다.');
    return { offsets: offs, issues: issues };
  }
  function sync(datasets, cfg) {
    cfg = cfg || {};
    var ref = cfg.ref || 0, so = startOffsets(datasets, ref), issues = so.issues.slice();
    var series = [], spans = [];
    datasets.forEach(function (d, i) {
      var shift = so.offsets[i] - (i === ref ? 0 : (d.lag || 0));
      var tc = d.t.map(function (x) { return round(x + shift, 9); });
      spans.push([tc[0], tc[tc.length - 1]]);
      d.channels.forEach(function (ch) {
        if (d.use && d.use[ch.name] === false) return;
        var pr = preprocess(d.t, ch.y, d.pre && d.pre[ch.name]);
        series.push({ ds: i, file: d.name, name: ch.name, unit: ch.unit, t: tc, y: pr.y, outliers: pr.outliers.map(function (o) { return { t: round(o.t + shift, 6), v: o.v }; }), dt: d.dt, pre: d.pre && d.pre[ch.name] });
      });
    });
    var lo, hi;
    var used = datasets.map(function (d, i) { return i; }).filter(function (i) { return series.some(function (s) { return s.ds === i; }); });
    if (cfg.span === 'union') { lo = Math.min.apply(null, used.map(function (i) { return spans[i][0]; })); hi = Math.max.apply(null, used.map(function (i) { return spans[i][1]; })); }
    else { lo = Math.max.apply(null, used.map(function (i) { return spans[i][0]; })); hi = Math.min.apply(null, used.map(function (i) { return spans[i][1]; })); }
    if (!(hi > lo)) { issues.push('파일들이 겹치는 시간 구간이 없습니다. 시작 시각을 확인하거나 「전체 구간」으로 바꿔 보세요.'); return { t: [], cols: [], offsets: [], issues: issues, from: lo, to: hi }; }
    if (cfg.from != null && isFinite(cfg.from) && cfg.from > lo) lo = cfg.from;
    if (cfg.to != null && isFinite(cfg.to) && cfg.to < hi) hi = cfg.to;
    if (!(hi > lo)) { issues.push('자를 구간이 비었습니다.'); return { t: [], cols: [], offsets: [], issues: issues, from: lo, to: hi }; }
    var dt = cfg.dt > 0 ? cfg.dt : Math.min.apply(null, used.map(function (i) { return datasets[i].dt; }));
    dt = round(dt, 9);
    var limit = cfg.maxRows || 200000;
    if ((hi - lo) / dt + 1 > limit) { var nd = round((hi - lo) / (limit - 1), 6); issues.push('공통 시간축이 ' + limit + '점을 넘어 간격을 ' + dt + '초 → ' + nd + '초로 늘렸습니다.'); dt = nd; }
    var start = round(Math.ceil(lo / dt - 1e-9) * dt, 9), g = makeGrid(start, hi, dt);
    var cols = series.map(function (s) {
      var v = resample(s.t, s.y, g);
      var interp = Math.abs(s.dt - dt) > dt * 1e-3 || Math.abs(((s.t[0] - g[0]) / dt) - Math.round((s.t[0] - g[0]) / dt)) > 1e-3;
      var outs = s.outliers.filter(function (o) { return o.t >= g[0] - dt && o.t <= g[g.length - 1] + dt; });
      // 통계는 이상치로 표시된 점을 빼고 낸다 — 「표시만」이어도 센서 튐이 최댓값이 되면 안 된다.
      // 보간하면 튄 점이 앞뒤 원래 간격(s.dt)만큼 번지므로 그 범위의 공통축 점을 모두 뺀다.
      var clean = v.slice(), w = Math.max(s.dt || dt, dt);
      outs.forEach(function (o) {
        for (var k = Math.max(0, Math.floor((o.t - w - g[0]) / dt)); k < clean.length && g[k] < o.t + w - 1e-9; k++) if (g[k] > o.t - w + 1e-9) clean[k] = NaN;
      });
      return { ds: s.ds, file: s.file, name: s.name, unit: s.unit, values: v, interp: interp, stats: stats(clean), statsAll: stats(v),
        outliers: outs, pre: describePre(s.pre) };
    });
    var offsets = datasets.map(function (d, i) {
      return { name: d.name, start: d.start, startSource: d.startSource, startOffset: so.offsets[i], lag: i === ref ? 0 : (d.lag || 0),
        lagSource: i === ref ? '기준' : (d.lagSource || (d.lag ? '직접 입력' : '없음')), lagR: d.lagR, shift: round(so.offsets[i] - (i === ref ? 0 : (d.lag || 0)), 6) };
    });
    return { t: g, dt: dt, cols: cols, offsets: offsets, issues: issues, from: g[0], to: g[g.length - 1], ref: ref, refStart: datasets[ref].start };
  }

  // 그리기용 줄이기 — 칸마다 최솟값·최댓값을 둘 다 남겨 충격 봉우리가 사라지지 않게 한다.
  function decimate(t, y, buckets) {
    var n = t.length; if (n <= buckets * 2) return { t: t.slice(), y: y.slice() };
    var ot = [], oy = [], size = n / buckets;
    for (var b = 0; b < buckets; b++) {
      var s = Math.floor(b * size), e = Math.min(n, Math.floor((b + 1) * size)), mn = -1, mx = -1;
      for (var i = s; i < e; i++) { if (!isFinite(y[i])) continue; if (mn < 0 || y[i] < y[mn]) mn = i; if (mx < 0 || y[i] > y[mx]) mx = i; }
      if (mn < 0) { ot.push(t[s]); oy.push(NaN); continue; }
      var a = Math.min(mn, mx), c = Math.max(mn, mx);
      ot.push(t[a]); oy.push(y[a]); if (c !== a) { ot.push(t[c]); oy.push(y[c]); }
    }
    return { t: ot, y: oy };
  }
  function colLabel(c) { return c.name + (c.unit ? ' (' + c.unit + ')' : '') + ' [' + c.file + ']'; }
  function exportRows(res) {
    var head = ['시간(s)'];
    if (res.refStart != null) head.push('시각');
    res.cols.forEach(function (c) { head.push(colLabel(c)); });
    var rows = [head];
    for (var i = 0; i < res.t.length; i++) {
      var r = [res.t[i]];
      if (res.refStart != null) r.push(fmtDateTime(res.refStart + Math.round(res.t[i] * 1000)));
      res.cols.forEach(function (c) { var v = c.values[i]; r.push(isFinite(v) ? round(v, 6) : ''); });
      rows.push(r);
    }
    return rows;
  }
  function toCSV(rows) {
    return '﻿' + rows.map(function (r) { return r.map(function (v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(','); }).join('\r\n');
  }
  function summaryText(res) {
    if (!res || !res.t.length) return '';
    var ref = res.offsets[res.ref], a = [];
    a.push('기준 파일 「' + ref.name + '」의 시작을 0초로 두고 ' + (res.offsets.length - 1) + '개 파일을 맞췄습니다.');
    res.offsets.forEach(function (o, i) {
      if (i === res.ref) return;
      a.push('「' + o.name + '」 — 시작 시각 차이 ' + o.startOffset + '초, 지연 ' + o.lag + '초(' + o.lagSource + (isFinite(o.lagR) ? ', r=' + o.lagR : '') + '), 최종 이동 ' + o.shift + '초.');
    });
    a.push('공통 시간축은 ' + round(res.from, 4) + '~' + round(res.to, 4) + '초, ' + res.dt + '초 간격 ' + res.t.length + '점입니다.');
    res.cols.forEach(function (c) {
      var s = c.stats, u = c.unit ? ' ' + c.unit : '';
      a.push(c.name + ': 최대 ' + round(s.max, 3) + u + '(' + round(res.t[s.iMax], 3) + '초), 최소 ' + round(s.min, 3) + u + ', 평균 ' + round(s.mean, 3) + u + ', RMS ' + round(s.rms, 3) + u +
        (c.outliers.length ? ', 이상치 ' + c.outliers.length + '점은 통계에서 뺌' : '') + '.');
    });
    return a.join('\n');
  }

  /* ---------- 3D ---------- */
  // 3D 용 표 읽기: 머리 줄과 숫자 열만 (시간 해석 없음)
  function tableColumns(rows) {
    rows = (rows || []).map(function (r) { return Array.isArray(r) ? r : []; });
    var hd = findHeader(rows), body = rows.slice(hd.first).filter(function (r) { return dataLike(r).filled > 0; });
    var width = body.reduce(function (a, r) { return Math.max(a, r.length); }, 0), cols = [];
    for (var c = 0; c < width; c++) {
      var v = body.map(function (r) { return toNum(r[c]); }), n = finite(v).length;
      if (n < Math.max(3, body.length * 0.5)) continue;
      var h = hd.header >= 0 ? rows[hd.header][c] : '';
      cols.push({ name: String(h == null || h === '' ? '열' + (c + 1) : h).trim(), values: v });
    }
    return cols;
  }
  function uniqSorted(a) {
    var b = a.map(function (v) { return round(v, 9); }).sort(function (x, y) { return x - y; });
    return b.filter(function (v, i) { return i === 0 || v !== b[i - 1]; });
  }
  // 이미 격자(모든 X×Y 조합이 한 번씩)면 그대로 곡면이 된다 — 보간 없이 측정값.
  function detectGrid(x, y, z) {
    var ux = uniqSorted(x), uy = uniqSorted(y);
    if (ux.length < 2 || uy.length < 2 || ux.length * uy.length !== x.length) return null;
    var Z = uy.map(function () { return ux.map(function () { return NaN; }); });
    for (var i = 0; i < x.length; i++) {
      var ix = ux.indexOf(round(x[i], 9)), iy = uy.indexOf(round(y[i], 9));
      if (isFinite(Z[iy][ix])) return null;            // 같은 조합이 두 번
      Z[iy][ix] = z[i];
    }
    return { xs: ux, ys: uy, z: Z };
  }
  /* 흩어진 점 → nx×ny 격자. 역거리 가중(IDW, 거듭제곱 power). X·Y 는 단위가 달라서 범위로 나눈 뒤 거리를 잰다.
   * 격자로 들어온 데이터는 그대로 쓴다(kind 'grid' = 측정값, 'idw' = 보간 추정값). */
  function surface(x, y, z, opt) {
    opt = opt || {};
    var keep = [];
    for (var i = 0; i < x.length; i++) if (isFinite(x[i]) && isFinite(y[i]) && isFinite(z[i])) keep.push(i);
    x = keep.map(function (i) { return x[i]; }); y = keep.map(function (i) { return y[i]; }); z = keep.map(function (i) { return z[i]; });
    if (x.length < 3) return null;
    var g = opt.force ? null : detectGrid(x, y, z), kind = 'grid', xs, ys, Z;
    if (g) { xs = g.xs; ys = g.ys; Z = g.z; }
    else {
      kind = 'idw';
      var nx = opt.nx || 30, ny = opt.ny || 30, p = opt.power || 2, sx = stats(x), sy = stats(y);
      var rx = sx.p2p || 1, ry = sy.p2p || 1;
      xs = []; ys = [];
      for (var a = 0; a < nx; a++) xs.push(sx.min + rx * a / (nx - 1));
      for (var b = 0; b < ny; b++) ys.push(sy.min + ry * b / (ny - 1));
      var px = x.map(function (v) { return (v - sx.min) / rx; }), py = y.map(function (v) { return (v - sy.min) / ry; });
      Z = ys.map(function (yv) {
        var qy = (yv - sy.min) / ry;
        return xs.map(function (xv) {
          var qx = (xv - sx.min) / rx, sw = 0, sz = 0;
          for (var k = 0; k < px.length; k++) {
            var d2 = (px[k] - qx) * (px[k] - qx) + (py[k] - qy) * (py[k] - qy);
            if (d2 < 1e-12) return z[k];
            var w = 1 / Math.pow(d2, p / 2); sw += w; sz += w * z[k];
          }
          return sz / sw;
        });
      });
    }
    var flat = [].concat.apply([], Z), sz2 = stats(flat.concat(z));
    return { kind: kind, xs: xs, ys: ys, z: Z, points: { x: x, y: y, z: z }, xmin: xs[0], xmax: xs[xs.length - 1], ymin: ys[0], ymax: ys[ys.length - 1], zmin: sz2.min, zmax: sz2.max };
  }
  // 정사영. 세계 좌표는 z 가 위. yaw 는 위 축으로 돌리기, pitch 는 앞으로 숙이기(라디안). 반환 depth 가 클수록 멀다.
  function project(p, view) {
    var cy = Math.cos(view.yaw || 0), sy = Math.sin(view.yaw || 0), cp = Math.cos(view.pitch || 0), sp = Math.sin(view.pitch || 0);
    var x1 = p[0] * cy - p[1] * sy, y1 = p[0] * sy + p[1] * cy, z1 = p[2];
    var y2 = y1 * cp + z1 * sp, z2 = -y1 * sp + z1 * cp;
    var s = view.zoom || 1;
    return { x: round(x1 * s, 9), y: round(z2 * s, 9), depth: round(y2, 9) };
  }
  var MAPS = {
    viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
    jet: [[0, 0, 143], [0, 0, 255], [0, 255, 255], [255, 255, 0], [255, 0, 0], [128, 0, 0]],
    coolwarm: [[59, 76, 192], [141, 176, 254], [221, 221, 221], [244, 154, 123], [180, 4, 38]],
    gray: [[30, 30, 30], [235, 235, 235]]
  };
  function colormap(name, v) {
    var a = MAPS[name] || MAPS.viridis;
    if (!isFinite(v)) return [200, 200, 200];
    v = Math.max(0, Math.min(1, v));
    var f = v * (a.length - 1), i = Math.min(a.length - 2, Math.floor(f)), r = f - i;
    return [0, 1, 2].map(function (k) { return Math.round(a[i][k] + (a[i + 1][k] - a[i][k]) * r); });
  }
  function niceTicks(lo, hi, n) {
    if (!isFinite(lo) || !isFinite(hi)) return [];
    if (hi === lo) return [lo];
    var span = hi - lo, step = Math.pow(10, Math.floor(Math.log10(span / (n || 5)))), err = span / (n || 5) / step;
    if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5; else if (err >= 1.5) step *= 2;
    var out = [];
    for (var v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(round(v, 10));
    return out;
  }

  /* ---------- 예제(가짜 데이터) ---------- */
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function gauss(r) { var u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  // 실제 사내 데이터가 아니다. 가상 지게차가 60초 동안 짐을 들고 요철 8곳을 지난다.
  //   계측기 A: 응력 50 Hz, 줄마다 날짜+시각, 쉼표 구분, 센서 튐 1점·빈칸 1개
  //   계측기 B: 가속도 200 Hz, 경과 초 + 머리말 「Start Time」, 세미콜론 구분, Z축 영점 0.03 g 어긋남
  //   B 의 시계는 0.42초 늦게 기록돼 있다(SAMPLE_TRUTH.lag) — 시작 시각만 맞추면 0.42초 어긋난다.
  var SAMPLE_TRUTH = { lag: 0.42, startA: '2026-10-15 10:20:00.000', startB: '2026-10-15 10:20:01.920', bStartsAt: 1.5, glitchA: 1234 };
  var BUMPS = [[6.2, 1.0], [13.8, 0.7], [21.5, 1.2], [27.1, 0.8], [35.6, 1.1], [41.9, 0.6], [48.3, 0.9], [54.7, 1.0]];
  function truthAt(t, r) {
    var lift = t < 10 ? 0 : t < 15 ? (t - 10) / 5 : t < 45 ? 1 : t < 50 ? (50 - t) / 5 : 0;
    var st = 12 + 58 * lift, st2 = 8 + 31 * lift, az = 0, ax = 0.05 * Math.sin(2 * Math.PI * t / 30);
    BUMPS.forEach(function (b) {
      var d = t - b[0]; if (d < 0 || d > 3) return;
      var on = 1 - Math.exp(-d / 0.02);                 // 충격은 순간이 아니라 수십 ms 에 걸쳐 들어온다
      // 같은 마스트 진동(2.8 Hz)이 응력과 가속도에 함께 실린다. 가속도에는 높은 차수(11 Hz)가 더 얹힌다.
      st += 45 * b[1] * on * Math.exp(-d * 2.5) * Math.sin(2 * Math.PI * 2.8 * d);
      st2 += 20 * b[1] * on * Math.exp(-d * 2.5) * Math.sin(2 * Math.PI * 2.8 * d + 0.4);
      az += b[1] * on * (0.35 * Math.exp(-d * 2.5) * Math.sin(2 * Math.PI * 2.8 * d) + 0.6 * Math.exp(-d * 8) * Math.sin(2 * Math.PI * 11 * d));
      ax += 0.25 * b[1] * on * Math.exp(-d * 4) * Math.sin(2 * Math.PI * 2.8 * d + 1.1);
    });
    return { st: st, st2: st2, az: az, ax: ax };
  }
  function sampleFiles() {
    var r = rng(20261102), A = ['# 장비,가상 스트레인 앰프 SG-01 (예제 · 실제 사내 데이터가 아닙니다)', 'Timestamp,마스트_좌(MPa),틸트실린더(MPa)'];
    var t0 = parseDateTime(SAMPLE_TRUTH.startA);
    for (var i = 0; i <= 60 * 50; i++) {
      var t = i / 50, v = truthAt(t, r), s1 = v.st + gauss(r) * 1.2, s2 = v.st2 + gauss(r) * 0.8;
      if (i === SAMPLE_TRUTH.glitchA) s1 = 912.4;
      A.push(fmtDateTime(t0 + Math.round(t * 1000)) + ',' + (i === 2222 ? '' : s1.toFixed(2)) + ',' + s2.toFixed(2));
    }
    var B = ['Device: 가상 가속도 로거 AX-2 (예제)', 'Start Time: 2026/10/15 10:20:01.920', 'Sample Rate: 200 Hz', '', 't [s];Acc_Z [g];Acc_X [g]'];
    for (var k = 0; k <= 58.5 * 200; k++) {
      var tt = SAMPLE_TRUTH.bStartsAt + k / 200, w = truthAt(tt, r);
      var nx = gauss(r) * 0.01, nz = gauss(r) * 0.015;
      B.push((k / 200).toFixed(3) + ';' + (w.az + 0.03 + nz).toFixed(4) + ';' + (w.ax + nx).toFixed(4));
    }
    return [{ name: '응력_SG01.csv', text: A.join('\n') }, { name: '가속도_AX2.csv', text: B.join('\n') }];
  }
  // 3D 예제: 시험 조건 매트릭스(하중 × 인상 높이) → 마스트 최대 응력. 가짜 값.
  function sample3D() {
    var rows = [['하중(kN)', '인상높이(m)', '최대응력(MPa)']], r = rng(7);
    [0, 5, 10, 15, 20, 25, 30].forEach(function (L) {
      [0.5, 1.5, 2.5, 3.5, 4.5, 5.5].forEach(function (H) {
        var s = 18 + 3.1 * L + 4.2 * H + 0.55 * L * H + 0.035 * L * L * (H / 5.5) + gauss(r) * 1.5;
        rows.push([L, H, round(s, 1)]);
      });
    });
    return rows;
  }

  /* ---------- (v1.1) 3D 작업실 — 붙여넣기 · 삼각망 · 2차 회귀 곡면 · 예측 · 뷰 큐브 ---------- */
  // 엑셀에서 복사한 글(탭 · 쉼표 · 공백 구분) → 줄 배열. 숫자가 아닌 칸은 글자 그대로 둔다(예: Safe).
  function parsePaste(text) {
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map(function (l) { return l.replace(/\s+$/, ''); }).filter(function (l) { return l.trim(); });
    if (!lines.length) return [];
    var sep = lines[0].indexOf('\t') >= 0 ? '\t' : lines[0].indexOf(',') >= 0 ? ',' : lines[0].indexOf(';') >= 0 ? ';' : /\s{2,}|\s/.test(lines[0].trim()) ? /\s+/ : '\t';
    return lines.map(function (l) { return l.split(sep).map(function (c) { var t = c.trim(), u = sep === ',' ? t : t.replace(/,(?=\d{3}(\D|$))/g, ''); var n = toNum(u); return t !== '' && isFinite(n) && /^[-+]?[\d.,eE+\-]+$/.test(t) ? n : t; }); });
  }
  // 3D 표: 숫자 열과 함께 「라벨」(Safe 같은 글자)이 섞인 열도 받는다 → values(숫자, 글자는 NaN) + labels(글자)
  function tableColumnsWithLabels(rows) {
    rows = (rows || []).map(function (r) { return Array.isArray(r) ? r : []; });
    var hd = findHeader(rows), body = rows.slice(hd.first).filter(function (r) { return r.some(function (c) { return c !== '' && c != null; }); });
    var width = body.reduce(function (a, r) { return Math.max(a, r.length); }, 0), cols = [];
    for (var c = 0; c < width; c++) {
      var raw = body.map(function (r) { return r[c]; }), v = raw.map(toNum), n = finite(v).length;
      var labels = raw.map(function (x, i) { return isFinite(v[i]) ? '' : String(x == null ? '' : x).trim(); });
      var nl = labels.filter(Boolean).length;
      if (n + nl < Math.max(3, body.length * 0.5)) continue;
      var h = hd.header >= 0 ? rows[hd.header][c] : '';
      cols.push({ name: String(h == null || h === '' ? '열' + (c + 1) : h).trim(), values: v, labels: labels, numeric: n, labeled: nl });
    }
    return cols;
  }
  // 라벨 값을 숫자로 바꾼다(예: Safe → 40). 바꾼 점은 「라벨 대체」로 표시한다.
  function applyLabelMap(col, map) {
    var out = col.values.slice(), flagged = [];
    col.labels.forEach(function (l, i) { if (l && map && isFinite(toNum(map[l]))) { out[i] = toNum(map[l]); flagged.push(i); } });
    return { values: out, replaced: flagged };
  }
  // Bowyer–Watson 들로네 삼각분할. X·Y 는 범위로 나눠(0~1) 단위 차이를 없앤다. 반환: [[i,j,k], …] (원래 점 번호)
  function delaunay(x, y) {
    var idx = []; for (var i = 0; i < x.length; i++) if (isFinite(x[i]) && isFinite(y[i])) idx.push(i);
    if (idx.length < 3) return [];
    var sx = stats(idx.map(function (i) { return x[i]; })), sy = stats(idx.map(function (i) { return y[i]; }));
    var rx = sx.p2p || 1, ry = sy.p2p || 1;
    var P = idx.map(function (i) { return [(x[i] - sx.min) / rx, (y[i] - sy.min) / ry]; });
    // 중복 점 제거(같은 자리 두 번이면 뒤의 것을 버린다)
    var seen = {}, keep = [];
    P.forEach(function (p, k) { var key = p[0].toFixed(9) + ',' + p[1].toFixed(9); if (!seen[key]) { seen[key] = 1; keep.push(k); } });
    var pts = keep.map(function (k) { return P[k]; }), ids = keep.map(function (k) { return idx[k]; });
    if (pts.length < 3) return [];
    var n = pts.length, st = [[-10, -10], [10, -10], [0, 10]];     // 초대형 삼각형
    var all = pts.concat(st), tris = [[n, n + 1, n + 2]];
    function circum(t) {
      var a = all[t[0]], b = all[t[1]], c = all[t[2]];
      var d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
      if (Math.abs(d) < 1e-14) return null;
      var ux = ((a[0] * a[0] + a[1] * a[1]) * (b[1] - c[1]) + (b[0] * b[0] + b[1] * b[1]) * (c[1] - a[1]) + (c[0] * c[0] + c[1] * c[1]) * (a[1] - b[1])) / d;
      var uy = ((a[0] * a[0] + a[1] * a[1]) * (c[0] - b[0]) + (b[0] * b[0] + b[1] * b[1]) * (a[0] - c[0]) + (c[0] * c[0] + c[1] * c[1]) * (b[0] - a[0])) / d;
      return { x: ux, y: uy, r2: (a[0] - ux) * (a[0] - ux) + (a[1] - uy) * (a[1] - uy) };
    }
    for (var p = 0; p < n; p++) {
      var pt = all[p], bad = [], poly = {};
      tris.forEach(function (t, ti) { var c = circum(t); if (c && (pt[0] - c.x) * (pt[0] - c.x) + (pt[1] - c.y) * (pt[1] - c.y) <= c.r2 * (1 + 1e-9)) bad.push(ti); });
      bad.forEach(function (ti) { var t = tris[ti]; [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]].forEach(function (e) { var k = Math.min(e[0], e[1]) + '-' + Math.max(e[0], e[1]); poly[k] = (poly[k] || 0) + 1; poly[k + ':e'] = e; }); });
      tris = tris.filter(function (_, ti) { return bad.indexOf(ti) < 0; });
      Object.keys(poly).forEach(function (k) { if (k.indexOf(':e') >= 0 || poly[k] !== 1) return; var e = poly[k + ':e']; tris.push([e[0], e[1], p]); });
    }
    return tris.filter(function (t) { return t.every(function (v) { return v < n; }); }).map(function (t) {
      // 시계 반대 방향으로 맞춘다
      var a = all[t[0]], b = all[t[1]], c = all[t[2]];
      var cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      var o = cross < 0 ? [t[0], t[2], t[1]] : t;
      return o.map(function (v) { return ids[v]; });
    });
  }
  // 2차 다항 회귀 z = a + b·x + c·y + d·x² + e·y² + f·x·y (최소제곱, 정규방정식 6×6). 기획자 계수 순서(f e d c b a)와 같은 이름을 쓴다.
  function quadTerms(x, y) { return [1, x, y, x * x, y * y, x * y]; }
  function solve(A, b) {
    var n = b.length, M = A.map(function (r, i) { return r.concat([b[i]]); });
    for (var c = 0; c < n; c++) {
      var piv = c; for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-18) return null;
      var tmp = M[c]; M[c] = M[piv]; M[piv] = tmp;
      for (var r2 = 0; r2 < n; r2++) { if (r2 === c) continue; var f = M[r2][c] / M[c][c]; for (var k = c; k <= n; k++) M[r2][k] -= f * M[c][k]; }
    }
    return M.map(function (r, i) { return r[n] / r[i]; });
  }
  function quadFit(x, y, z) {
    var keep = []; for (var i = 0; i < x.length; i++) if (isFinite(x[i]) && isFinite(y[i]) && isFinite(z[i])) keep.push(i);
    if (keep.length < 6) return { error: '2차 회귀에는 숫자 점이 6개 이상 필요합니다(지금 ' + keep.length + '개).' };
    // 크기 차이가 큰 변수(질량 0~3500 · 높이 300~4750)를 그대로 제곱하면 수치가 나빠진다 → 범위로 나눠 맞추고 계수를 되돌린다
    var sx = stats(keep.map(function (i) { return x[i]; })), sy = stats(keep.map(function (i) { return y[i]; }));
    var kx = sx.p2p || 1, ky = sy.p2p || 1, ox = sx.min, oy = sy.min;
    var A = [], b = [];
    for (var r = 0; r < 6; r++) { A.push([0, 0, 0, 0, 0, 0]); b.push(0); }
    keep.forEach(function (i) {
      var t = quadTerms((x[i] - ox) / kx, (y[i] - oy) / ky);
      for (var r = 0; r < 6; r++) { b[r] += t[r] * z[i]; for (var c = 0; c < 6; c++) A[r][c] += t[r] * t[c]; }
    });
    var w = solve(A, b);
    if (!w) return { error: '점들이 한 직선이나 평면에 몰려 있어 2차 곡면을 정할 수 없습니다.' };
    // 되돌리기: u=(x-ox)/kx, v=(y-oy)/ky 로 맞춘 계수 → 원래 x·y 계수
    var W = w, a0 = W[0], a1 = W[1] / kx, a2 = W[2] / ky, a3 = W[3] / (kx * kx), a4 = W[4] / (ky * ky), a5 = W[5] / (kx * ky);
    // 상수항 · 1차항 보정(u = x/kx - ox/kx)
    var cx = -ox / kx, cy = -oy / ky;
    var a = W[0] + W[1] * cx + W[2] * cy + W[3] * cx * cx + W[4] * cy * cy + W[5] * cx * cy;
    var bb = W[1] / kx + 2 * W[3] * cx / kx + W[5] * cy / kx;
    var cc = W[2] / ky + 2 * W[4] * cy / ky + W[5] * cx / ky;
    var coef = { a: a, b: bb, c: cc, d: a3, e: a4, f: a5 };
    var fit = quadStats(coef, x, y, z, keep);
    fit.coef = coef; fit.n = keep.length; fit.src = 'fit';
    return fit;
  }
  function quadEval(coef, x, y) { return coef.a + coef.b * x + coef.c * y + coef.d * x * x + coef.e * y * y + coef.f * x * y; }
  function quadStats(coef, x, y, z, keep) {
    if (!keep) { keep = []; for (var i = 0; i < x.length; i++) if (isFinite(x[i]) && isFinite(y[i]) && isFinite(z[i])) keep.push(i); }
    var zs = keep.map(function (i) { return z[i]; }), mean = zs.reduce(function (a, v) { return a + v; }, 0) / (zs.length || 1);
    var ssTot = 0, ssRes = 0, res = [];
    keep.forEach(function (i) { var p = quadEval(coef, x[i], y[i]); ssRes += (z[i] - p) * (z[i] - p); ssTot += (z[i] - mean) * (z[i] - mean); res.push({ i: i, pred: p, resid: z[i] - p }); });
    var maxAbs = res.reduce(function (m, r) { return Math.max(m, Math.abs(r.resid)); }, 0);
    return { r2: ssTot > 0 ? 1 - ssRes / ssTot : null, rmse: Math.sqrt(ssRes / (keep.length || 1)), maxAbs: maxAbs, residuals: res };
  }
  function quadFormula(coef, names, dp) {
    var X = (names && names[0]) || 'x', Y = (names && names[1]) || 'y', Z = (names && names[2]) || 'z', g = function (v) { return Number(v).toPrecision(dp || 6); };
    return Z + ' = ' + g(coef.a) + ' + ' + g(coef.b) + '·' + X + ' + ' + g(coef.c) + '·' + Y + ' + ' + g(coef.d) + '·' + X + '² + ' + g(coef.e) + '·' + Y + '² + ' + g(coef.f) + '·' + X + '·' + Y;
  }
  function regGrid(coef, xmin, xmax, ymin, ymax, n) {
    n = n || 30; var xs = [], ys = [];
    for (var a = 0; a < n; a++) { xs.push(xmin + (xmax - xmin) * a / (n - 1)); ys.push(ymin + (ymax - ymin) * a / (n - 1)); }
    var Z = ys.map(function (yv) { return xs.map(function (xv) { return quadEval(coef, xv, yv); }); });
    return { xs: xs, ys: ys, z: Z };
  }
  // 뷰 큐브 — 면 이름 ↔ 카메라. 기획자 그림(주사위 좌표계: X 앞, Y 오른쪽, Z 위) 기준.
  var CUBE_VIEWS = { FRONT: { yaw: 0, pitch: 0 }, REAR: { yaw: Math.PI, pitch: 0 }, RIGHT: { yaw: -Math.PI / 2, pitch: 0 }, LEFT: { yaw: Math.PI / 2, pitch: 0 }, TOP: { yaw: 0, pitch: -Math.PI / 2 + 0.001 }, BOTTOM: { yaw: 0, pitch: Math.PI / 2 - 0.001 }, ISO: { yaw: -0.65, pitch: -0.55 } };
  var CUBE_FACES = [
    { name: 'FRONT', normal: [0, -1, 0], corners: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
    { name: 'REAR', normal: [0, 1, 0], corners: [[1, 1, -1], [-1, 1, -1], [-1, 1, 1], [1, 1, 1]] },
    { name: 'RIGHT', normal: [1, 0, 0], corners: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
    { name: 'LEFT', normal: [-1, 0, 0], corners: [[-1, 1, -1], [-1, -1, -1], [-1, -1, 1], [-1, 1, 1]] },
    { name: 'TOP', normal: [0, 0, 1], corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { name: 'BOTTOM', normal: [0, 0, -1], corners: [[-1, 1, -1], [1, 1, -1], [1, -1, -1], [-1, -1, -1]] }
  ];
  // 지금 뷰에서 보이는 면(카메라 쪽을 향한 면)과 그 투영 꼭짓점. 가까운 면이 앞에 온다.
  function cubeFaces(view) {
    var v = { yaw: view.yaw, pitch: view.pitch, zoom: 1 };
    return CUBE_FACES.map(function (f) {
      var pts = f.corners.map(function (c) { return project(c, v); });
      var nz = project(f.normal, v).depth;                 // 법선의 깊이: 음수면 카메라를 향한다
      return { name: f.name, pts: pts, depth: pts.reduce(function (a, p) { return a + p.depth; }, 0) / 4, visible: nz < -1e-3 };
    }).filter(function (f) { return f.visible; }).sort(function (a, b) { return a.depth - b.depth; });
  }
  function pointInPoly(px, py, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
    }
    return inside;
  }
  // 큐브 그림 안에서 누른 자리(큐브 중심 기준, 반지름 1 단위) → 면 이름. 보이는 면 중 가장 가까운 것.
  function cubeHit(view, px, py) {
    var faces = cubeFaces(view);
    for (var i = 0; i < faces.length; i++) if (pointInPoly(px, py, faces[i].pts)) return faces[i].name;
    return null;
  }
  // (v1.1) 3D 작업실 예제 — 가짜 시험 매트릭스(질량 × 높이 → 한계 속도). 일부 칸은 「Safe」(한계 없음) 글자.
  function sampleLimit() {
    var rows = [['Mass', 'Height', 'Velocity Limit']], r = rng(11);
    [0, 700, 1400, 2100, 2800, 3500].forEach(function (M) {
      [300, 1190, 2080, 2970, 3860, 4750].forEach(function (H) {
        var v = 42 - 0.0095 * M - 0.0052 * H + 7.5e-7 * M * M + 3.2e-7 * H * H + 8.1e-7 * M * H + gauss(r) * 0.6;
        rows.push([M, H, v > 24 ? 'Safe' : round(Math.max(6, v), 1)]);
      });
    });
    return rows;
  }

  var api = {
    toNum: toNum, median: median, stats: stats, round: round,
    detectDelimiter: detectDelimiter, parseCSV: parseCSV,
    parseDateTime: parseDateTime, parseTOD: parseTOD, fmtDateTime: fmtDateTime, splitUnit: splitUnit,
    readTable: readTable, resample: resample, makeGrid: makeGrid, fillGaps: fillGaps,
    movingAverage: movingAverage, lowpass: lowpass, outliers: outliers, preprocess: preprocess, describePre: describePre, PRE_DEFAULT: PRE_DEFAULT,
    xcorr: xcorr, envelope: envelope, estimateLag: estimateLag, estimateFor: estimateFor, despike: despike, startOffsets: startOffsets, sync: sync,
    decimate: decimate, colLabel: colLabel, exportRows: exportRows, toCSV: toCSV, summaryText: summaryText,
    tableColumns: tableColumns, detectGrid: detectGrid, surface: surface, project: project, colormap: colormap, MAPS: MAPS, niceTicks: niceTicks,
    parsePaste: parsePaste, tableColumnsWithLabels: tableColumnsWithLabels, applyLabelMap: applyLabelMap, delaunay: delaunay, quadFit: quadFit, quadEval: quadEval, quadStats: quadStats, quadFormula: quadFormula, regGrid: regGrid,
    CUBE_VIEWS: CUBE_VIEWS, CUBE_FACES: CUBE_FACES, cubeFaces: cubeFaces, cubeHit: cubeHit, pointInPoly: pointInPoly, sampleLimit: sampleLimit,
    sampleFiles: sampleFiles, sample3D: sample3D, SAMPLE_TRUTH: SAMPLE_TRUTH, TIME_NAMES: TIME_NAMES
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Meas = api;
})(this);
