/* Preg Wheel UI. Depends on PregCore (core.js). SheetJS (window.XLSX) is optional and
 * only needed to read or write Excel files in the research tab. */
(function () {
  'use strict';
  var C = window.PregCore;
  var $ = function (id) { return document.getElementById(id); };

  /* ================================================================
   * Live "today"
   * The date is re-read from the device clock every 30 seconds, whenever the page
   * becomes visible or focused again, when it is restored from the back/forward
   * cache, and at local midnight. A page left open overnight moves to the new day
   * by itself, so the calculation never sticks on yesterday.
   * ================================================================ */
  var state = {
    today: C.localToday(),
    visitMode: 'today',   // 'today' follows the clock, 'fixed' is a date typed by the user
    visitFixed: null,
    visitErr: null,
    lmp: null, lmpErr: null,
    lmpUnknown: false,   // ticked: the woman cannot remember her LMP
    bookEdc: null, bookEdcErr: null,   // EDC copied from the ANC book, cross-check only
    usDate: null, usDateErr: null,
    usGA: null, usGAErr: null,
    override: 'auto'
  };
  var midnightTimer = null;
  var toastTimer = null;

  function visitDay() { return state.visitMode === 'today' ? state.today : state.visitFixed; }

  function checkToday(source) {
    var t = C.localToday();
    if (t !== state.today) {
      state.today = t;
      renderToday();
      if (state.visitMode === 'today') syncVisitField();
      recompute();
      toast('วันที่เปลี่ยนเป็น ' + C.fmtThai(t, true) + ' คำนวณใหม่แล้ว');
    }
    if (source !== 'interval') scheduleMidnight();
  }

  function scheduleMidnight() {
    clearTimeout(midnightTimer);
    midnightTimer = setTimeout(function () { checkToday('midnight'); }, C.msUntilNextLocalMidnight());
  }

  function renderToday() {
    $('today-text').textContent = C.fmtThai(state.today, true);
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 6000);
  }

  /* ================================================================
   * Clinic form
   * ================================================================ */
  function setEcho(id, kind, text) {
    var el = $(id);
    el.className = 'echo' + (kind ? ' ' + kind : '');
    el.textContent = text || '';
  }

  function parsePickerValue(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
    return m ? C.dayFromYMD(+m[1], +m[2], +m[3]) : null;
  }

  // Wires a text date field and its calendar picker. onValue(day|null, error|null)
  function bindDateField(textId, pickerId, onValue) {
    var el = $(textId), pk = $(pickerId);
    function handle(final) {
      var r = C.parseDateText(el.value, {});
      if (r.ok) {
        el.classList.remove('invalid');
        pk.value = C.fmtISO(r.day);
        onValue(r.day, null, false);
      } else if (r.empty) {
        el.classList.remove('invalid');
        onValue(null, null, true);
      } else {
        el.classList.toggle('invalid', final);
        onValue(null, final ? r.error : 'pending', false);
      }
    }
    // Only re-read on blur/change when the person actually typed; a field that
    // merely received focus (e.g. the visit date showing today) keeps its mode.
    el.addEventListener('input', function () { el.dataset.dirty = '1'; handle(false); });
    function commit() { if (el.dataset.dirty === '1') { el.dataset.dirty = ''; handle(true); } }
    el.addEventListener('change', commit);
    el.addEventListener('blur', commit);
    pk.addEventListener('change', function () {
      var day = parsePickerValue(pk.value);
      if (day == null) return;
      el.value = C.fmtDMYBE(day);
      handle(true);
    });
    return handle;
  }

  function syncVisitField() {
    var el = $('visit-date');
    if (document.activeElement !== el) { el.value = C.fmtDMYBE(state.today); el.dataset.dirty = ''; }
    $('visit-date-picker').value = C.fmtISO(state.today);
    el.classList.remove('invalid');
  }

  function setVisitMode(mode) {
    state.visitMode = mode;
    var chip = $('visit-mode');
    if (mode === 'today') {
      chip.className = 'chip live';
      chip.textContent = 'วันนี้ อัปเดตเองทุกวัน';
      $('visit-today').hidden = true;
      state.visitErr = null;
      syncVisitField();
    } else {
      chip.className = 'chip fixed';
      chip.textContent = 'กำหนดเอง';
      $('visit-today').hidden = false;
    }
    chip.title = mode === 'today'
      ? 'ใช้วันที่ปัจจุบันของเครื่อง และเปลี่ยนเองเมื่อข้ามวัน'
      : 'วันที่นี้ไม่เปลี่ยนตามวันจริง กด ใช้วันนี้ เพื่อกลับไปใช้วันปัจจุบัน';
  }

  var handleVisit = bindDateField('visit-date', 'visit-date-picker', function (day, err, empty) {
    if (empty) { setVisitMode('today'); recompute(); return; }
    if (state.visitMode !== 'fixed') setVisitMode('fixed');
    state.visitFixed = day;
    state.visitErr = err;
    recompute();
  });
  var handleLMP = bindDateField('lmp', 'lmp-picker', function (day, err) {
    state.lmp = day; state.lmpErr = err; recompute();
  });
  var handleUSDate = bindDateField('us-date', 'us-date-picker', function (day, err) {
    state.usDate = day; state.usDateErr = err; recompute();
  });
  var handleBook = bindDateField('book-edc', 'book-edc-picker', function (day, err) {
    state.bookEdc = day; state.bookEdcErr = err; recompute();
  });

  function readUSGA(final) {
    var wEl = $('us-w'), dEl = $('us-d');
    var ws = C.normalizeDigits(wEl.value).trim(), ds = C.normalizeDigits(dEl.value).trim();
    wEl.classList.remove('invalid'); dEl.classList.remove('invalid');
    if (!ws && !ds) { state.usGA = null; state.usGAErr = null; return; }
    // "7+5" or "7w5d" typed into the weeks box: split it into the two boxes
    if (/[^\d]/.test(ws)) {
      var p = C.parseGA(ws, {});
      if (p.ok) {
        var s = C.splitWD(p.days);
        wEl.value = String(s.w); dEl.value = String(s.d);
        state.usGA = p.days; state.usGAErr = null; return;
      }
      state.usGA = null; state.usGAErr = final ? 'พิมพ์สัปดาห์เป็นตัวเลข เช่น 7 แล้วใส่วันในช่องถัดไป' : 'pending';
      if (final) wEl.classList.add('invalid');
      return;
    }
    if (!ws) { state.usGA = null; state.usGAErr = final ? 'ใส่จำนวนสัปดาห์' : 'pending'; if (final) wEl.classList.add('invalid'); return; }
    var w = parseInt(ws, 10), d = ds ? parseInt(ds, 10) : 0;
    if (!/^\d+$/.test(ds || '0') || d > 6) {
      state.usGA = null; state.usGAErr = 'วันต้องเป็น 0 ถึง 6'; dEl.classList.add('invalid'); return;
    }
    if (w > 44) { state.usGA = null; state.usGAErr = 'สัปดาห์ต้องไม่เกิน 44'; wEl.classList.add('invalid'); return; }
    var r = C.gaFromWD(w, d);
    if (r.ok) { state.usGA = r.days; state.usGAErr = null; }
    else { state.usGA = null; state.usGAErr = r.error; wEl.classList.add('invalid'); }
  }
  ['us-w', 'us-d'].forEach(function (id) {
    $(id).addEventListener('input', function () { readUSGA(false); recompute(); });
    $(id).addEventListener('change', function () { readUSGA(true); recompute(); });
  });

  $('visit-today').addEventListener('click', function () { setVisitMode('today'); recompute(); });
  $('us-same').addEventListener('click', function () {
    var v = visitDay();
    if (v == null) return;
    $('us-date').value = C.fmtDMYBE(v);
    handleUSDate(true);
  });
  $('override').addEventListener('change', function () { state.override = this.value; recompute(); });

  function setLmpUnknown(on) {
    state.lmpUnknown = !!on;
    $('lmp-unknown').checked = state.lmpUnknown;
    $('lmp').disabled = state.lmpUnknown;
    $('lmp-picker').disabled = state.lmpUnknown;
  }
  $('lmp-unknown').addEventListener('change', function () { setLmpUnknown(this.checked); recompute(); });

  $('btn-clear').addEventListener('click', function () {
    ['lmp', 'us-date', 'us-w', 'us-d', 'book-edc'].forEach(function (id) { $(id).value = ''; $(id).classList.remove('invalid'); });
    ['lmp-picker', 'us-date-picker', 'book-edc-picker'].forEach(function (id) { $(id).value = ''; });
    state.lmp = state.usDate = state.usGA = state.bookEdc = null;
    state.lmpErr = state.usDateErr = state.usGAErr = state.bookEdcErr = null;
    state.override = 'auto'; $('override').value = 'auto';
    $('copy-fallback').hidden = true;
    setLmpUnknown(false);
    setVisitMode('today');
    recompute();
  });

  $('btn-example').addEventListener('click', function () {
    setLmpUnknown(false);
    $('visit-date').value = '01/09/2563'; handleVisit(true);
    $('lmp').value = '01/07/2563'; handleLMP(true);
    $('us-date').value = '01/09/2563'; handleUSDate(true);
    $('us-w').value = '7'; $('us-d').value = '5'; readUSGA(true);
    $('book-edc').value = '15/04/2564'; handleBook(true);
    state.override = 'auto'; $('override').value = 'auto';
    recompute();
  });

  /* ---------------- Rendering ---------------- */
  function gaCell(days) {
    if (days == null) return '';
    if (days < 0) return 'ก่อนเริ่มตั้งครรภ์';
    return C.fmtWD(days) + ' สัปดาห์';
  }

  function recompute() {
    var v = visitDay();
    var usPair = state.usDate != null && state.usGA != null;
    var lmp = state.lmpUnknown ? null : state.lmp;
    var a = C.assessDating({ lmp: lmp, usDate: usPair ? state.usDate : null, usGA: usPair ? state.usGA : null });
    var both = a.band != null;
    var final = a.edcFinal, source = a.source, manual = false;
    if (both && state.override === 'LMP') { final = a.edcLmp; source = 'LMP'; manual = a.source !== 'LMP'; }
    if (both && state.override === 'US') { final = a.edcUs; source = 'US'; manual = a.source !== 'US'; }

    renderVisitEcho(v);
    renderLMP(a, v);
    renderUS(a, v, usPair);
    renderSummary(a, v, final, source, manual);
    renderBook(a, v, final, lmp);
  }

  function renderVisitEcho(v) {
    if (state.visitMode === 'today') setEcho('visit-echo', 'ok', C.fmtThaiLong(state.today));
    else if (state.visitErr && state.visitErr !== 'pending') setEcho('visit-echo', 'err', state.visitErr + ' ลองพิมพ์แบบ 01/09/2563');
    else if (v != null) setEcho('visit-echo', 'ok', C.fmtThaiLong(v));
    else setEcho('visit-echo', '', '');
  }

  function renderLMP(a, v) {
    var out = $('lmp-out');
    if (state.lmpUnknown) {
      out.hidden = true;
      setEcho('lmp-echo', 'ok', 'จำประจำเดือนไม่ได้ ใช้อายุครรภ์จาก U/S แทน');
    } else if (state.lmp != null) {
      setEcho('lmp-echo', 'ok', C.fmtThaiLong(state.lmp));
      out.hidden = false;
      var gaEl = $('lmp-ga');
      if (v == null) gaEl.innerHTML = '<span class="warn-text">ใส่วันที่ตรวจ</span>';
      else if (v - state.lmp < 0) gaEl.innerHTML = '<span class="warn-text">วันที่ตรวจอยู่ก่อน LMP</span>';
      else gaEl.innerHTML = esc(C.fmtWDThai(v - state.lmp)) + ' <small>(' + (v - state.lmp) + ' วัน)</small>';
      $('lmp-edc').textContent = C.fmtThai(a.edcLmp, true);
    } else {
      out.hidden = true;
      if (state.lmpErr && state.lmpErr !== 'pending') setEcho('lmp-echo', 'err', state.lmpErr + ' ลองพิมพ์แบบ 01/06/2569');
      else if (!$('lmp').value.trim()) setEcho('lmp-echo', '', 'พิมพ์ได้หลายแบบ เช่น 1/6/2569, 1.6.69, 01062569 หรือ 1 มิ.ย. 69');
      else setEcho('lmp-echo', '', '');
    }
  }

  function renderUS(a, v, usPair) {
    if (state.usDate != null) setEcho('us-echo', 'ok', C.fmtThaiLong(state.usDate));
    else if (state.usDateErr && state.usDateErr !== 'pending') setEcho('us-echo', 'err', state.usDateErr);
    else if (state.usGA != null) setEcho('us-echo', 'err', 'ใส่วันที่ทำ US ด้วย');
    else setEcho('us-echo', '', '');

    if (state.usGAErr && state.usGAErr !== 'pending') setEcho('usga-echo', 'err', state.usGAErr);
    else if (state.usGA != null) setEcho('usga-echo', 'ok', C.fmtWDThai(state.usGA) + ' (' + state.usGA + ' วัน)');
    else if (state.usDate != null) setEcho('usga-echo', 'err', 'ใส่ GA ที่ได้จาก US');
    else setEcho('usga-echo', '', '');

    var out = $('us-out');
    out.hidden = !usPair;
    if (usPair) {
      var gaEl = $('us-ga-visit');
      if (v == null) gaEl.innerHTML = '<span class="warn-text">ใส่วันที่ตรวจ</span>';
      else {
        var g = state.usGA + (v - state.usDate);
        gaEl.innerHTML = g < 0 ? '<span class="warn-text">วันที่ตรวจอยู่ก่อนเริ่มตั้งครรภ์</span>'
          : esc(C.fmtWDThai(g)) + ' <small>(' + g + ' วัน)</small>';
      }
      $('us-edc').textContent = C.fmtThai(a.edcUs, true);
    }
  }

  var SOURCE_LABEL = {
    LMP: 'ตาม LMP ผลต่างไม่เกินเกณฑ์',
    US: 'ตาม US ผลต่างเกินเกณฑ์',
    LMP_ONLY: 'ตาม LMP',
    US_ONLY: 'ตาม US (ไม่มี LMP)'
  };

  function renderSummary(a, v, final, source, manual) {
    var gaEl = $('res-ga'), sub = $('res-sub'), label = $('res-label');
    var verdict = $('verdict'), compare = $('compare');
    var both = a.band != null;
    $('override-wrap').hidden = !both;
    $('btn-copy').hidden = final == null;
    $('copy-status').textContent = '';

    label.textContent = v != null
      ? 'อายุครรภ์ ณ ' + C.fmtThai(v, true) + (state.visitMode === 'today' ? ' (วันนี้)' : '')
      : 'อายุครรภ์ ณ วันที่ตรวจ';

    var ga = null;
    if (final == null) {
      $('edc-box').hidden = true;
      if (state.lmpUnknown) {
        gaEl.innerHTML = '<span class="empty-note">ใส่ผล U/S</span>';
        sub.textContent = 'จำประจำเดือนไม่ได้ ต้องใช้ U/S กำหนดอายุครรภ์';
      } else {
        gaEl.innerHTML = '<span class="empty-note">ใส่ LMP หรือผล US</span>';
        sub.textContent = 'ผล GA, EDC และการเทียบ LMP กับ US จะขึ้นตรงนี้';
      }
    } else {
      $('edc-box').hidden = false;
      $('res-edc').textContent = C.fmtThai(final, true);
      var srcText = manual ? 'ตาม ' + source + ' (แพทย์เลือกเอง)'
        : (source === 'US_ONLY' && state.lmpUnknown ? 'ตาม U/S (จำประจำเดือนไม่ได้)'
          : (a.lmpConflict ? 'ตาม US (' + C.LMP_CONFLICT_TEXT[a.lmpConflict] + ')' : SOURCE_LABEL[source]));
      var countText = '';
      if (v != null) {
        var left = final - v;
        var from = state.visitMode === 'today' ? '' : ' นับจากวันที่ตรวจ';
        if (left > 0) countText = 'อีก ' + left + ' วัน' + from;
        else if (left === 0) countText = 'ครบกำหนดในวันที่ตรวจ';
        else countText = 'เลยกำหนด ' + (-left) + ' วัน' + from;
      }
      $('res-src').textContent = srcText + (countText ? ' · ' + countText : '');
      if (v == null) {
        gaEl.innerHTML = '<span class="empty-note">ใส่วันที่ตรวจให้ถูกต้อง</span>';
        sub.textContent = '';
      } else {
        ga = C.gaOn(final, v);
        if (ga < 0) {
          gaEl.innerHTML = '<span class="empty-note">ยังไม่ถึงวันเริ่มตั้งครรภ์</span>';
          sub.textContent = 'วันที่ตรวจอยู่ก่อนวันเริ่มต้นของ EDC ที่ใช้';
          ga = null;
        } else {
          var p = C.splitWD(ga);
          gaEl.innerHTML = p.w + '<small>สัปดาห์</small>' + p.d + '<small>วัน</small>';
          var extra = '';
          if (ga > C.WARN_GA_DAYS) extra = ' · เกิน 44 สัปดาห์ ตรวจสอบวันที่';
          sub.textContent = 'ไตรมาสที่ ' + C.trimesterOf(ga) + ' · ' + ga + ' วัน' + extra;
        }
      }
    }

    // Verdict: only when both LMP and US are present
    if (a.lmpConflict) {
      // LMP cannot date this pregnancy: U/S is used, with the note the user asked for
      verdict.hidden = false;
      verdict.className = 'verdict redate';
      var note = '<h3>ใช้ EDC จาก US</h3>' +
        '<p class="caution">หมายเหตุ: ' + esc(C.LMP_CONFLICT_TEXT[a.lmpConflict]) + '</p>' +
        '<p>วันที่ทำ US ' + esc(C.fmtThai(a.usDate, true)) + ' GA จาก US ' + C.fmtWD(a.usGA) + ' สัปดาห์ · LMP ' + esc(C.fmtThai(a.lmp, true)) + '</p>';
      if (a.t3Caution) note += '<p class="caution">' + esc(C.T3_CAUTION) + '</p>';
      verdict.innerHTML = note;
    } else if (both) {
      verdict.hidden = false;
      verdict.className = 'verdict ' + (a.exceeds ? 'redate' : 'keep');
      var dir = a.diff > 0 ? ' ทารกวัดได้เล็กกว่าอายุครรภ์ตาม LMP' : (a.diff < 0 ? ' ทารกวัดได้ใหญ่กว่าอายุครรภ์ตาม LMP' : '');
      var html = '<h3>' + (a.exceeds ? 'เกินเกณฑ์ ใช้ EDC จาก US' : 'ไม่เกินเกณฑ์ ใช้ EDC จาก LMP') + '</h3>' +
        '<p>GA ตาม LMP ณ วันทำ US ' + C.fmtWD(a.gaLmpAtUs) + ' สัปดาห์ (' + a.band.name + ') GA จาก US ' + C.fmtWD(a.usGA) + ' สัปดาห์</p>' +
        '<p>ต่างกัน ' + a.absDiff + ' วัน' + dir + ' เกณฑ์' + a.band.name + ' คือต่างกันเกิน ' + a.band.thresholdDays + ' วันให้ยึด US</p>';
      if (a.t3Caution) html += '<p class="caution">' + esc(C.T3_CAUTION) + '</p>';
      if (manual) html += '<p class="caution">แพทย์เลือกใช้ EDC จาก ' + source + ' แทนผลตามเกณฑ์</p>';
      verdict.innerHTML = html;
    } else {
      verdict.hidden = true;
    }

    // Comparison table when both methods exist
    compare.hidden = !(a.edcLmp != null && a.edcUs != null);
    if (!compare.hidden) {
      var rows = { LMP: $('cmp-lmp'), US: $('cmp-us') };
      var gaL = v != null ? v - state.lmp : null;
      var gaU = v != null ? state.usGA + (v - state.usDate) : null;
      fillCompare(rows.LMP, gaL, a.edcLmp, final === a.edcLmp && (source === 'LMP' || source === 'LMP_ONLY'));
      fillCompare(rows.US, gaU, a.edcUs, final === a.edcUs && (source === 'US' || source === 'US_ONLY'));
    }

    var report = C.reportLine(a, v, source, { uncertainDate: state.lmpUnknown });
    renderReport(a, report, source);

    drawNeedle(ga, final != null && ga == null && v != null);
    lastSummary = { a: a, v: v, final: final, source: source, manual: manual, ga: ga, report: report };
  }

  function fillCompare(tr, ga, edc, chosen) {
    tr.className = chosen ? 'chosen' : '';
    tr.cells[1].textContent = gaCell(ga);
    tr.cells[2].innerHTML = esc(C.fmtThai(edc, true)) + (chosen ? '<span class="tag">ใช้</span>' : '');
  }

  /* ---------------- EDC written in the ANC book ---------------- */
  function renderBook(a, v, final, lmp) {
    var out = $('book-out');
    if (state.bookEdc == null) {
      out.hidden = true;
      if (state.bookEdcErr && state.bookEdcErr !== 'pending') setEcho('book-echo', 'err', state.bookEdcErr + ' ลองพิมพ์แบบ 23/03/2570');
      else setEcho('book-echo', '', '');
      return;
    }
    setEcho('book-echo', 'ok', C.fmtThaiLong(state.bookEdc) + ' (เทียบเท่า LMP ' + C.fmtDMYBE(state.bookEdc - C.DAYS_LMP_TO_EDC) + ')');
    out.hidden = false;
    var gaEl = $('book-ga');
    if (v == null) gaEl.innerHTML = '<span class="warn-text">ใส่วันที่ตรวจ</span>';
    else {
      var g = C.gaOn(state.bookEdc, v);
      if (g < 0) gaEl.innerHTML = '<span class="warn-text">วันที่ตรวจอยู่ก่อนเริ่มตั้งครรภ์ ตรวจสอบปี พ.ศ.</span>';
      else if (g > C.MAX_GA_DAYS) gaEl.innerHTML = '<span class="warn-text">เกิน 44 สัปดาห์ ตรวจสอบปี พ.ศ.</span>';
      else gaEl.innerHTML = esc(C.fmtWDThai(g)) + ' <small>(' + g + ' วัน)</small>';
    }
    var el = $('book-check');
    if (final == null) {
      el.innerHTML = '<small>ยังไม่มี EDC จาก LMP หรือ U/S ให้เทียบ</small>';
      return;
    }
    var chk = C.checkBookEDC(state.bookEdc, a, final, lmp);
    if (chk.sameAsFinal) {
      el.innerHTML = '<span class="book-ok">ตรงกัน</span>';
      return;
    }
    var html = '<span class="book-warn">ต่างกัน ' + Math.abs(chk.diffFinal) + ' วัน</span> <small>(GA ตามสมุด' +
      (chk.diffFinal > 0 ? 'น้อยกว่า' : 'มากกว่า') + ')</small>';
    var why = '';
    if (chk.sameAsLmp) why = 'ตรงกับ EDC ตาม LMP อาจยังไม่ได้แก้ตาม U/S';
    else if (chk.sameAsUs) why = 'ตรงกับ EDC ตาม U/S';
    else if (chk.sameAsNaegele) why = 'ตรงกับการนับแบบ Naegele (+7 วัน ลบ 3 เดือน) ส่วนระบบใช้ LMP + 280 วัน';
    if (why) html += '<span class="book-note">' + esc(why) + '</span>';
    el.innerHTML = html;
  }

  /* ---------------- Report line ---------------- */
  function wdSup(days) {
    var p = C.splitWD(days);
    return p.w + '<sup>+' + p.d + '</sup>';
  }

  function renderReport(a, r, source) {
    var box = $('report');
    $('report-copy-status').textContent = '';
    if (!r) { box.hidden = true; return; }
    box.hidden = false;
    var dating = esc(r.dating);
    if (r.atDays != null) dating = dating.replace(C.fmtWD(r.atDays), wdSup(r.atDays));
    $('report-line').innerHTML = '<span class="rep-ga">GA ' + wdSup(r.gaDays) + ' Wk</span> <span class="rep-date">' + dating + '</span>';
    var edc = $('report-edc');
    if (source === 'US' && a.edcLmp != null && a.edcLmp !== a.edcUs) {
      edc.innerHTML = 'EDC ' + esc(C.fmtDMYBE(a.edcUs)) + ' ตาม U/S <span class="fix">แก้จาก EDC ตาม LMP ' + esc(C.fmtDMYBE(a.edcLmp)) + '</span>';
    } else if (source === 'US' || source === 'US_ONLY') {
      edc.textContent = 'EDC ' + C.fmtDMYBE(a.edcUs) + ' ตาม U/S';
    } else {
      edc.textContent = 'EDC ' + C.fmtDMYBE(a.edcLmp) + ' ตาม LMP';
    }
  }

  function selectText(el) {
    try {
      var range = document.createRange();
      range.selectNodeContents(el);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) { /* selection unavailable */ }
  }

  $('btn-copy-report').addEventListener('click', function () {
    var s = lastSummary, status = $('report-copy-status');
    if (!s || !s.report) return;
    var text = s.report.text;
    function fallback() {
      selectText($('report-line'));
      status.textContent = 'เลือกข้อความให้แล้ว กด Ctrl+C เพื่อคัดลอก';
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { status.textContent = 'คัดลอกแล้ว'; }, fallback);
      } else fallback();
    } catch (e) { fallback(); }
  });

  /* ---------------- Wheel ---------------- */
  var SVGNS = 'http://www.w3.org/2000/svg';
  var WH = { cx: 110, cy: 110, r: 94, w: 14 };
  var wheelParts = {};

  function pol(r, deg) {
    var a = deg * Math.PI / 180;
    return [WH.cx + r * Math.sin(a), WH.cy - r * Math.cos(a)];
  }
  function arcPath(r, a0, a1) {
    var p0 = pol(r, a0), p1 = pol(r, a1);
    return 'M' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2) + ' A' + r + ' ' + r + ' 0 ' +
      ((a1 - a0) > 180 ? 1 : 0) + ' 1 ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2);
  }
  function svgEl(parent, tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    parent.appendChild(e);
    return e;
  }
  function daysToDeg(d) { return d / C.DAYS_LMP_TO_EDC * 360; }

  function buildWheel() {
    var svg = $('wheel');
    svgEl(svg, 'circle', { cx: WH.cx, cy: WH.cy, r: WH.r - WH.w / 2, 'class': 'face' });
    svgEl(svg, 'circle', { cx: WH.cx, cy: WH.cy, r: WH.r, 'class': 'ring-bg', 'stroke-width': WH.w });
    var gap = 0.9;
    svgEl(svg, 'path', { d: arcPath(WH.r, gap, daysToDeg(98) - gap), 'class': 'arc1', 'stroke-width': WH.w });
    svgEl(svg, 'path', { d: arcPath(WH.r, daysToDeg(98) + gap, daysToDeg(196) - gap), 'class': 'arc2', 'stroke-width': WH.w });
    svgEl(svg, 'path', { d: arcPath(WH.r, daysToDeg(196) + gap, 360 - gap), 'class': 'arc3', 'stroke-width': WH.w });
    var inner = WH.r - WH.w / 2;
    for (var wk = 0; wk < 40; wk++) {
      var major = wk % 4 === 0;
      var deg = wk * 9;
      var p0 = pol(inner - (major ? 8 : 4), deg), p1 = pol(inner - 1, deg);
      svgEl(svg, 'line', { x1: p0[0].toFixed(2), y1: p0[1].toFixed(2), x2: p1[0].toFixed(2), y2: p1[1].toFixed(2),
        'class': 'tick' + (major ? ' major' : ''), 'stroke-width': major ? 1.4 : 1 });
      if (major) {
        var lp = pol(inner - 17, deg);
        var t = svgEl(svg, 'text', { x: lp[0].toFixed(2), y: lp[1].toFixed(2), 'class': 'lbl', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
        t.textContent = wk === 0 ? '40' : String(wk);
      }
    }
    var g = svgEl(svg, 'g', { 'class': 'needle-g' });
    var tip = pol(inner - 2, 0), base = pol(inner - 24, 0);
    svgEl(g, 'line', { x1: base[0], y1: base[1], x2: tip[0], y2: tip[1], 'class': 'needle' });
    var dot = pol(WH.r, 0);
    svgEl(g, 'circle', { cx: dot[0], cy: dot[1], r: 8, 'class': 'tipdot' });
    wheelParts.needle = g;
    wheelParts.big = svgEl(svg, 'text', { x: WH.cx, y: WH.cy - 2, 'class': 'center-big', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    wheelParts.small = svgEl(svg, 'text', { x: WH.cx, y: WH.cy + 22, 'class': 'center-small', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
  }

  function drawNeedle(ga, invalid) {
    var title = $('wheel-title');
    if (ga == null) {
      wheelParts.needle.style.visibility = 'hidden';
      wheelParts.big.textContent = '';
      wheelParts.small.textContent = invalid ? 'ตรวจสอบวันที่' : 'ยังไม่มีข้อมูล';
      title.textContent = 'วงล้ออายุครรภ์ ยังไม่มีข้อมูล';
      return;
    }
    var deg = Math.min(ga, C.DAYS_LMP_TO_EDC) / C.DAYS_LMP_TO_EDC * 360;
    wheelParts.needle.style.visibility = 'visible';
    wheelParts.needle.style.transform = 'rotate(' + deg.toFixed(2) + 'deg)';
    wheelParts.big.textContent = C.fmtWD(ga);
    wheelParts.small.textContent = ga > C.DAYS_LMP_TO_EDC ? 'เลยกำหนดคลอด' : 'สัปดาห์+วัน';
    title.textContent = 'วงล้ออายุครรภ์ ' + C.fmtWDThai(ga);
  }

  /* ---------------- Copy summary ---------------- */
  var lastSummary = null;
  function summaryText() {
    var s = lastSummary;
    if (!s || s.final == null) return '';
    var a = s.a, v = s.v, lines = [];
    if (s.report) lines.push(s.report.text);
    if (v != null) lines.push('วันที่ตรวจ ' + C.fmtDMYBE(v));
    if (state.lmpUnknown) lines.push('LMP จำไม่ได้ (uncertain date)');
    if (a.edcLmp != null) {
      lines.push('LMP ' + C.fmtDMYBE(state.lmp) + (v != null && v >= state.lmp ? ' GA ' + C.fmtWD(v - state.lmp) + ' wk' : '') + ' EDC(LMP) ' + C.fmtDMYBE(a.edcLmp));
    }
    if (a.edcUs != null) {
      lines.push('US ' + C.fmtDMYBE(state.usDate) + ' GA ' + C.fmtWD(state.usGA) + ' wk EDC(US) ' + C.fmtDMYBE(a.edcUs));
    }
    if (a.band) {
      lines.push('ผลต่าง ' + a.absDiff + ' วัน (' + a.band.name + ' เกณฑ์เกิน ' + a.band.thresholdDays + ' วัน) ' +
        (a.exceeds ? 'ใช้ EDC จาก US' : 'ใช้ EDC จาก LMP') + (s.manual ? ' แพทย์เลือก ' + s.source + ' เอง' : ''));
    }
    if (a.lmpConflict) lines.push('หมายเหตุ: ' + C.LMP_CONFLICT_TEXT[a.lmpConflict] + ' ใช้ EDC จาก US');
    lines.push('EDC ที่ใช้ ' + C.fmtDMYBE(s.final) + (s.ga != null ? ' GA ณ วันตรวจ ' + C.fmtWD(s.ga) + ' wk' : ''));
    if (state.bookEdc != null) {
      var bg = v != null ? C.gaOn(state.bookEdc, v) : null;
      var diff = state.bookEdc - s.final;
      lines.push('EDC ในสมุด ' + C.fmtDMYBE(state.bookEdc) + (bg != null && bg >= 0 ? ' GA ' + C.fmtWD(bg) + ' wk' : '') +
        (diff === 0 ? ' ตรงกับ EDC ที่ใช้' : ' ต่างจาก EDC ที่ใช้ ' + Math.abs(diff) + ' วัน'));
    }
    return lines.join('\n');
  }
  $('btn-copy').addEventListener('click', function () {
    var text = summaryText(), status = $('copy-status'), fb = $('copy-fallback');
    function fallback() {
      fb.hidden = false; fb.value = text; fb.focus(); fb.select();
      status.textContent = 'กด Ctrl+C หรือคัดลอกจากกล่องด้านล่าง';
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { fb.hidden = true; status.textContent = 'คัดลอกแล้ว'; }, fallback);
      } else fallback();
    } catch (e) { fallback(); }
  });

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  /* ================================================================
   * Tabs
   * ================================================================ */
  function selectTab(name) {
    var clinic = name !== 'research';
    $('tab-clinic').setAttribute('aria-selected', String(clinic));
    $('tab-research').setAttribute('aria-selected', String(!clinic));
    $('panel-clinic').hidden = !clinic;
    $('panel-research').hidden = clinic;
    try { localStorage.setItem('pregwheel-tab', clinic ? 'clinic' : 'research'); } catch (e) { /* storage unavailable */ }
    if (!clinic) Research.ensure();
  }
  $('tab-clinic').addEventListener('click', function () { selectTab('clinic'); });
  $('tab-research').addEventListener('click', function () { selectTab('research'); });
  document.querySelector('.tabs').addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    var toResearch = $('tab-clinic').getAttribute('aria-selected') === 'true';
    selectTab(toResearch ? 'research' : 'clinic');
    $(toResearch ? 'tab-research' : 'tab-clinic').focus();
  });

  /* ================================================================
   * Downloads: the claude.ai viewer grants saves through the `downloads`
   * capability; a standalone copy of the page falls back to a normal link.
   * ================================================================ */
  var downloadsPromise = null;
  function inViewer() { return !!(window.claude && typeof window.claude.use === 'function'); }
  function getDownloads() {
    if (!downloadsPromise) {
      downloadsPromise = inViewer()
        ? Promise.resolve(window.claude.use('downloads')).catch(function () { return null; })
        : Promise.resolve(null);
    }
    return downloadsPromise;
  }
  getDownloads();

  function setStatus(el, kind, text) { el.className = 'dl-status' + (kind ? ' ' + kind : ''); el.textContent = text; }

  function offerDownload(filename, data, statusEl) {
    setStatus(statusEl, '', 'กำลังเตรียมไฟล์');
    return getDownloads().then(function (dl) {
      if (dl) {
        return dl.save({ filename: filename, data: data }).then(function () {
          setStatus(statusEl, 'ok', 'บันทึก ' + filename + ' แล้ว');
        }, function (err) {
          var code = err && err.code;
          if (code === 'declined') setStatus(statusEl, '', 'ยกเลิกการบันทึก');
          else if (code === 'rate_limited') setStatus(statusEl, 'err', 'มีหน้าต่างบันทึกเปิดอยู่ ลองอีกครั้งในไม่กี่วินาที');
          else setStatus(statusEl, 'err', 'บันทึกไฟล์ไม่ได้ในหน้านี้ (' + (code || 'error') + ')');
        });
      }
      if (inViewer()) {
        setStatus(statusEl, 'err', 'หน้านี้บันทึกไฟล์ไม่ได้ ลองเปิดไฟล์ index.html ในเครื่องแทน');
        return;
      }
      var blob = data instanceof Blob ? data : new Blob([data], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url; link.download = filename; link.rel = 'noopener';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 15000);
      setStatus(statusEl, 'ok', 'ดาวน์โหลด ' + filename);
    });
  }

  /* ================================================================
   * Research tab
   * ================================================================ */
  var SAMPLE_CSV = [
    'id,LMP,วันที่ฝากครรภ์,วันที่ US,GA จาก US,วันที่เจาะ Hct ครั้งที่ 2,วันคลอด',
    'A001,01/07/2563,01/09/2563,01/09/2563,7+5,15/12/2563,10/04/2564',
    'A002,15/03/2564,10/05/2564,,,02/09/2564,18/12/2564',
    'A003,02/11/2565,20/01/2566,20/01/2566,11+2,05/05/2566,03/08/2566',
    'A004,10/01/2566,20/05/2566,20/05/2566,16+0,01/07/2566,25/10/2566',
    'A005,05/02/2567,15/09/2567,15/09/2567,28+0,,01/11/2567',
    'A006,,12/08/2568,12/08/2568,9+3,20/11/2568,',
    'A007,31/02/2567,01/05/2567,,,,'
  ].join('\r\n');

  var Research = (function () {
    var R = { src: null, sheet: 0, header: 0, cols: [], mapping: null, results: [], byIdx: {} };
    var ready = false;

    function colLetter(i) {
      var s = '';
      i += 1;
      while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
      return s;
    }
    function maxCols(rows) { return rows.reduce(function (m, r) { return Math.max(m, r ? r.length : 0); }, 0); }
    function cur() { return R.src.sheets[R.sheet]; }

    function sheetFromWorksheet(ws, X, date1904) {
      var ref = ws['!ref'];
      if (!ref) return { rows: [], text: [], r0: 0, c0: 0 };
      var rg = X.utils.decode_range(ref);
      var lastC = Math.min(rg.e.c, rg.s.c + 299), lastR = Math.min(rg.e.r, rg.s.r + 299999);
      var rows = [], text = [];
      for (var r = rg.s.r; r <= lastR; r++) {
        var row = [], trow = [];
        for (var c = rg.s.c; c <= lastC; c++) {
          var cell = ws[X.utils.encode_cell({ r: r, c: c })];
          if (!cell || cell.v == null || cell.t === 'z') { row.push(null); trow.push(''); continue; }
          if (cell.t === 'e') { row.push(null); trow.push(cell.w || ''); continue; }
          row.push(cell.v);
          if (cell.t === 'n' && cell.z && X.SSF && X.SSF.is_date(cell.z)) {
            trow.push(C.fmtISO(Math.floor(cell.v) - 25569 + (date1904 ? 1462 : 0)));
          } else {
            trow.push(cell.w != null ? String(cell.w) : String(cell.v));
          }
        }
        rows.push(row); text.push(trow);
      }
      // trim trailing empty rows
      while (rows.length && rows[rows.length - 1].every(function (v) { return C.isEmptyCell(v); })) { rows.pop(); text.pop(); }
      return { rows: rows, text: text, r0: rg.s.r, c0: rg.s.c };
    }

    function loadSample() {
      var rows = C.parseCSV(SAMPLE_CSV);
      setSource({ kind: 'csv', name: 'ตัวอย่าง', sample: true, encoding: 'UTF-8',
        sheets: [{ name: 'CSV', rows: rows, text: rows, r0: 0, c0: 0 }] });
    }

    function readFile(file) {
      var info = $('file-info');
      info.textContent = 'กำลังอ่าน ' + file.name;
      file.arrayBuffer().then(function (buf) {
        var lower = file.name.toLowerCase();
        var base = file.name.replace(/\.[^.]+$/, '');
        if (/\.(csv|txt)$/.test(lower)) {
          var dec = C.decodeText(new Uint8Array(buf));
          var rows = C.parseCSV(dec.text);
          setSource({ kind: 'csv', name: base, fileName: file.name, encoding: dec.encoding,
            sheets: [{ name: 'CSV', rows: rows, text: rows, r0: 0, c0: 0 }] });
          return;
        }
        var X = window.XLSX;
        if (!X) {
          info.innerHTML = '<span class="err-text">ยังโหลดตัวอ่าน Excel ไม่ได้ ตรวจการเชื่อมต่ออินเทอร์เน็ต หรือบันทึกไฟล์เป็น .csv แล้วลองใหม่</span>';
          return;
        }
        var wb = X.read(new Uint8Array(buf), { type: 'array', cellNF: true, cellDates: false, cellText: true });
        var date1904 = !!(wb.Workbook && wb.Workbook.WBProps && wb.Workbook.WBProps.date1904);
        var sheets = wb.SheetNames.map(function (n) {
          var s = sheetFromWorksheet(wb.Sheets[n], X, date1904);
          s.name = n;
          return s;
        });
        setSource({ kind: 'xlsx', name: base, fileName: file.name, wb: wb, date1904: date1904, sheets: sheets });
      }).catch(function (e) {
        info.innerHTML = '<span class="err-text">อ่านไฟล์ไม่ได้: ' + esc(e && e.message ? e.message : String(e)) + '</span>';
      });
    }

    function setSource(src) {
      R.src = src;
      R.sheet = 0;
      if (src.kind === 'xlsx') {
        var best = 0;
        src.sheets.forEach(function (s, i) { if (s.rows.length > src.sheets[best].rows.length) best = i; });
        R.sheet = best;
      }
      var sel = $('sheet');
      sel.innerHTML = '';
      src.sheets.forEach(function (s, i) {
        var o = document.createElement('option');
        o.value = String(i); o.textContent = s.name; sel.appendChild(o);
      });
      sel.value = String(R.sheet);
      $('sheet-wrap').hidden = src.sheets.length < 2;
      setupSheet();
    }

    function detectHeader(rows) {
      for (var i = 0; i < Math.min(rows.length, 30); i++) {
        var r = rows[i] || [];
        var filled = r.filter(function (v) { return !C.isEmptyCell(v); });
        var texty = filled.filter(function (v) { return typeof v === 'string' && !/^[\d\s.\/+-]+$/.test(v); });
        if (filled.length >= 2 && texty.length >= Math.ceil(filled.length / 2)) return i;
      }
      return 0;
    }

    function setupSheet() {
      var sh = cur();
      R.header = detectHeader(sh.rows);
      $('header-row').value = String(sh.r0 + R.header + 1);
      buildColumns();
      autoMap();
      renderMapping();
      renderFileInfo();
      run();
    }

    function buildColumns() {
      var sh = cur();
      var n = maxCols(sh.rows.slice(R.header));
      var hdr = sh.text[R.header] || [];
      R.cols = [];
      for (var j = 0; j < n; j++) {
        var name = hdr[j] != null ? String(hdr[j]).trim() : '';
        R.cols.push({ idx: j, letter: colLetter(sh.c0 + j), name: name || ('คอลัมน์ ' + colLetter(sh.c0 + j)) });
      }
    }

    function sampleValues(j, max) {
      var sh = cur(), out = [];
      for (var i = R.header + 1; i < sh.rows.length && out.length < max; i++) {
        var v = sh.rows[i] ? sh.rows[i][j] : null;
        if (!C.isEmptyCell(v)) out.push(v);
      }
      return out;
    }

    function score(j, fn) {
      var vals = sampleValues(j, 40);
      if (!vals.length) return 0;
      return vals.filter(fn).length / vals.length;
    }

    var RE = {
      lmp: /lmp|ประจำเดือน|menstrua|last\s*period/i,
      us: /(^|[^a-z])(us|u\/s|usg)([^a-z]|$)|ultra|อัลตรา|อัลตร้า|sono/i,
      date: /date|วันที่|วัน\s|visit|ตรวจ|คลอด|deliver|lab|anc/i,
      ga: /(^|[^a-z])ga([^a-z]|$)|อายุครรภ์|gest/i,
      wk: /wk|week|สัปดาห์|สป/i,
      day: /(^|[^a-z])(d|day|days)([^a-z]|$)|วัน(?!ที่)/i,
      skip: /เกิด|birth|dob/i
    };

    function autoMap() {
      var opts = readOpts();
      var isDate = function (v) { return C.parseDateValue(v, opts).ok; };
      var isGA = function (v) { return C.parseGA(v, { decimal: opts.decimal }).ok && !C.parseDateValue(v, opts).ok; };
      var dateScore = R.cols.map(function (c) { return score(c.idx, isDate); });
      var gaScore = R.cols.map(function (c) { return score(c.idx, isGA); });
      var pick = function (test) {
        for (var k = 0; k < R.cols.length; k++) if (test(R.cols[k], k)) return R.cols[k].idx;
        return -1;
      };
      var lmp = pick(function (c, k) { return RE.lmp.test(c.name) && dateScore[k] >= 0.5; });
      var usDate = pick(function (c, k) { return k !== lmp && RE.us.test(c.name) && dateScore[k] >= 0.5; });
      var ga = pick(function (c, k) { return k !== lmp && k !== usDate && (RE.us.test(c.name) || RE.ga.test(c.name)) && gaScore[k] >= 0.5; });
      var dateCols = [];
      R.cols.forEach(function (c, k) {
        if (k === lmp || k === usDate || k === ga) return;
        if (dateScore[k] >= 0.6 && !RE.skip.test(c.name)) dateCols.push(c.idx);
      });
      R.mapping = { lmp: lmp, usDate: usDate, usGA: { mode: 'single', col: ga, wCol: -1, dCol: -1 }, dateCols: dateCols };
      if (ga < 0) {
        var w = pick(function (c, k) { return RE.wk.test(c.name) && k !== lmp && k !== usDate; });
        var d = pick(function (c, k) { return RE.day.test(c.name) && k !== w && dateScore[k] < 0.5; });
        if (w >= 0 && d >= 0) R.mapping.usGA = { mode: 'wd', col: -1, wCol: w, dCol: d };
      }
    }

    function fillSelect(id, value) {
      var sel = $(id);
      sel.innerHTML = '';
      var none = document.createElement('option');
      none.value = '-1'; none.textContent = '(ไม่มี)'; sel.appendChild(none);
      R.cols.forEach(function (c) {
        var o = document.createElement('option');
        o.value = String(c.idx); o.textContent = c.letter + ': ' + c.name; sel.appendChild(o);
      });
      sel.value = String(value == null ? -1 : value);
    }

    function renderMapping() {
      var m = R.mapping;
      fillSelect('map-lmp', m.lmp);
      fillSelect('map-usdate', m.usDate);
      fillSelect('map-ga', m.usGA.col);
      fillSelect('map-gaw', m.usGA.wCol);
      fillSelect('map-gad', m.usGA.dCol);
      $('map-gamode').value = m.usGA.mode;
      showGAMode();
      var box = $('map-datecols');
      box.innerHTML = '';
      R.cols.forEach(function (c) {
        if (c.idx === m.lmp || c.idx === m.usDate) return;
        var lab = document.createElement('label');
        lab.className = 'check';
        var cb = document.createElement('input');
        cb.type = 'checkbox'; cb.value = String(c.idx); cb.checked = m.dateCols.indexOf(c.idx) >= 0;
        cb.addEventListener('change', onMapChange);
        lab.appendChild(cb);
        lab.appendChild(document.createTextNode(c.letter + ': ' + c.name));
        box.appendChild(lab);
      });
      if (!box.children.length) box.textContent = 'ไม่มีคอลัมน์อื่น';
    }

    function showGAMode() {
      var mode = $('map-gamode').value;
      $('wrap-ga').hidden = mode === 'wd';
      $('wrap-gaw').hidden = mode !== 'wd';
      $('wrap-gad').hidden = mode !== 'wd';
    }

    function onMapChange() {
      var num = function (id) { return parseInt($(id).value, 10); };
      var prevDates = R.mapping.dateCols;
      R.mapping = {
        lmp: num('map-lmp'), usDate: num('map-usdate'),
        usGA: { mode: $('map-gamode').value, col: num('map-ga'), wCol: num('map-gaw'), dCol: num('map-gad') },
        dateCols: Array.prototype.map.call(document.querySelectorAll('#map-datecols input:checked'), function (cb) { return parseInt(cb.value, 10); })
      };
      showGAMode();
      // keep the checkbox list in step with the LMP/US choices
      if (this && (this.id === 'map-lmp' || this.id === 'map-usdate')) {
        R.mapping.dateCols = prevDates.filter(function (c) { return c !== R.mapping.lmp && c !== R.mapping.usDate; });
        renderMapping();
      }
      run();
    }
    ['map-lmp', 'map-usdate', 'map-ga', 'map-gaw', 'map-gad', 'map-gamode'].forEach(function (id) {
      $(id).addEventListener('change', onMapChange);
    });
    ['opt-2digit', 'opt-decimal'].forEach(function (id) { $(id).addEventListener('change', function () { run(); }); });

    function readOpts() {
      return { twoDigitYear: $('opt-2digit').value, decimal: $('opt-decimal').value, date1904: !!(R.src && R.src.date1904) };
    }

    function mappingForCore() {
      var m = R.mapping;
      var g = m.usGA;
      var usGA = null;
      if (g.mode === 'wd' && g.wCol >= 0) usGA = { mode: 'wd', wCol: g.wCol, dCol: g.dCol };
      else if (g.mode !== 'wd' && g.col >= 0) usGA = { mode: g.mode, col: g.col };
      return { lmp: m.lmp >= 0 ? m.lmp : null, usDate: m.usDate >= 0 ? m.usDate : null, usGA: usGA, dateCols: m.dateCols.slice() };
    }

    function dateColNames() {
      return R.mapping.dateCols.map(function (c) {
        var col = R.cols[c];
        var n = col ? col.name : colLetter(c);
        return n.replace(/[\s,;]+/g, '_');
      });
    }

    function run() {
      if (!R.src) return;
      var sh = cur(), opts = readOpts(), map = mappingForCore();
      R.results = [];
      R.byIdx = {};
      for (var i = R.header + 1; i < sh.rows.length; i++) {
        var res = C.processRow(sh.rows[i] || [], map, opts);
        var item = { idx: i, res: res };
        R.results.push(item);
        R.byIdx[i] = item;
      }
      renderStats();
      renderPreview();
      setStatus($('dl-status'), '', '');
    }

    function renderFileInfo() {
      var src = R.src, sh = cur(), info = $('file-info');
      var n = Math.max(0, sh.rows.length - R.header - 1);
      if (src.sample) {
        info.innerHTML = '<span class="sample">ข้อมูลตัวอย่าง (สมมติ)</span>' + n + ' ราย เลือกไฟล์ของอาจารย์เพื่อแทนที่';
      } else {
        info.textContent = src.fileName + (src.sheets.length > 1 ? ' · ชีต ' + sh.name : '') + ' · ' + n.toLocaleString('th-TH') + ' แถวข้อมูล' +
          (src.encoding ? ' · อ่านเป็น ' + src.encoding : '');
      }
    }

    function stat(k, v, small) {
      return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v">' + v + (small ? ' <small>' + esc(small) + '</small>' : '') + '</div></div>';
    }

    function renderStats() {
      var nonEmpty = R.results.filter(function (it) { return it.res.status !== 'empty'; });
      var ok = nonEmpty.filter(function (it) { return it.res.dating && it.res.dating.edcFinal != null; });
      var us = ok.filter(function (it) { return it.res.dating.source === 'US'; });
      var byBand = { T1: 0, T2: 0, T3: 0 }, lmpUnusable = 0;
      us.forEach(function (it) { var b = it.res.dating.band; if (b) byBand[b.key]++; else lmpUnusable++; });
      var notes = nonEmpty.filter(function (it) { return it.res.notes && it.res.notes.length; });
      var err = nonEmpty.filter(function (it) { return it.res.status === 'error'; });
      $('stats').innerHTML =
        stat('แถวข้อมูล', nonEmpty.length.toLocaleString('th-TH')) +
        stat('คำนวณ EDC ได้', ok.length.toLocaleString('th-TH')) +
        stat('ยึด US ตามเกณฑ์', us.length.toLocaleString('th-TH'), 'T1 ' + byBand.T1 + ' · T2 ' + byBand.T2 + ' · T3 ' + byBand.T3 +
          (lmpUnusable ? ' · LMP ใช้ไม่ได้ ' + lmpUnusable : '')) +
        stat('มีหมายเหตุ', notes.length.toLocaleString('th-TH'), err.length ? 'คำนวณไม่ได้ ' + err.length : '');
    }

    function fmtCellDate(v) {
      var p = C.parseDateValue(v, readOpts());
      if (p.ok) return C.fmtDMYBE(p.day);
      return C.isEmptyCell(v) ? '' : String(v);
    }

    function renderPreview() {
      var sh = cur(), m = R.mapping;
      var idCol = -1;
      for (var j = 0; j < R.cols.length; j++) {
        if (j !== m.lmp && j !== m.usDate && j !== m.usGA.col && m.dateCols.indexOf(j) < 0) { idCol = j; break; }
      }
      var shownDates = m.dateCols.slice(0, 2);
      var head = '<thead><tr><th>แถว</th>' + (idCol >= 0 ? '<th>' + esc(R.cols[idCol].name) + '</th>' : '') +
        '<th>LMP</th><th>วันที่ US</th><th>GA จาก US</th><th>GA ตาม LMP ณ US</th><th>ผลต่าง (วัน)</th><th>EDC ที่ใช้</th>' +
        shownDates.map(function (c) { return '<th>GA ณ ' + esc(R.cols[c] ? R.cols[c].name : colLetter(c)) + '</th>'; }).join('') +
        '<th>หมายเหตุ</th></tr></thead>';
      var body = [], shown = 0, total = 0;
      R.results.forEach(function (it) {
        if (it.res.status === 'empty') return;
        total++;
        if (shown >= 50) return;
        shown++;
        var res = it.res, a = res.dating, row = sh.rows[it.idx] || [];
        var gaMap = {};
        res.gaAt.forEach(function (g) { gaMap[g.col] = g; });
        body.push('<tr class="st-' + res.status + '"><td>' + (sh.r0 + it.idx + 1) + '</td>' +
          (idCol >= 0 ? '<td>' + esc(C.isEmptyCell(row[idCol]) ? '' : String(sh.text[it.idx][idCol])) + '</td>' : '') +
          '<td>' + esc(res.lmp != null ? C.fmtDMYBE(res.lmp) : (m.lmp >= 0 ? fmtCellDate(row[m.lmp]) : '')) + '</td>' +
          '<td>' + esc(res.usDate != null ? C.fmtDMYBE(res.usDate) : '') + '</td>' +
          '<td>' + esc(res.usGA != null ? C.fmtWD(res.usGA) : '') + '</td>' +
          '<td>' + esc(a && a.band ? C.fmtWD(a.gaLmpAtUs) + ' ' + a.band.key : '') + '</td>' +
          '<td>' + esc(a && a.diff != null ? (a.diff > 0 ? '+' : '') + a.diff : '') + '</td>' +
          '<td>' + (a && a.edcFinal != null ? esc(C.fmtDMYBE(a.edcFinal)) + '<span class="src ' + a.source + '">' + (a.source.indexOf('US') === 0 ? 'US' : 'LMP') + '</span>'
            : '<span class="fail">คำนวณไม่ได้</span>') + '</td>' +
          shownDates.map(function (c) { var g = gaMap[c]; return '<td>' + esc(g && g.days != null ? C.fmtWD(g.days) : '') + '</td>'; }).join('') +
          '<td class="note">' + esc(res.notes.join('; ')) + '</td></tr>');
      });
      $('preview').innerHTML = head + '<tbody>' + body.join('') + '</tbody>';
      var moreDates = m.dateCols.length > shownDates.length ? ' ตัวอย่างแสดง GA 2 คอลัมน์แรก ไฟล์ที่ดาวน์โหลดมีครบทุกคอลัมน์' : '';
      $('preview-more').textContent = (total > shown ? 'แสดง ' + shown + ' จาก ' + total.toLocaleString('th-TH') + ' แถว ไฟล์ที่ดาวน์โหลดมีครบทุกแถว' : '') + moreDates;
    }

    /* ---------- Output ---------- */
    function blankCells() { return C.outputCells(null, R.mapping.dateCols.length); }

    function buildCSV() {
      var sh = cur(), headers = C.outputHeaders(dateColNames());
      var width = maxCols(sh.text);
      var out = sh.text.map(function (r, i) {
        var base = [];
        for (var j = 0; j < width; j++) base.push(r && r[j] != null ? r[j] : '');
        if (i < R.header) return base;
        if (i === R.header) return base.concat(headers);
        var it = R.byIdx[i];
        var cells = it ? C.outputCells(it.res, R.mapping.dateCols.length) : blankCells();
        return base.concat(cells.map(function (c) { return c.t === 'date' ? C.fmtISO(c.v) : (c.v == null ? '' : c.v); }));
      });
      return C.toCSV(out);
    }

    function buildXLSX() {
      var X = window.XLSX;
      if (!X) throw new Error('ยังโหลดตัวเขียน Excel ไม่ได้ ใช้ปุ่ม .csv แทน');
      var src = R.src, sh = cur(), headers = C.outputHeaders(dateColNames());
      var wb, ws, startCol, shift = src.date1904 ? -1462 : 0;
      if (src.kind === 'xlsx') {
        var orig = src.wb.Sheets[sh.name];
        ws = Object.assign({}, orig);
        var rg = X.utils.decode_range(orig['!ref'] || 'A1');
        startCol = rg.e.c + 1;
        wb = Object.assign({}, src.wb, { Sheets: Object.assign({}, src.wb.Sheets) });
        wb.Sheets[sh.name] = ws;
      } else {
        ws = X.utils.aoa_to_sheet(sh.rows);
        startCol = maxCols(sh.rows);
        wb = X.utils.book_new();
        X.utils.book_append_sheet(wb, ws, 'data');
      }
      var r0 = sh.r0, c0 = sh.c0;
      headers.forEach(function (h, k) {
        ws[X.utils.encode_cell({ r: r0 + R.header, c: startCol + k })] = { t: 's', v: h };
      });
      R.results.forEach(function (it) {
        var cells = C.outputCells(it.res, R.mapping.dateCols.length);
        cells.forEach(function (cell, k) {
          if (cell.v === '' || cell.v == null) return;
          var addr = X.utils.encode_cell({ r: r0 + it.idx, c: startCol + k });
          if (cell.t === 'date') ws[addr] = { t: 'n', v: C.dayToExcelSerial(cell.v) + shift, z: 'dd/mm/yyyy' };
          else if (cell.t === 'num') ws[addr] = { t: 'n', v: cell.v };
          else ws[addr] = { t: 's', v: String(cell.v) };
        });
      });
      var oldRange = ws['!ref'] ? X.utils.decode_range(ws['!ref']) : { s: { r: r0, c: c0 }, e: { r: r0, c: c0 } };
      ws['!ref'] = X.utils.encode_range({
        s: { r: Math.min(oldRange.s.r, r0), c: Math.min(oldRange.s.c, c0) },
        e: { r: Math.max(oldRange.e.r, r0 + sh.rows.length - 1), c: startCol + headers.length - 1 }
      });
      var cols = (ws['!cols'] || []).slice();
      for (var k = 0; k < headers.length; k++) cols[startCol + k] = { wch: Math.max(12, headers[k].length + 2) };
      ws['!cols'] = cols;
      var out = X.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
      return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }

    function outName(ext) { return (R.src.sample ? 'pregwheel_sample' : R.src.name) + '_GA.' + ext; }

    $('dl-csv').addEventListener('click', function () {
      if (!R.src) return;
      offerDownload(outName('csv'), buildCSV(), $('dl-status'));
    });
    $('dl-xlsx').addEventListener('click', function () {
      if (!R.src) return;
      var blob;
      try { blob = buildXLSX(); } catch (e) { setStatus($('dl-status'), 'err', e.message); return; }
      offerDownload(outName('xlsx'), blob, $('dl-status'));
    });
    $('btn-template').addEventListener('click', function () {
      offerDownload('pregwheel_template.csv', '﻿' + SAMPLE_CSV + '\r\n', $('dl-status'));
    });

    $('file').addEventListener('change', function () { if (this.files && this.files[0]) readFile(this.files[0]); this.value = ''; });
    var drop = $('drop');
    ['dragenter', 'dragover'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) readFile(f);
    });
    $('sheet').addEventListener('change', function () { R.sheet = parseInt(this.value, 10) || 0; setupSheet(); });
    $('header-row').addEventListener('change', function () {
      var sh = cur();
      var idx = (parseInt(this.value, 10) || 1) - 1 - sh.r0;
      R.header = Math.max(0, Math.min(sh.rows.length - 1, idx));
      this.value = String(sh.r0 + R.header + 1);
      buildColumns(); autoMap(); renderMapping(); renderFileInfo(); run();
    });

    return {
      ensure: function () { if (!ready) { ready = true; loadSample(); } },
      _state: R
    };
  })();

  /* ================================================================
   * Start
   * ================================================================ */
  buildWheel();
  renderToday();
  setVisitMode('today');
  recompute();
  scheduleMidnight();
  setInterval(function () { checkToday('interval'); }, 30000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) checkToday('visible'); });
  window.addEventListener('focus', function () { checkToday('focus'); });
  window.addEventListener('pageshow', function () { checkToday('pageshow'); });

  var startTab = 'clinic';
  if (/^#research$/.test(location.hash)) startTab = 'research';
  else {
    try { if (localStorage.getItem('pregwheel-tab') === 'research') startTab = 'research'; } catch (e) { /* storage unavailable */ }
  }
  selectTab(startTab);

  window.PregWheel = { state: state, recompute: recompute, checkToday: checkToday, research: Research };
})();
