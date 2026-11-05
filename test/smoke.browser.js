/* 브라우저에 실제로 띄워 화면이 그려지는지 본다 — node test/smoke.browser.js
 * 규칙 테스트가 다 통과해도 app.js 오타 하나면 빈 화면이 된다. playwright 가 없으면 건너뛴다. */
'use strict';
var http = require('http'), fs = require('fs'), path = require('path');
var chromium;
try { chromium = require('playwright').chromium; }
catch (e) { console.log('playwright 가 없어 화면 연기 테스트를 건너뜁니다.'); process.exit(0); }
var ROOT = path.join(__dirname, '..');
var MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
var srv = http.createServer(function (q, s) {
  var p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, function (e, b) { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); s.end(b); });
});
var passed = 0, failed = 0, v10;
function ok(c, label, d) { if (c) passed++; else { failed++; console.log('  X ' + label + (d ? '  ' + d : '')); } }
srv.listen(0, async function () {
  var base = 'http://127.0.0.1:' + srv.address().port + '/';
  var br = await chromium.launch(); var pg = await br.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  var errs = []; pg.on('pageerror', function (e) { errs.push(e.message); });
  try {
    await pg.goto(base);
    // 3D 예제는 처음부터 그려진다
    var px = await pg.evaluate(function () { var c = document.getElementById('c3d'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, n = 0; for (var i = 0; i < d.length; i += 16) if (d[i] < 200 || d[i + 1] < 200) n++; return n; });
    ok(px > 2000, '3D 예제 곡면이 그려진다', px);
    ok(/측정 격자 7×6/.test(await pg.textContent('#info3')), '3D 예제는 측정 격자 그대로', await pg.textContent('#info3'));

    await pg.click('#btn-sample');
    await pg.waitForSelector('#ts polyline', { timeout: 10000 });
    ok(await pg.isVisible('#s-sync'), '동기화 영역이 열린다');
    ok(await pg.$$eval('.fcard', function (t) { return t.length; }) === 2, '파일 카드 2개');
    var cards = await pg.textContent('#files');
    ok(/50 Hz/.test(cards) && /200 Hz/.test(cards), '샘플링 주기를 읽는다');
    ok(/파일 머리말/.test(cards) && /파일의 시간 열/.test(cards), '시작 시각 근거를 보인다');
    var lagV = +(await pg.inputValue('.lagrow input[data-k="lag"]'));
    ok(Math.abs(lagV - 0.42) < 0.02, '지연 자동 추정 ≈ 0.42초', lagV);
    ok(/교차상관 r=/.test(await pg.textContent('#lag-rows')), '추정 근거(r) 표시');
    ok(await pg.$$eval('#lagchart polyline', function (t) { return t.length; }) >= 3, '보정 전후 세 선');
    ok(await pg.$$eval('#ts polyline', function (t) { return t.length; }) >= 4, '겹친 시계열 4채널');
    ok(await pg.$$eval('#ts circle.omark', function (t) { return t.length; }) === 1, '센서 튐 하나가 이상치로 표시된다');
    var st = await pg.textContent('#stat-table');
    ok(/보간값/.test(st) && /마스트_좌/.test(st), '통계표와 보간값 구분');
    ok(/0\.4\d*초\(교차상관/.test(await pg.textContent('#summary')), '요약 문장에 지연', (await pg.textContent('#summary')).slice(0, 160));

    // 전처리: Z축 영점 0.5초 → 평균이 0 가까이
    var row = pg.locator('#pre-table tr', { hasText: 'Acc_Z' });
    await row.locator('input[data-k="zeroSec"]').fill('0.5');
    await row.locator('input[data-k="zeroSec"]').dispatchEvent('change');
    ok(/영점/.test(await pg.textContent('#stat-table')), '전처리 내역이 통계표에 남는다');
    // 직접 지연 입력
    await pg.fill('.lagrow input[data-k="lag"]', '0');
    await pg.dispatchEvent('.lagrow input[data-k="lag"]', 'change');
    ok(/직접 입력/.test(await pg.textContent('#offsets')), '직접 넣은 지연은 직접 입력으로 표시');
    await pg.click('.lagrow button[data-act="est"]');
    ok(/교차상관/.test(await pg.textContent('#offsets')), '다시 추정');

    var dl = pg.waitForEvent('download'); await pg.click('#btn-xlsx'); var f = await dl;
    ok(/\.xlsx$/.test(f.suggestedFilename()), '엑셀 내보내기', f.suggestedFilename());
    var dl2 = pg.waitForEvent('download'); await pg.click('#btn-csv'); var f2 = await dl2;
    ok(/\.csv$/.test(f2.suggestedFilename()), 'CSV 내보내기');

    // 3D: 동기화 결과 → 산점
    await pg.selectOption('#src3', 'sync');
    ok(/측정점/.test(await pg.textContent('#info3')), '동기화 결과로 3D 산점');
    await pg.selectOption('#src3', 'sample');
    var before = await pg.evaluate(function () { return document.getElementById('c3d').toDataURL(); });
    await pg.locator('#c3d').scrollIntoViewIfNeeded();
    var box = await pg.locator('#c3d').boundingBox();
    await pg.mouse.move(box.x + 300, box.y + 200); await pg.mouse.down(); await pg.mouse.move(box.x + 420, box.y + 240); await pg.mouse.up();
    ok(before !== await pg.evaluate(function () { return document.getElementById('c3d').toDataURL(); }), '끌면 3D 가 돈다');
    var dl3 = pg.waitForEvent('download'); await pg.click('#btn-png'); var f3 = await dl3;
    ok(/\.png$/.test(f3.suggestedFilename()), 'PNG 저장');

    // 360px 폭에서 가로 넘침 없음
    await pg.setViewportSize({ width: 360, height: 800 });
    var over = await pg.evaluate(function () {
      var W = document.documentElement.clientWidth, bad = [];
      document.querySelectorAll('main *').forEach(function (el) {
        var r = el.getBoundingClientRect(); if (!r.width) return;
        for (var p = el.parentElement; p; p = p.parentElement) { var ox = getComputedStyle(p).overflowX; if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return; }
        if (r.right > W + 1) bad.push((el.id || el.className || el.tagName) + ':' + Math.round(r.right));
      });
      return bad.slice(0, 5);
    });
    ok(!over.length, '360px 에서 가로 넘침 없음', over.join(', '));

    await pg.goto(base + 'guide.html');
    ok(/교차상관/.test(await pg.textContent('main')), '사용법 페이지');

    /* ===================== v1.1 3D 작업실 ===================== */
    var v10 = passed + failed;
    await pg.goto(base + 'surface.html');
    ok(await pg.isHidden('#s-views'), '처음엔 창 영역이 닫혀 있다');
    await pg.click('#btn-sample');
    await pg.waitForSelector('.panel canvas', { timeout: 5000 });
    ok(await pg.$$eval('.panel', function (t) { return t.length; }) === 3, '기본 창 3개');
    ok(/Safe\(12\)/.test(await pg.textContent('#label-box')), '라벨 Safe 12칸 표시');
    ok(/계산/.test(await pg.textContent('#fit-info')) && /R²/.test(await pg.textContent('#fit-info')), '회귀식 · R² 표시');
    var ex = await pg.evaluate(function () { var d = window.__surface.cur(); var k = []; for (var i = 0; i < d.x.length; i++) if (isFinite(d.z[i])) k.push(i); var F = Meas.quadFit(k.map(function (i) { return d.x[i]; }), k.map(function (i) { return d.y[i]; }), k.map(function (i) { return d.z[i]; })); return { r2: Meas.round(F.r2, 4), pts: k.length }; });
    ok((await pg.textContent('#fit-info')).indexOf(String(ex.r2)) >= 0, 'R² 카드 = 엔진 계산', String(ex.r2));
    ok(await pg.$$eval('.panel canvas', function (t) { return t.every(function (c) { return c.width > 100; }); }), '캔버스가 그려졌다');
    // 라벨 → 숫자
    await pg.fill('#label-box input[data-label="Safe"]', '40'); await pg.dispatchEvent('#label-box input[data-label="Safe"]', 'change');
    ok(/숫자로 바꿈 12/.test(await pg.textContent('#d-info')), 'Safe → 40 으로 바꾸면 12점이 곡면에 들어간다');
    // 뷰 동기화 · 큐브
    var yaw0 = await pg.evaluate(function () { return window.__surface.state.shared.yaw; });
    await pg.click('.panel[data-id="p1"] [data-face="TOP"]');
    var sh = await pg.evaluate(function () { return window.__surface.state.shared; });
    ok(Math.abs(sh.pitch - (-Math.PI / 2 + 0.001)) < 1e-6, 'TOP 면을 누르면 공유 뷰가 위에서 본 각도로', sh.pitch);
    ok(/TOP|pitch -1\.57/.test(await pg.textContent('[data-foot="p3"]')), '다른 창도 같이 돈다(동기화)');
    // 캔버스 큐브 영역 클릭 → FRONT
    await pg.click('.panel[data-id="p1"] [data-face="ISO"]');
    var box = await pg.$eval('canvas[data-canvas="p2"]', function (c) { c.scrollIntoView({ block: 'center' }); var r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width }; });
    await pg.mouse.click(box.x + box.w - 58 - 8, box.y + 58 + 10);
    var sh2 = await pg.evaluate(function () { return window.__surface.state.shared; });
    ok(Math.abs(sh2.pitch) < 1e-6 && Math.abs(sh2.yaw) < 1e-6, '큐브 그림의 FRONT 면을 누르면 정면', sh2.yaw + '/' + sh2.pitch);
    await pg.uncheck('#sync');
    await pg.click('.panel[data-id="p1"] [data-face="RIGHT"]');
    var v2 = await pg.evaluate(function () { return { p1: window.__surface.state.panels[0].view.yaw, p2: window.__surface.state.panels[1].view.yaw }; });
    ok(Math.abs(v2.p1 - (-Math.PI / 2)) < 1e-6 && Math.abs(v2.p2) < 1e-6, '동기화를 끄면 창마다 따로 돈다', JSON.stringify(v2));
    await pg.check('#sync');
    // 예측
    await pg.fill('#px', '2100'); await pg.fill('#py', '2080'); await pg.click('#btn-pred');
    ok(/≈ [\d.]+/.test(await pg.textContent('#pred-out')), '예측값 표시', await pg.textContent('#pred-out'));
    ok(/예측점 \(2100, 2080\)/.test(await pg.textContent('[data-foot="p3"]')), '예측 창 바닥글에 예측점');
    await pg.fill('#px', '9000'); await pg.click('#btn-pred');
    ok(/외삽/.test(await pg.textContent('#pred-out')), '범위 밖이면 외삽 알림');
    // 계수 직접 넣기
    await pg.evaluate(function () { document.querySelectorAll('details.box').forEach(function (d) { d.open = true; }); });
    await pg.fill('[data-coef="a"]', '40.78'); await pg.click('#btn-coef-apply');
    ok(/직접 입력/.test(await pg.textContent('#fit-info')), '계수를 직접 넣으면 출처가 직접 입력');
    await pg.click('#btn-coef-fit');
    ok(/최소제곱/.test(await pg.textContent('#fit-info')), '다시 맞추기');
    // 창 더하기 · 종류 바꾸기 · 닫기
    await pg.click('#btn-add');
    ok(await pg.$$eval('.panel', function (t) { return t.length; }) === 4, '창 더하기');
    await pg.selectOption('.panel[data-id="p4"] select', 'points');
    await pg.click('.panel[data-id="p4"] [data-del="p4"]');
    ok(await pg.$$eval('.panel', function (t) { return t.length; }) === 3, '창 닫기');
    // PNG · 엑셀
    var dl1 = await Promise.all([pg.waitForEvent('download', { timeout: 5000 }), pg.click('.panel[data-id="p1"] [data-png="p1"]')]);
    ok(/^3D_mesh_.*\.png$/.test(dl1[0].suggestedFilename()), '창 PNG 저장', dl1[0].suggestedFilename());
    var dl2 = await Promise.all([pg.waitForEvent('download', { timeout: 5000 }), pg.click('#btn-xlsx')]);
    var XLSX2 = require('../lib/xlsx.full.min.js'), wb2 = XLSX2.read(fs.readFileSync(await dl2[0].path()), { type: 'buffer' });
    ok(['점', '회귀계수', '회귀격자', '예측'].every(function (n) { return wb2.SheetNames.indexOf(n) >= 0; }), '엑셀 4시트', wb2.SheetNames.join(','));
    // 붙여넣기 경로
    await pg.fill('#paste', 'A\tB\tC\n0\t0\t1\n1\t0\t2\n0\t1\t2\n1\t1\t4\n2\t2\t9\n2\t0\t5\n0\t2\t5');
    await pg.click('#btn-paste');
    ok(/붙여 넣은 표 — 8줄/.test(await pg.textContent('#d-msg')), '붙여 넣은 표 읽기', await pg.textContent('#d-msg'));
    await pg.setViewportSize({ width: 360, height: 800 });
    var ov3 = await pg.evaluate(function () { return document.documentElement.scrollWidth - document.documentElement.clientWidth; });
    ok(ov3 <= 0, '360px 3D 작업실 가로 넘침 없음', ov3);
    await pg.setViewportSize({ width: 1280, height: 900 });
    await pg.goto(base + 'guide.html');
    ok(/3D 작업실/.test(await pg.textContent('main')), '사용법에 3D 작업실 절');
  } catch (e) { failed++; console.log('  X 예외: ' + e.message); }
  ok(!errs.length, '페이지 오류 없음', errs.join(' | '));
  await br.close(); srv.close();
  if (typeof v10 !== 'undefined') console.log('v1.0 ' + v10 + ' · v1.1 ' + (passed + failed - v10) + '개 검사');
  console.log('\n화면 통과 ' + passed + ' · 실패 ' + failed);
  process.exit(failed ? 1 : 0);
});
