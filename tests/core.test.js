// Known-answer tests for src/core.js. Run: node tests/core.test.js
'use strict';
var assert = require('assert');
var C = require('../src/core.js');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + (e && e.message)); }
}
function D(y, m, d) { return C.dayFromYMD(y, m, d); }          // CE date -> day number
function BE(d, m, y) { return C.dayFromYMD(y - 543, m, d); }    // B.E. date -> day number
function pd(s, o) { var r = C.parseDateText(s, o); return r.ok ? C.fmtISO(r.day) : 'ERR'; }
function pv(v, o) { var r = C.parseDateValue(v, o); return r.ok ? C.fmtISO(r.day) : 'ERR'; }
function pg(s, o) { var r = C.parseGA(s, o); return r.ok ? r.days : 'ERR'; }

/* ---------- The user's own examples ---------- */
test('example 1: LMP 1 Jul 2563, visit 1 Sep 2563 -> 8+6 (62 days)', function () {
  var ga = BE(1, 9, 2563) - BE(1, 7, 2563);
  assert.strictEqual(ga, 62);
  assert.strictEqual(C.fmtWD(ga), '8+6');
  assert.strictEqual(C.fmtWDThai(ga), '8 สัปดาห์ 6 วัน');
});
test('example 1: EDC by LMP = 7 Apr 2564', function () {
  assert.strictEqual(C.fmtDMYBE(C.edcFromLMP(BE(1, 7, 2563))), '07/04/2564');
});
test('example 1: US 1 Sep 2563 GA 7+5 -> EDC by US 15 Apr 2564, diff 8 days, first trimester, use US', function () {
  var a = C.assessDating({ lmp: BE(1, 7, 2563), usDate: BE(1, 9, 2563), usGA: 7 * 7 + 5 });
  assert.strictEqual(C.fmtDMYBE(a.edcUs), '15/04/2564');
  assert.strictEqual(a.diff, 8);
  assert.strictEqual(a.band.key, 'T1');
  assert.strictEqual(a.exceeds, true);
  assert.strictEqual(a.source, 'US');
  assert.strictEqual(C.fmtDMYBE(a.edcFinal), '15/04/2564');
  assert.strictEqual(C.fmtWD(C.gaOn(a.edcFinal, BE(1, 9, 2563))), '7+5');
});
test('example 2: LMP 1 Jun 2569 -> 17+2 on 30 Sep 2569, 17+3 on 1 Oct 2569, EDC 8 Mar 2570', function () {
  var lmp = BE(1, 6, 2569);
  assert.strictEqual(C.fmtWD(BE(30, 9, 2569) - lmp), '17+2');
  assert.strictEqual(C.fmtWD(BE(1, 10, 2569) - lmp), '17+3');
  assert.strictEqual(C.fmtDMYBE(C.edcFromLMP(lmp)), '08/03/2570');
});

/* ---------- Redating rule ---------- */
function assessWith(lmpGA, usGA) {
  var lmp = D(2026, 1, 1);
  return C.assessDating({ lmp: lmp, usDate: lmp + lmpGA, usGA: usGA });
}
test('T1: discrepancy of exactly 7 days keeps LMP, 8 days uses US', function () {
  assert.strictEqual(assessWith(10 * 7, 10 * 7 - 7).source, 'LMP');
  assert.strictEqual(assessWith(10 * 7, 10 * 7 - 8).source, 'US');
  assert.strictEqual(assessWith(10 * 7, 10 * 7 + 8).source, 'US');   // US larger than dates also counts
});
test('T2: 14 days keeps LMP, 15 days uses US', function () {
  assert.strictEqual(assessWith(20 * 7, 20 * 7 - 14).source, 'LMP');
  assert.strictEqual(assessWith(20 * 7, 20 * 7 - 15).source, 'US');
});
test('T3: 21 days keeps LMP, 22 days uses US with caution', function () {
  var keep = assessWith(32 * 7, 32 * 7 - 21);
  var redate = assessWith(32 * 7, 32 * 7 - 22);
  assert.strictEqual(keep.source, 'LMP');
  assert.strictEqual(keep.t3Caution, false);
  assert.strictEqual(redate.source, 'US');
  assert.strictEqual(redate.t3Caution, true);
});
test('band edges by GA from LMP: 13+6 T1, 14+0 T2, 27+6 T2, 28+0 T3', function () {
  assert.strictEqual(C.bandFor(13 * 7 + 6).key, 'T1');
  assert.strictEqual(C.bandFor(14 * 7).key, 'T2');
  assert.strictEqual(C.bandFor(27 * 7 + 6).key, 'T2');
  assert.strictEqual(C.bandFor(28 * 7).key, 'T3');
  assert.strictEqual(C.bandFor(-1), null);
});
test('band is chosen by LMP GA: LMP 14+2 vs US 12+6 (10 days) stays with LMP', function () {
  var a = assessWith(14 * 7 + 2, 12 * 7 + 6);
  assert.strictEqual(a.absDiff, 10);
  assert.strictEqual(a.band.key, 'T2');
  assert.strictEqual(a.source, 'LMP');
});
test('diff equals EDC_US minus EDC_LMP for many pairs', function () {
  for (var lg = 30; lg < 300; lg += 13) {
    for (var ug = 20; ug < 300; ug += 17) {
      var a = assessWith(lg, ug);
      assert.strictEqual(a.diff, a.edcUs - a.edcLmp);
    }
  }
});
test('US before LMP is an error with no final EDC', function () {
  var a = C.assessDating({ lmp: D(2026, 5, 1), usDate: D(2026, 4, 1), usGA: 60 });
  assert.deepStrictEqual(a.errors, ['US_BEFORE_LMP']);
  assert.strictEqual(a.edcFinal, null);
});
test('only LMP or only US', function () {
  assert.strictEqual(C.assessDating({ lmp: D(2026, 1, 1) }).source, 'LMP_ONLY');
  var u = C.assessDating({ usDate: D(2026, 3, 1), usGA: 56 });
  assert.strictEqual(u.source, 'US_ONLY');
  assert.strictEqual(u.edcFinal, D(2026, 3, 1) + 224);
  assert.strictEqual(C.assessDating({}).source, null);
});

/* ---------- Handout: การ Corrected date ทางสูติกรรม (2566), cases 1 to 5 ---------- */
test('handout case 1: LMP 9+1 vs US 10+0 keeps LMP', function () {
  var a = assessWith(9 * 7 + 1, 10 * 7);
  assert.strictEqual(a.absDiff, 6);
  assert.strictEqual(a.band.key, 'T1');
  assert.strictEqual(a.source, 'LMP');
});
test('handout case 2: LMP 16+4 vs US 19+1 uses US; EDC 7/10/2566 becomes 19/9/2566; 5 weeks later 24+1', function () {
  var visit = BE(26, 4, 2566);                  // the visit implied by EDC 7/10/2566 at GA 16+4
  var lmp = visit - (16 * 7 + 4);
  var a = C.assessDating({ lmp: lmp, usDate: visit, usGA: 19 * 7 + 1 });
  assert.strictEqual(C.fmtDMYBE(a.edcLmp), '07/10/2566');
  assert.strictEqual(C.fmtDMYBE(a.edcUs), '19/09/2566');
  assert.strictEqual(a.band.key, 'T2');
  assert.strictEqual(a.source, 'US');
  assert.strictEqual(C.fmtWD(C.gaOn(a.edcFinal, visit + 35)), '24+1');
});
test('handout case 3: no LMP, US 11+2 gives EDC 13/11/2566', function () {
  var a = C.assessDating({ usDate: BE(26, 4, 2566), usGA: 11 * 7 + 2 });
  assert.strictEqual(a.source, 'US_ONLY');
  assert.strictEqual(C.fmtDMYBE(a.edcFinal), '13/11/2566');
});
test('handout case 4: LMP 16+3 vs US 15+3 keeps LMP; next visit 15/5/66 is 17+3', function () {
  var v1 = BE(8, 5, 2566), lmp = v1 - (16 * 7 + 3);
  var a = C.assessDating({ lmp: lmp, usDate: v1, usGA: 15 * 7 + 3 });
  assert.strictEqual(a.source, 'LMP');
  assert.strictEqual(C.fmtWD(C.gaOn(a.edcFinal, BE(15, 5, 2566))), '17+3');
});
test('handout case 5: LMP 16+3 vs US 9+3 uses US; next visit 15/5/66 is 10+3', function () {
  var v1 = BE(8, 5, 2566), lmp = v1 - (16 * 7 + 3);
  var a = C.assessDating({ lmp: lmp, usDate: v1, usGA: 9 * 7 + 3 });
  assert.strictEqual(a.source, 'US');
  assert.strictEqual(C.fmtWD(C.gaOn(a.edcFinal, BE(15, 5, 2566))), '10+3');
});

/* ---------- Report line (format from the handout) ---------- */
function rl(lmp, usDate, usGA, visit, source, opts) {
  var a = C.assessDating({ lmp: lmp, usDate: usDate, usGA: usGA });
  var r = C.reportLine(a, visit, source, opts);
  return r ? r.text : null;
}
test('report case 1: GA 9+1 Wk by date = U/S at GA 9+1 wk', function () {
  var v = BE(1, 9, 2563), lmp = v - (9 * 7 + 1);
  assert.strictEqual(rl(lmp, v, 10 * 7, v), 'GA 9+1 Wk by date = U/S at GA 9+1 wk');
});
test('report case 2: U/S used, then 5 weeks later only the GA moves', function () {
  var v = BE(26, 4, 2566), lmp = v - (16 * 7 + 4);
  assert.strictEqual(rl(lmp, v, 19 * 7 + 1, v), 'GA 19+1 Wk by U/S ≠ date at GA 19+1 wk');
  assert.strictEqual(rl(lmp, v, 19 * 7 + 1, v + 35), 'GA 24+1 Wk by U/S ≠ date at GA 19+1 wk');
});
test('report case 3: LMP not remembered (ticked) vs simply not entered', function () {
  var v = BE(26, 4, 2566);
  assert.strictEqual(rl(null, v, 11 * 7 + 2, v, null, { uncertainDate: true }), 'GA 11+2 Wk by U/S at GA 11+2 wk due to uncertain date');
  assert.strictEqual(rl(null, v, 11 * 7 + 2, v), 'GA 11+2 Wk by U/S at GA 11+2 wk');
});
test('report case 4: second visit 15/5/66 keeps LMP', function () {
  var v1 = BE(8, 5, 2566), lmp = v1 - (16 * 7 + 3);
  assert.strictEqual(rl(lmp, v1, 15 * 7 + 3, BE(15, 5, 2566)), 'GA 17+3 Wk by date = U/S at GA 16+3 wk');
});
test('report case 5: second visit 15/5/66 uses U/S', function () {
  var v1 = BE(8, 5, 2566), lmp = v1 - (16 * 7 + 3);
  assert.strictEqual(rl(lmp, v1, 9 * 7 + 3, BE(15, 5, 2566)), 'GA 10+3 Wk by U/S ≠ date at GA 9+3 wk');
});
test('report: LMP only, doctor overrides, and impossible dates', function () {
  var lmp = BE(1, 6, 2569);
  assert.strictEqual(rl(lmp, null, null, BE(30, 9, 2569)), 'GA 17+2 Wk by date');
  var v = BE(26, 4, 2566), l2 = v - (16 * 7 + 4);
  assert.strictEqual(rl(l2, v, 19 * 7 + 1, v, 'LMP'), 'GA 16+4 Wk by date ≠ U/S at GA 16+4 wk');
  var l4 = BE(8, 5, 2566) - (16 * 7 + 3);
  assert.strictEqual(rl(l4, BE(8, 5, 2566), 15 * 7 + 3, BE(8, 5, 2566), 'US'), 'GA 15+3 Wk by U/S = date at GA 15+3 wk');
  assert.strictEqual(rl(lmp, null, null, lmp - 1), null);
  assert.strictEqual(rl(null, null, null, lmp), null);
  assert.strictEqual(rl(lmp, null, null, lmp + 44 * 7 + 6), 'GA 44+6 Wk by date');
  assert.strictEqual(rl(lmp, null, null, lmp + 45 * 7), null);
});

/* ---------- EDC from the ANC book ---------- */
test('Naegele calendar EDC', function () {
  assert.strictEqual(C.fmtISO(C.naegeleEDC(D(2020, 7, 1))), '2021-04-08');
  assert.strictEqual(C.fmtISO(C.naegeleEDC(D(2026, 6, 1))), '2027-03-08');
  assert.strictEqual(C.fmtISO(C.naegeleEDC(D(2021, 5, 1))), '2022-02-08');
  assert.strictEqual(C.fmtISO(C.naegeleEDC(D(2021, 5, 24))), '2022-02-28');   // 31 Feb clamps to month end
  assert.strictEqual(C.fmtISO(C.naegeleEDC(D(2023, 12, 25))), '2024-10-01');  // crosses the year
});
test('book EDC agrees with the EDC in use, or with LMP only (not corrected), or with Naegele', function () {
  var lmp = BE(6, 8, 2569), us = BE(1, 9, 2569);
  var a = C.assessDating({ lmp: lmp, usDate: us, usGA: 77 });
  assert.strictEqual(C.fmtDMYBE(a.edcLmp), '13/05/2570');
  assert.strictEqual(C.fmtDMYBE(a.edcUs), '23/03/2570');
  var ok = C.checkBookEDC(BE(23, 3, 2570), a, a.edcFinal, lmp);
  assert.strictEqual(ok.sameAsFinal, true);
  assert.strictEqual(ok.sameAsUs, true);
  var old = C.checkBookEDC(BE(13, 5, 2570), a, a.edcFinal, lmp);
  assert.strictEqual(old.diffFinal, 51);
  assert.strictEqual(old.sameAsLmp, true);
  assert.strictEqual(C.fmtWD(C.gaOn(BE(13, 5, 2570), BE(30, 9, 2569))), '7+6');
  assert.strictEqual(C.fmtWD(C.gaOn(BE(23, 3, 2570), BE(30, 9, 2569))), '15+1');
  var l2 = BE(1, 7, 2563), a2 = C.assessDating({ lmp: l2 });
  var nae = C.checkBookEDC(BE(8, 4, 2564), a2, a2.edcFinal, l2);
  assert.strictEqual(nae.diffFinal, 1);
  assert.strictEqual(nae.sameAsNaegele, true);
  var none = C.checkBookEDC(BE(8, 4, 2564), C.assessDating({}), null, null);
  assert.strictEqual(none.diffFinal, null);
});

/* ---------- Date parsing ---------- */
test('Thai numeric dates, day first, B.E. and C.E. years', function () {
  assert.strictEqual(pd('1/9/2563'), '2020-09-01');
  assert.strictEqual(pd('01/09/2563'), '2020-09-01');
  assert.strictEqual(pd('1-9-63'), '2020-09-01');
  assert.strictEqual(pd('1.9.2563'), '2020-09-01');
  assert.strictEqual(pd('1.9.63'), '2020-09-01');
  assert.strictEqual(pd('1 9 2563'), '2020-09-01');
  assert.strictEqual(pd('1/9/2020'), '2020-09-01');
  assert.strictEqual(pd('30/09/2569'), '2026-09-30');
  assert.strictEqual(pd('01/09/2563 00:00:00'), '2020-09-01');
});
test('digits-only dates', function () {
  assert.strictEqual(pd('01092563'), '2020-09-01');
  assert.strictEqual(pd('010963'), '2020-09-01');
  assert.strictEqual(pd('1092563'), '2020-09-01');
  assert.strictEqual(pd('25630901'), '2020-09-01');
  assert.strictEqual(pd('20200901'), '2020-09-01');
  assert.strictEqual(pd('20122563'), '2020-12-20');
});
test('ISO and month names', function () {
  assert.strictEqual(pd('2020-09-01'), '2020-09-01');
  assert.strictEqual(pd('2563-09-01'), '2020-09-01');
  assert.strictEqual(pd('1 ก.ย. 2563'), '2020-09-01');
  assert.strictEqual(pd('1 ก.ย. 63'), '2020-09-01');
  assert.strictEqual(pd('1ก.ย.63'), '2020-09-01');
  assert.strictEqual(pd('1 กันยายน 2563'), '2020-09-01');
  assert.strictEqual(pd('วันที่ 1 กันยายน พ.ศ. 2563'), '2020-09-01');
  assert.strictEqual(pd('อ. 1 ก.ย. 2563'), '2020-09-01');
  assert.strictEqual(pd('วันอังคารที่ 1 กันยายน 2563'), '2020-09-01');
  assert.strictEqual(pd('พฤ. 1 ต.ค. 2569'), '2026-10-01');
  assert.strictEqual(pd('1 พ.ย. 2569'), '2026-11-01');
  assert.strictEqual(pd('8 พฤศจิกายน 2569'), '2026-11-08');
  assert.strictEqual(pd('01-Sep-2020'), '2020-09-01');
  assert.strictEqual(pd('1 September 2020'), '2020-09-01');
  assert.strictEqual(pd('Sep 1 2020'), '2020-09-01');
  assert.strictEqual(pd('1 ก.ย. ค.ศ. 2020'), '2020-09-01');
  assert.strictEqual(pd('๑/๙/๒๕๖๓'), '2020-09-01');
});
test('impossible or unreadable dates are rejected', function () {
  assert.strictEqual(pd('31/2/2563'), 'ERR');
  assert.strictEqual(pd('29/2/2563'), '2020-02-29');
  assert.strictEqual(pd('29/2/2564'), 'ERR');
  assert.strictEqual(pd('1/13/2563'), 'ERR');
  assert.strictEqual(pd('abc'), 'ERR');
  assert.strictEqual(pd('1/9/0563'), 'ERR');
  assert.strictEqual(pd('1 ก.ย. ค.ศ. 2563'), 'ERR');
  assert.strictEqual(C.parseDateText('').empty, true);
  assert.strictEqual(C.parseDateText('   ').empty, true);
});
test('two-digit year setting', function () {
  assert.strictEqual(pd('1/9/63'), '2020-09-01');
  assert.strictEqual(pd('1/9/20', { twoDigitYear: 'CE' }), '2020-09-01');
});
test('Excel cell values: serials, B.E. serials, 1904 system, lost leading zero', function () {
  assert.strictEqual(pv(44075), '2020-09-01');
  assert.strictEqual(pv(44075.75), '2020-09-01');
  assert.strictEqual(pv(C.dayFromYMD(2563, 9, 1) + 25569), '2020-09-01');
  assert.strictEqual(pv(44075 - 1462, { date1904: true }), '2020-09-01');
  assert.strictEqual(pv(1092563), '2020-09-01');
  assert.strictEqual(pv(20200901), '2020-09-01');
  assert.strictEqual(pv('01/09/2563'), '2020-09-01');
  assert.strictEqual(C.parseDateValue(null).empty, true);
  assert.strictEqual(pv(11), 'ERR');       // a GA in weeks is not a date
  assert.strictEqual(pv(54), 'ERR');
});

/* ---------- GA parsing ---------- */
test('GA text formats', function () {
  assert.strictEqual(pg('7+5'), 54);
  assert.strictEqual(pg(' 7 + 5 '), 54);
  assert.strictEqual(pg('7w5d'), 54);
  assert.strictEqual(pg('7 wk 5 d'), 54);
  assert.strictEqual(pg('7 wks 5 days'), 54);
  assert.strictEqual(pg('7 สัปดาห์ 5 วัน'), 54);
  assert.strictEqual(pg('8 6/7'), 62);
  assert.strictEqual(pg('GA 7+5 by US'), 54);
  assert.strictEqual(pg('7'), 49);
  assert.strictEqual(pg(7), 49);
  assert.strictEqual(pg('54 d'), 54);
  assert.strictEqual(pg('54', { unit: 'days' }), 54);
  assert.strictEqual(pg('๗+๕'), 54);
});
test('GA decimals follow the chosen policy', function () {
  assert.strictEqual(pg('7.5'), 'ERR');
  assert.strictEqual(pg('7.5', { decimal: 'wd' }), 54);
  assert.strictEqual(pg('7.7', { decimal: 'wd' }), 'ERR');
  assert.strictEqual(pg('7.5', { decimal: 'weeks' }), 53);
  assert.strictEqual(pg(7.714285714, { decimal: 'weeks' }), 54);
});
test('GA out of range', function () {
  assert.strictEqual(pg('7+7'), 'ERR');
  assert.strictEqual(pg('45+0'), 'ERR');
  assert.strictEqual(pg('44+6'), 314);
  assert.strictEqual(pg('0+0'), 'ERR');
});

/* ---------- Formatting and today ---------- */
test('Thai formatting', function () {
  var d = D(2026, 9, 30);
  assert.strictEqual(C.fmtThai(d, true), 'พ. 30 ก.ย. 2569');
  assert.strictEqual(C.fmtThaiLong(d), 'วันพุธที่ 30 กันยายน พ.ศ. 2569');
  assert.strictEqual(C.fmtThai(D(2020, 9, 1), true), 'อ. 1 ก.ย. 2563');
  assert.strictEqual(C.fmtDMYBE(D(2027, 3, 8)), '08/03/2570');
});
test('local today and next midnight', function () {
  assert.strictEqual(C.localToday(new Date(2026, 8, 30, 23, 59, 30)), D(2026, 9, 30));
  assert.strictEqual(C.localToday(new Date(2026, 9, 1, 0, 0, 1)), D(2026, 10, 1));
  var ms = C.msUntilNextLocalMidnight(new Date(2026, 8, 30, 23, 59, 0));
  assert.ok(ms >= 60000 && ms <= 63000, 'ms=' + ms);
  assert.strictEqual(C.trimesterOf(13 * 7 + 6), 1);
  assert.strictEqual(C.trimesterOf(14 * 7), 2);
  assert.strictEqual(C.trimesterOf(28 * 7), 3);
});

/* ---------- CSV ---------- */
test('CSV parse: quotes, embedded commas and newlines, BOM, CRLF', function () {
  var rows = C.parseCSV('﻿id,note\r\nA1,"a, b"\r\nA2,"line1\nline2"\r\nA3,"say ""hi"""\r\n');
  assert.deepStrictEqual(rows, [['id', 'note'], ['A1', 'a, b'], ['A2', 'line1\nline2'], ['A3', 'say "hi"']]);
});
test('CSV parse: semicolon and tab delimiters', function () {
  assert.deepStrictEqual(C.parseCSV('a;b\n1;2\n'), [['a', 'b'], ['1', '2']]);
  assert.deepStrictEqual(C.parseCSV('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
});
test('CSV round trip', function () {
  var rows = [['id', 'LMP'], ['A,1', 'x "y"'], ['A2', ' lead']];
  assert.deepStrictEqual(C.parseCSV(C.toCSV(rows)), rows);
});
test('decode UTF-8 and Windows-874', function () {
  var utf = C.decodeText(Buffer.from('ก.ย.', 'utf8'));
  assert.strictEqual(utf.text, 'ก.ย.');
  assert.strictEqual(utf.encoding, 'UTF-8');
  var tis = C.decodeText(Uint8Array.from([0xA1, 0x2E, 0xC2, 0x2E]));
  assert.strictEqual(tis.text, 'ก.ย.');
  assert.strictEqual(tis.encoding, 'Windows-874');
});

/* ---------- Batch rows ---------- */
var MAP = { lmp: 1, usDate: 3, usGA: { mode: 'single', col: 4 }, dateCols: [2, 5] };
test('batch: example 1 row', function () {
  var r = C.processRow(['A001', '01/07/2563', '01/09/2563', '01/09/2563', '7+5', ''], MAP, {});
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.dating.source, 'US');
  assert.strictEqual(C.fmtDMYBE(r.dating.edcFinal), '15/04/2564');
  assert.strictEqual(r.gaAt[0].days, 54);
  var cells = C.outputCells(r, 2);
  assert.strictEqual(cells.length, C.outputHeaders(['a', 'b']).length);
  assert.strictEqual(cells[4].v, 8);
  assert.strictEqual(cells[8].v, '15/04/2564');
  assert.strictEqual(cells[10].v, '7+5');
});
test('batch: LMP only, US only, missing pieces, bad values', function () {
  var lmpOnly = C.processRow(['A2', '15/03/2564', '10/05/2564', '', '', ''], MAP, {});
  assert.strictEqual(lmpOnly.dating.source, 'LMP_ONLY');
  assert.strictEqual(C.fmtWD(lmpOnly.gaAt[0].days), '8+0');
  var usOnly = C.processRow(['A3', '', '20/01/2566', '20/01/2566', '11+2', ''], MAP, {});
  assert.strictEqual(usOnly.dating.source, 'US_ONLY');
  assert.strictEqual(C.fmtWD(usOnly.gaAt[0].days), '11+2');
  var noDate = C.processRow(['A4', '02/11/2565', '', '', '9+0', ''], MAP, {});
  assert.strictEqual(noDate.dating.source, 'LMP_ONLY');
  assert.ok(noDate.notes.join('|').indexOf('ไม่มีวันที่ US') >= 0);
  var bad = C.processRow(['A5', 'xx', '', '01/09/2563', '7.5', ''], MAP, {});
  assert.strictEqual(bad.status, 'error');
  assert.ok(bad.notes.length >= 2);
  var empty = C.processRow(['A6', '', '', '', '', ''], MAP, {});
  assert.strictEqual(empty.status, 'empty');
  assert.strictEqual(C.outputCells(empty, 2).length, C.outputHeaders(['a', 'b']).length);
});
test('batch: date before pregnancy and after 44 weeks produce notes', function () {
  var r = C.processRow(['A7', '01/01/2569', '01/12/2568', '', '', '30/12/2569'], MAP, {});
  assert.strictEqual(r.gaAt[0].days, null);
  assert.ok(r.notes.join('|').indexOf('อยู่ก่อนเริ่มตั้งครรภ์') >= 0);
  assert.ok(r.notes.join('|').indexOf('เกิน 44 สัปดาห์') >= 0);
});
test('batch: weeks and days in two columns, and GA in days', function () {
  var m2 = { lmp: 0, usDate: 1, usGA: { mode: 'wd', wCol: 2, dCol: 3 }, dateCols: [] };
  var r = C.processRow(['01/07/2563', '01/09/2563', 7, 5], m2, {});
  assert.strictEqual(r.usGA, 54);
  var m3 = { lmp: 0, usDate: 1, usGA: { mode: 'days', col: 2 }, dateCols: [] };
  assert.strictEqual(C.processRow(['01/07/2563', '01/09/2563', 54], m3, {}).usGA, 54);
});
test('batch: Excel serials and B.E. typed into non-Thai Excel', function () {
  var serialBE = C.dayFromYMD(2563, 7, 1) + 25569;
  var r = C.processRow(['A8', serialBE, 44075, 44075, '7+5', ''], MAP, {});
  assert.strictEqual(r.dating.source, 'US');
  assert.strictEqual(C.fmtDMYBE(r.dating.edcFinal), '15/04/2564');
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
