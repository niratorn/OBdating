/* PregCore: pure date and gestational-age logic for the Preg Wheel web app.
 * No DOM access here, so the same file runs in the browser and in Node tests.
 * All dates are handled as integer "day numbers" (days since 1970-01-01 on the
 * civil calendar), which avoids time-zone and daylight-saving errors.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PregCore = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------
   * Clinical constants. Keep every clinical number here, named and cited.
   * ------------------------------------------------------------------ */

  // EDD is 280 days after the first day of the LMP.
  // ACOG Committee Opinion No. 700, Methods for estimating the due date.
  // Obstet Gynecol. 2017;129(5):e150-e154. doi:10.1097/AOG.0000000000002046 (reaffirmed 2022)
  var DAYS_LMP_TO_EDC = 280;

  // Redating rule set by the user (Phichit Hospital, 2026-09-30):
  //   first trimester  (to 13+6 wk)      discrepancy more than 7 days  -> use ultrasound
  //   second trimester (14+0 to 27+6 wk) discrepancy more than 14 days -> use ultrasound
  //   third trimester  (28+0 wk onward)  discrepancy more than 21 days -> use ultrasound
  // The band is chosen by GA from LMP on the ultrasound date, following the
  // footnote "*Based on LMP" of ACOG CO 700 Table 1.
  // The third-trimester caution text follows the dagger footnote of the same table.
  var REDATING_BANDS = [
    { key: 'T1', name: 'ไตรมาสแรก', range: 'ถึง 13+6 สัปดาห์', fromDays: 0, toDays: 13 * 7 + 6, thresholdDays: 7 },
    { key: 'T2', name: 'ไตรมาสสอง', range: '14+0 ถึง 27+6 สัปดาห์', fromDays: 14 * 7, toDays: 27 * 7 + 6, thresholdDays: 14 },
    { key: 'T3', name: 'ไตรมาสสาม', range: '28+0 สัปดาห์ขึ้นไป', fromDays: 28 * 7, toDays: Infinity, thresholdDays: 21 }
  ];

  // Data-entry guards (not clinical thresholds): values outside these are treated as typing errors.
  var MAX_GA_DAYS = 44 * 7 + 6;   // latest GA accepted for an ultrasound entry
  var WARN_GA_DAYS = 44 * 7;      // GA on a date beyond this gets a "check the dates" note

  // Calendar conversion
  var BE_OFFSET = 543;            // Buddhist Era year = Common Era year + 543
  var BE_MIN_YEAR = 2400;         // a 4-digit year at or above this is read as B.E.
  var CE_MIN_YEAR = 1800;
  var SERIAL_MIN_YEAR = 1920;     // an Excel number is read as a date only if it lands after this year,
                                  // so small numbers such as GA weeks (e.g. 11) are never taken as dates

  var MS_PER_DAY = 86400000;
  var MAX_INPUT_CHARS = 60;       // longer text is never a date or GA; refusing it keeps the regexes fast
  var EXCEL_EPOCH_OFFSET = 25569; // Excel serial of 1970-01-01 (1900 date system)
  var EXCEL_1904_SHIFT = 1462;    // days between the 1900 and 1904 date systems
  var EXCEL_MAX_SERIAL = 2958465; // 9999-12-31

  var TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  var TH_MONTHS_ABBR = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  var TH_WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  var TH_WEEKDAYS_ABBR = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
  var EN_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'];

  /* ------------------------------------------------------------------
   * Day numbers
   * ------------------------------------------------------------------ */

  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }

  // y is a Common Era year (1000..9999), m 1..12, d 1..31. Returns null for impossible dates.
  function dayFromYMD(y, m, d) {
    if (!isInt(y) || !isInt(m) || !isInt(d)) return null;
    if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    var t = Date.UTC(y, m - 1, d);
    var dt = new Date(t);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return Math.round(t / MS_PER_DAY);
  }

  function ymdFromDay(n) {
    var dt = new Date(n * MS_PER_DAY);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }

  // Today's date on the device's own calendar (local time), as a day number.
  function localToday(now) {
    now = now || new Date();
    return dayFromYMD(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  // Milliseconds until the next local midnight (plus a small margin).
  function msUntilNextLocalMidnight(now) {
    now = now || new Date();
    var next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2);
    return Math.max(1000, next.getTime() - now.getTime());
  }

  function weekdayIndex(n) { return (((n + 4) % 7) + 7) % 7; } // 0 = Sunday; 1970-01-01 was a Thursday

  /* ------------------------------------------------------------------
   * Formatting
   * ------------------------------------------------------------------ */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function fmtThai(n, withWeekday) {
    if (n == null) return '';
    var p = ymdFromDay(n);
    var s = p.d + ' ' + TH_MONTHS_ABBR[p.m - 1] + ' ' + (p.y + BE_OFFSET);
    return withWeekday ? TH_WEEKDAYS_ABBR[weekdayIndex(n)] + ' ' + s : s;
  }

  function fmtThaiLong(n) {
    if (n == null) return '';
    var p = ymdFromDay(n);
    return 'วัน' + TH_WEEKDAYS[weekdayIndex(n)] + 'ที่ ' + p.d + ' ' + TH_MONTHS[p.m - 1] + ' พ.ศ. ' + (p.y + BE_OFFSET);
  }

  function fmtDMYBE(n) {
    if (n == null) return '';
    var p = ymdFromDay(n);
    return pad2(p.d) + '/' + pad2(p.m) + '/' + (p.y + BE_OFFSET);
  }

  function fmtISO(n) {
    if (n == null) return '';
    var p = ymdFromDay(n);
    return p.y + '-' + pad2(p.m) + '-' + pad2(p.d);
  }

  function splitWD(days) {
    var w = Math.floor(days / 7);
    return { w: w, d: days - w * 7 };
  }

  function fmtWD(days) {
    if (days == null) return '';
    var p = splitWD(days);
    return p.w + '+' + p.d;
  }

  function fmtWDThai(days) {
    if (days == null) return '';
    var p = splitWD(days);
    return p.w + ' สัปดาห์ ' + p.d + ' วัน';
  }

  function trimesterOf(gaDays) {
    if (gaDays == null || gaDays < 0) return null;
    if (gaDays <= 13 * 7 + 6) return 1;
    if (gaDays <= 27 * 7 + 6) return 2;
    return 3;
  }

  /* ------------------------------------------------------------------
   * Parsing dates typed by people or exported by hospital systems
   * ------------------------------------------------------------------ */

  function normalizeDigits(s) {
    return String(s).replace(/[๐-๙]/g, function (c) { return String(c.charCodeAt(0) - 0x0E50); });
  }

  function monthFromToken(tok) {
    var t = tok.toLowerCase().replace(/[.\s]/g, '');
    if (!t) return null;
    for (var i = 0; i < 12; i++) {
      if (t === TH_MONTHS[i] || t === TH_MONTHS_ABBR[i].replace(/\./g, '')) return i + 1;
    }
    for (var j = 0; j < 12; j++) {
      if (t === EN_MONTHS[j] || (t.length >= 3 && EN_MONTHS[j].indexOf(t) === 0)) return j + 1;
    }
    return null;
  }

  // Convert a year string to a Common Era year.
  // opts.twoDigitYear: 'BE' (default, 63 -> 2563) or 'CE' (20 -> 2020). eraHint: 'BE' | 'CE' | null
  function yearToCE(yStr, opts, eraHint) {
    var n = parseInt(yStr, 10);
    if (!isFinite(n)) return null;
    if (yStr.length <= 2) {
      if (eraHint === 'CE' || (!eraHint && opts.twoDigitYear === 'CE')) return { y: 2000 + n, era: 'CE' };
      return { y: 2500 + n - BE_OFFSET, era: 'BE' };
    }
    if (yStr.length !== 4) return null;
    if (eraHint === 'CE') return n >= BE_MIN_YEAR ? null : { y: n, era: 'CE' };
    if (eraHint === 'BE') return n >= BE_MIN_YEAR ? { y: n - BE_OFFSET, era: 'BE' } : null;
    if (n >= BE_MIN_YEAR) return { y: n - BE_OFFSET, era: 'BE' };
    if (n >= CE_MIN_YEAR) return { y: n, era: 'CE' };
    return null;
  }

  function okDate(day, era) { return { ok: true, day: day, era: era }; }
  function badDate(msg) { return { ok: false, error: msg }; }

  function buildDate(dStr, mNum, yStr, opts, eraHint) {
    var yr = yearToCE(yStr, opts, eraHint);
    if (!yr) return badDate('ปีไม่ถูกต้อง');
    var d = parseInt(dStr, 10);
    var day = dayFromYMD(yr.y, mNum, d);
    if (day == null) return badDate('ไม่มีวันที่นี้ในปฏิทิน');
    return okDate(day, yr.era);
  }

  // Parse free text such as "1/9/2563", "01-09-63", "1.9.2563", "01092563",
  // "2020-09-01", "1 ก.ย. 2563", "1 กันยายน พ.ศ. 2563", "01-Sep-2020".
  // Day always comes before month (Thai convention).
  function parseDateText(raw, opts) {
    opts = opts || {};
    if (raw == null) return { ok: false, empty: true };
    if (String(raw).length > MAX_INPUT_CHARS * 4) return badDate('ข้อความยาวเกินไป');
    var s = normalizeDigits(raw).replace(/[ \s]+/g, ' ').trim();
    if (!s) return { ok: false, empty: true };
    if (s.length > MAX_INPUT_CHARS) return badDate('ข้อความยาวเกินไป');

    var eraHint = null;
    if (/พ\s?\.?\s?ศ\s?\.?/.test(s)) { eraHint = 'BE'; s = s.replace(/พ\s?\.?\s?ศ\s?\.?/g, ' '); }
    else if (/ค\s?\.?\s?ศ\s?\.?/.test(s)) { eraHint = 'CE'; s = s.replace(/ค\s?\.?\s?ศ\s?\.?/g, ' '); }
    s = s.replace(/^วันที่\s*/, '')
      .replace(/^(วัน)?(อาทิตย์|จันทร์|อังคาร|พุธ|พฤหัสบดี|พฤหัส|ศุกร์|เสาร์)(ที่)?\s*/, '')
      .replace(/^(อา|จ|อ|พ|พฤ|ศ|ส)\.\s*(?=\d)/, '')
      .replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s*/i, '')
      .replace(/^ที่\s*/, '')
      .replace(/\s+/g, ' ').trim();

    var m;
    // yyyy-mm-dd (optionally with a time part)
    m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[ T]\d{1,2}:\d{2}.*)?$/);
    if (m) return buildDate(m[3], parseInt(m[2], 10), m[1], opts, eraHint);

    // dd/mm/yyyy, dd-mm-yy, dd.mm.yyyy, "dd mm yyyy" (optionally with a time part)
    m = s.match(/^(\d{1,2})[-\/. ](\d{1,2})[-\/. ](\d{4}|\d{2})(?:[ T]\d{1,2}:\d{2}.*)?$/);
    if (m) return buildDate(m[1], parseInt(m[2], 10), m[3], opts, eraHint);

    // digits only
    if (/^\d+$/.test(s)) {
      if (s.length === 8) {
        var y4 = parseInt(s.slice(0, 4), 10);
        if ((y4 >= 1800 && y4 <= 2199) || (y4 >= 2400 && y4 <= 2799)) {
          var r1 = buildDate(s.slice(6, 8), parseInt(s.slice(4, 6), 10), s.slice(0, 4), opts, eraHint);
          if (r1.ok) return r1;
        }
        return buildDate(s.slice(0, 2), parseInt(s.slice(2, 4), 10), s.slice(4, 8), opts, eraHint);
      }
      if (s.length === 7) return buildDate(s.slice(0, 1), parseInt(s.slice(1, 3), 10), s.slice(3, 7), opts, eraHint);
      if (s.length === 6) return buildDate(s.slice(0, 2), parseInt(s.slice(2, 4), 10), s.slice(4, 6), opts, eraHint);
      if (s.length === 5) return buildDate(s.slice(0, 1), parseInt(s.slice(1, 3), 10), s.slice(3, 5), opts, eraHint);
      return badDate('อ่านวันที่ไม่ได้');
    }

    // day + month name + year: "1 ก.ย. 2563", "1ก.ย.63", "01-Sep-2020", "1 September 2020"
    var t = s.replace(/-/g, ' ').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    m = t.match(/^(\d{1,2})\s*([^\d]+?)\s*(\d{4}|\d{2})$/);
    if (m) {
      var mon = monthFromToken(m[2]);
      if (mon) return buildDate(m[1], mon, m[3], opts, eraHint);
      return badDate('อ่านชื่อเดือนไม่ได้');
    }
    // month name + day + year: "Sep 1 2020"
    m = t.match(/^([A-Za-z]+)\.?\s+(\d{1,2})\s+(\d{4})$/);
    if (m) {
      var mon2 = monthFromToken(m[1]);
      if (mon2) return buildDate(m[2], mon2, m[3], opts, eraHint);
    }
    return badDate('อ่านวันที่ไม่ได้');
  }

  // Parse a spreadsheet cell value (number, Date, or text).
  // Numbers are read as Excel serial dates. A serial that lands in year 2400 or later
  // is a Buddhist year typed into a non-Thai Excel (e.g. 01/09/2563 stored as year 2563),
  // so 543 years are taken off.
  function parseDateValue(v, opts) {
    opts = opts || {};
    if (v == null || v === '') return { ok: false, empty: true };
    if (typeof v === 'number') {
      if (!isFinite(v)) return badDate('อ่านวันที่ไม่ได้');
      if (v >= 1 && v <= EXCEL_MAX_SERIAL) {
        var day = Math.floor(v) - EXCEL_EPOCH_OFFSET + (opts.date1904 ? EXCEL_1904_SHIFT : 0);
        var p = ymdFromDay(day);
        if (p.y >= SERIAL_MIN_YEAR && p.y < 2200) return okDate(day, 'CE');
        if (p.y >= BE_MIN_YEAR && p.y < 2800) {
          var fixed = dayFromYMD(p.y - BE_OFFSET, p.m, p.d);
          if (fixed != null) return okDate(fixed, 'BE');
        }
      }
      if (isInt(v) && v > 0) return parseDateText(String(v), opts);
      return badDate('อ่านวันที่ไม่ได้');
    }
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return badDate('อ่านวันที่ไม่ได้');
      var y = v.getFullYear(), mo = v.getMonth() + 1, d = v.getDate();
      if (y >= BE_MIN_YEAR) y -= BE_OFFSET;
      var dd = dayFromYMD(y, mo, d);
      return dd == null ? badDate('อ่านวันที่ไม่ได้') : okDate(dd, 'CE');
    }
    return parseDateText(String(v), opts);
  }

  /* ------------------------------------------------------------------
   * Parsing gestational age written as weeks+days
   * ------------------------------------------------------------------ */

  function okGA(days) {
    if (days < 1 || days > MAX_GA_DAYS) return { ok: false, error: 'GA ต้องอยู่ระหว่าง 0+1 ถึง 44+6' };
    return { ok: true, days: days };
  }

  function gaFromWD(w, d) {
    if (d > 6) return { ok: false, error: 'จำนวนวันต้องเป็น 0 ถึง 6' };
    return okGA(w * 7 + d);
  }

  // opts.unit: 'wd' (default) or 'days'
  // opts.decimal: 'reject' (default) | 'wd' (7.5 means 7+5) | 'weeks' (7.5 means 7.5 weeks)
  function parseGA(raw, opts) {
    opts = opts || {};
    var decimal = opts.decimal || 'reject';
    if (raw == null || raw === '') return { ok: false, empty: true };
    if (typeof raw === 'number') {
      if (!isFinite(raw) || raw < 0) return { ok: false, error: 'อ่าน GA ไม่ได้' };
      if (opts.unit === 'days') return isInt(raw) ? okGA(raw) : { ok: false, error: 'จำนวนวันต้องเป็นจำนวนเต็ม' };
      if (isInt(raw)) return okGA(raw * 7);
      raw = String(raw);
    }
    if (String(raw).length > MAX_INPUT_CHARS * 4) return { ok: false, error: 'ข้อความยาวเกินไป' };
    var s = normalizeDigits(raw).toLowerCase().replace(/[ \s]+/g, ' ').trim();
    if (s.length > MAX_INPUT_CHARS) return { ok: false, error: 'ข้อความยาวเกินไป' };
    s = s.replace(/^(ga|us|u\/s|by|อายุครรภ์|:|\s)+/g, '').replace(/\s*(by us|by u\/s|us)$/g, '').trim();
    if (!s) return { ok: false, empty: true };
    var m;
    if (opts.unit === 'days') {
      m = s.match(/^(\d{1,3})\s*(d|day|days|วัน)?$/);
      return m ? okGA(parseInt(m[1], 10)) : { ok: false, error: 'อ่านจำนวนวันไม่ได้' };
    }
    m = s.match(/^(\d{1,2})\s*\+\s*(\d{1,2})$/);
    if (m) return gaFromWD(parseInt(m[1], 10), parseInt(m[2], 10));
    m = s.match(/^(\d{1,2})\s+(\d)\s*\/\s*7$/);
    if (m) return gaFromWD(parseInt(m[1], 10), parseInt(m[2], 10));
    m = s.match(/^(\d{1,2})\s*(?:w|wk|wks|week|weeks|สัปดาห์|สัปดาห|สป)\.?\s*(?:\+\s*)?(?:(\d{1,2})\s*(?:d|day|days|วัน|ว)?\.?)?$/);
    if (m) return gaFromWD(parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0);
    m = s.match(/^(\d{1,3})\s*(?:d|day|days|วัน)$/);
    if (m) return okGA(parseInt(m[1], 10));
    m = s.match(/^(\d{1,2})$/);
    if (m) return okGA(parseInt(m[1], 10) * 7);
    m = s.match(/^(\d{1,2})\.(\d+)$/);
    if (m) {
      if (decimal === 'wd') {
        if (m[2].length !== 1) return { ok: false, error: 'ทศนิยมต้องมี 1 หลัก (เช่น 7.5 = 7+5)' };
        return gaFromWD(parseInt(m[1], 10), parseInt(m[2], 10));
      }
      if (decimal === 'weeks') return okGA(Math.round(parseFloat(m[0]) * 7));
      return { ok: false, error: 'ทศนิยมกำกวม (' + m[0] + ') เลือกวิธีตีความในตั้งค่า' };
    }
    return { ok: false, error: 'อ่าน GA ไม่ได้' };
  }

  /* ------------------------------------------------------------------
   * Dating
   * ------------------------------------------------------------------ */

  function edcFromLMP(lmpDay) { return lmpDay + DAYS_LMP_TO_EDC; }
  function edcFromUS(usDay, usGADays) { return usDay + (DAYS_LMP_TO_EDC - usGADays); }
  function gaOn(edcDay, day) { return day - (edcDay - DAYS_LMP_TO_EDC); }

  function bandFor(gaLmpDays) {
    for (var i = 0; i < REDATING_BANDS.length; i++) {
      var b = REDATING_BANDS[i];
      if (gaLmpDays >= b.fromDays && gaLmpDays <= b.toDays) return b;
    }
    return null;
  }

  // input: { lmp: day|null, usDate: day|null, usGA: days|null }
  // source: 'LMP' | 'US' (rule applied), 'LMP_ONLY', 'US_ONLY', or null
  function assessDating(input) {
    var r = {
      lmp: input.lmp != null ? input.lmp : null,
      usDate: input.usDate != null ? input.usDate : null,
      usGA: input.usGA != null ? input.usGA : null,
      edcLmp: null, edcUs: null, edcFinal: null, source: null,
      gaLmpAtUs: null, diff: null, absDiff: null, band: null, exceeds: null,
      t3Caution: false, errors: []
    };
    if (r.lmp != null) r.edcLmp = edcFromLMP(r.lmp);
    if (r.usDate != null && r.usGA != null) r.edcUs = edcFromUS(r.usDate, r.usGA);

    if (r.edcLmp != null && r.edcUs != null) {
      r.gaLmpAtUs = r.usDate - r.lmp;
      if (r.gaLmpAtUs < 0) { r.errors.push('US_BEFORE_LMP'); return r; }
      if (r.gaLmpAtUs > MAX_GA_DAYS) { r.errors.push('US_TOO_LATE'); return r; }
      r.diff = r.gaLmpAtUs - r.usGA;      // equals edcUs - edcLmp; positive = ultrasound smaller than dates
      r.absDiff = Math.abs(r.diff);
      r.band = bandFor(r.gaLmpAtUs);
      r.exceeds = r.absDiff > r.band.thresholdDays;
      r.source = r.exceeds ? 'US' : 'LMP';
      r.t3Caution = r.exceeds && r.band.key === 'T3';
    } else if (r.edcLmp != null) {
      r.source = 'LMP_ONLY';
    } else if (r.edcUs != null) {
      r.source = 'US_ONLY';
    }
    if (r.source === 'US' || r.source === 'US_ONLY') r.edcFinal = r.edcUs;
    else if (r.source === 'LMP' || r.source === 'LMP_ONLY') r.edcFinal = r.edcLmp;
    return r;
  }

  var ERROR_TEXT = {
    US_BEFORE_LMP: 'วันที่ทำ US อยู่ก่อน LMP ตรวจสอบวันที่',
    US_TOO_LATE: 'GA ตาม LMP ณ วันทำ US เกิน 44+6 สัปดาห์ ตรวจสอบวันที่'
  };

  var SOURCE_TEXT = {
    LMP: 'LMP (ผลต่างไม่เกินเกณฑ์)',
    US: 'US (ผลต่างเกินเกณฑ์)',
    LMP_ONLY: 'LMP (ไม่มีข้อมูล US)',
    US_ONLY: 'US (ไม่มีข้อมูล LMP)'
  };

  var T3_CAUTION = 'Redate ด้วย US ไตรมาสสาม: ACOG เตือนว่าทารกที่ตัวเล็กอาจเป็น growth restriction จึงควรพิจารณาภาพรวมทางคลินิกและติดตามใกล้ชิด';

  /* ------------------------------------------------------------------
   * Report line (patient profile after corrected date)
   * Format from the teaching handout "การ Corrected date ทางสูติกรรม" (2566):
   *   GA 17+3 Wk by date = U/S at GA 16+3 wk      LMP kept, U/S agrees within the rule
   *   GA 19+1 Wk by U/S ≠ date at GA 19+1 wk      U/S used, discrepancy beyond the rule
   *   GA 11+2 Wk by U/S at GA 11+2 wk due to uncertain date   LMP not remembered (ticked)
   *   GA 11+2 Wk by U/S at GA 11+2 wk             no LMP entered, box not ticked
   *   GA 17+2 Wk by date                          LMP only, no U/S yet
   * The GA after "Wk" (red in the handout) moves every visit. The dating part
   * (purple) names the method and the GA on the day of the dating U/S, taken from
   * the method in use, so it stays the same until delivery.
   * A doctor's override that goes against the rule flips the sign:
   *   "by date ≠ U/S" (LMP kept despite a large discrepancy) or "by U/S = date".
   * ------------------------------------------------------------------ */
  // opts.uncertainDate: the woman cannot remember her LMP (ticked in the form);
  // only then does a U/S-only line say "due to uncertain date".
  function reportLine(a, visitDay, source, opts) {
    source = source || a.source;
    opts = opts || {};
    var useUS = source === 'US' || source === 'US_ONLY';
    var edc = useUS ? a.edcUs : (source === 'LMP' || source === 'LMP_ONLY' ? a.edcLmp : null);
    if (edc == null || visitDay == null) return null;
    var now = gaOn(edc, visitDay);
    if (now < 0 || now > MAX_GA_DAYS) return null;   // visit before conception or long after delivery
    var atDays = null, dating;
    if (source === 'LMP_ONLY') {
      dating = 'by date';
    } else if (source === 'US_ONLY') {
      atDays = a.usGA;
      dating = 'by U/S at GA ' + fmtWD(atDays) + ' wk' + (opts.uncertainDate ? ' due to uncertain date' : '');
    } else if (source === 'LMP') {
      atDays = a.gaLmpAtUs;
      dating = 'by date ' + (a.exceeds ? '≠' : '=') + ' U/S at GA ' + fmtWD(atDays) + ' wk';
    } else {
      atDays = a.usGA;
      dating = 'by U/S ' + (a.exceeds ? '≠' : '=') + ' date at GA ' + fmtWD(atDays) + ' wk';
    }
    return {
      gaDays: now, atDays: atDays, dating: dating,
      gaText: 'GA ' + fmtWD(now) + ' Wk',
      text: 'GA ' + fmtWD(now) + ' Wk ' + dating
    };
  }

  /* ------------------------------------------------------------------
   * EDC copied from the ANC book (สมุดฝากครรภ์): a second way to confirm GA.
   * It never changes the EDC the app uses; it only says whether the book agrees.
   * ------------------------------------------------------------------ */

  // Naegele's calendar rule (LMP + 7 days, minus 3 months, plus 1 year). Many books are
  // filled in by hand this way, which can differ from LMP + 280 days by 0 to 3 days.
  function naegeleEDC(lmpDay) {
    var p = ymdFromDay(lmpDay + 7);
    var m = p.m - 3, y = p.y + 1;
    if (m < 1) { m += 12; y -= 1; }
    var last = ymdFromDay(dayFromYMD(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - 1).d;
    return dayFromYMD(y, m, Math.min(p.d, last));
  }

  // bookEdc: day number; a: assessDating result; finalEdc: EDC in use (after any override)
  function checkBookEDC(bookEdc, a, finalEdc, lmpDay) {
    var r = { diffFinal: null, sameAsFinal: false, sameAsLmp: false, sameAsUs: false, sameAsNaegele: false };
    if (bookEdc == null) return r;
    if (finalEdc != null) { r.diffFinal = bookEdc - finalEdc; r.sameAsFinal = r.diffFinal === 0; }
    r.sameAsLmp = a.edcLmp != null && bookEdc === a.edcLmp;
    r.sameAsUs = a.edcUs != null && bookEdc === a.edcUs;
    r.sameAsNaegele = lmpDay != null && !r.sameAsLmp && bookEdc === naegeleEDC(lmpDay);
    return r;
  }

  /* ------------------------------------------------------------------
   * CSV
   * ------------------------------------------------------------------ */

  // Decode file bytes: UTF-8 first; if the bytes are not valid UTF-8, fall back to
  // Windows-874 (TIS-620 superset), which older Thai hospital systems still export.
  function decodeText(bytes) {
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' };
    } catch (e) {
      return { text: new TextDecoder('windows-874').decode(bytes), encoding: 'Windows-874' };
    }
  }

  function detectDelimiter(text) {
    var line = '', inQ = false;
    for (var i = 0; i < text.length && i < 20000; i++) {
      var c = text[i];
      if (c === '"') inQ = !inQ;
      if (!inQ && (c === '\n' || c === '\r')) break;
      line += inQ ? '' : c;
    }
    var best = ',', bestN = -1;
    [',', ';', '\t', '|'].forEach(function (d) {
      var n = line.split(d).length - 1;
      if (n > bestN) { best = d; bestN = n; }
    });
    return best;
  }

  function parseCSV(text, delimiter) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var d = delimiter || detectDelimiter(text);
    var rows = [], row = [], field = '', i = 0, inQ = false, n = text.length;
    while (i < n) {
      var c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"' && field === '') { inQ = true; i++; continue; }
      if (c === d) { row.push(field); field = ''; i++; continue; }
      if (c === '\r' || c === '\n') {
        row.push(field); rows.push(row); row = []; field = '';
        if (c === '\r' && text[i + 1] === '\n') i++;
        i++; continue;
      }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function csvCell(v) {
    if (v == null) return '';
    var s = String(v);
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(rows) {
    return '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  /* ------------------------------------------------------------------
   * Batch processing for research files
   * ------------------------------------------------------------------ */

  function isEmptyCell(v) { return v == null || (typeof v === 'string' && v.trim() === ''); }

  // mapping: {
  //   lmp: col|null, usDate: col|null,
  //   usGA: { mode: 'single'|'wd'|'days', col, wCol, dCol } | null,
  //   dateCols: [col, ...]
  // }
  // opts: { twoDigitYear: 'BE'|'CE', decimal: 'reject'|'wd'|'weeks', date1904: bool }
  function processRow(row, mapping, opts) {
    opts = opts || {};
    var notes = [];
    var get = function (c) { return c == null || c < 0 ? null : row[c]; };
    var mappedCols = [mapping.lmp, mapping.usDate].concat(mapping.dateCols || []);
    if (mapping.usGA) mappedCols = mappedCols.concat([mapping.usGA.col, mapping.usGA.wCol, mapping.usGA.dCol]);
    var allEmpty = mappedCols.every(function (c) { return c == null || c < 0 || isEmptyCell(row[c]); });
    if (allEmpty) return { status: 'empty' };

    var lmp = null, usDate = null, usGA = null;
    if (mapping.lmp != null && mapping.lmp >= 0) {
      var pl = parseDateValue(get(mapping.lmp), opts);
      if (pl.ok) lmp = pl.day;
      else if (!pl.empty) notes.push('LMP อ่านไม่ได้ (' + String(get(mapping.lmp)) + ')');
    }
    if (mapping.usDate != null && mapping.usDate >= 0) {
      var pu = parseDateValue(get(mapping.usDate), opts);
      if (pu.ok) usDate = pu.day;
      else if (!pu.empty) notes.push('วันที่ US อ่านไม่ได้ (' + String(get(mapping.usDate)) + ')');
    }
    if (mapping.usGA) {
      var g = mapping.usGA, pg;
      if (g.mode === 'wd') {
        var wv = get(g.wCol), dv = get(g.dCol);
        if (isEmptyCell(wv) && isEmptyCell(dv)) pg = { ok: false, empty: true };
        else {
          var wn = parseInt(normalizeDigits(wv == null ? '' : wv), 10);
          var dn = isEmptyCell(dv) ? 0 : parseInt(normalizeDigits(dv), 10);
          pg = isFinite(wn) && isFinite(dn) ? gaFromWD(wn, dn) : { ok: false, error: 'อ่าน GA ไม่ได้' };
        }
      } else {
        pg = parseGA(get(g.col), { unit: g.mode === 'days' ? 'days' : 'wd', decimal: opts.decimal });
      }
      if (pg.ok) usGA = pg.days;
      else if (!pg.empty) notes.push('GA จาก US: ' + pg.error);
    }
    if (usGA != null && usDate == null) notes.push('มี GA จาก US แต่ไม่มีวันที่ US');
    if (usDate != null && usGA == null) notes.push('มีวันที่ US แต่ไม่มี GA จาก US');

    var a = assessDating({ lmp: lmp, usDate: usGA != null ? usDate : null, usGA: usDate != null ? usGA : null });
    a.errors.forEach(function (e) { notes.push(ERROR_TEXT[e]); });
    if (a.t3Caution) notes.push('Redate ในไตรมาสสาม ระวังทารกโตช้า (ACOG)');
    if (a.edcFinal == null && !a.errors.length) notes.push('ไม่มีข้อมูลพอคำนวณ EDC');

    var gaAt = (mapping.dateCols || []).map(function (c) {
      var v = row[c];
      var pd = parseDateValue(v, opts);
      if (pd.empty) return { col: c, days: null };
      if (!pd.ok) { notes.push('คอลัมน์วันที่อ่านไม่ได้ (' + String(v) + ')'); return { col: c, days: null }; }
      if (a.edcFinal == null) return { col: c, days: null, day: pd.day };
      var ga = gaOn(a.edcFinal, pd.day);
      if (ga < 0) { notes.push('วันที่ ' + fmtDMYBE(pd.day) + ' อยู่ก่อนเริ่มตั้งครรภ์'); return { col: c, days: null, day: pd.day }; }
      if (ga > WARN_GA_DAYS) notes.push('GA ณ ' + fmtDMYBE(pd.day) + ' เกิน 44 สัปดาห์ ตรวจสอบวันที่');
      return { col: c, days: ga, day: pd.day };
    });

    var status = a.edcFinal == null ? 'error' : (notes.length ? 'warn' : 'ok');
    return { status: status, lmp: lmp, usDate: usDate, usGA: usGA, dating: a, gaAt: gaAt, notes: notes };
  }

  // Output columns added to the research file, in order.
  function outputHeaders(dateColNames) {
    var h = ['EDC_LMP', 'EDC_US', 'US_GA_days', 'GA_LMP_at_US', 'EDC_US_minus_LMP_days',
      'rule_band', 'rule_threshold_days', 'EDC_final', 'EDC_final_BE', 'EDC_source'];
    (dateColNames || []).forEach(function (n) { h.push('GA_' + n, 'GA_' + n + '_days'); });
    h.push('note');
    return h;
  }

  // Returns cells as {t:'date'|'num'|'text', v} (dates as day numbers), aligned with outputHeaders.
  function outputCells(res, dateColCount) {
    var cells = [];
    var n = dateColCount || 0;
    var blank = function () { return { t: 'text', v: '' }; };
    if (!res || res.status === 'empty') {
      for (var i = 0; i < 10 + n * 2 + 1; i++) cells.push(blank());
      return cells;
    }
    var a = res.dating;
    var date = function (d) { return d == null ? blank() : { t: 'date', v: d }; };
    var num = function (x) { return x == null ? blank() : { t: 'num', v: x }; };
    var text = function (x) { return x == null ? blank() : { t: 'text', v: x }; };
    cells.push(date(a.edcLmp), date(a.edcUs), num(res.usDate != null ? res.usGA : null),
      text(a.gaLmpAtUs != null && a.band ? fmtWD(a.gaLmpAtUs) : null),
      num(a.diff), text(a.band ? a.band.key : null), num(a.band ? a.band.thresholdDays : null),
      date(a.edcFinal), text(a.edcFinal != null ? fmtDMYBE(a.edcFinal) : null),
      text(a.source ? a.source : null));
    for (var k = 0; k < n; k++) {
      var g = res.gaAt[k];
      cells.push(text(g && g.days != null ? fmtWD(g.days) : null), num(g && g.days != null ? g.days : null));
    }
    cells.push(text(res.notes.length ? res.notes.join('; ') : null));
    return cells;
  }

  function dayToExcelSerial(day) { return day + EXCEL_EPOCH_OFFSET; }

  return {
    DAYS_LMP_TO_EDC: DAYS_LMP_TO_EDC, REDATING_BANDS: REDATING_BANDS, MAX_GA_DAYS: MAX_GA_DAYS,
    WARN_GA_DAYS: WARN_GA_DAYS, BE_OFFSET: BE_OFFSET,
    TH_MONTHS: TH_MONTHS, TH_MONTHS_ABBR: TH_MONTHS_ABBR, TH_WEEKDAYS: TH_WEEKDAYS,
    dayFromYMD: dayFromYMD, ymdFromDay: ymdFromDay, localToday: localToday,
    msUntilNextLocalMidnight: msUntilNextLocalMidnight, weekdayIndex: weekdayIndex,
    fmtThai: fmtThai, fmtThaiLong: fmtThaiLong, fmtDMYBE: fmtDMYBE, fmtISO: fmtISO,
    splitWD: splitWD, fmtWD: fmtWD, fmtWDThai: fmtWDThai, trimesterOf: trimesterOf,
    normalizeDigits: normalizeDigits, parseDateText: parseDateText, parseDateValue: parseDateValue,
    parseGA: parseGA, gaFromWD: gaFromWD,
    edcFromLMP: edcFromLMP, edcFromUS: edcFromUS, gaOn: gaOn, bandFor: bandFor,
    assessDating: assessDating, ERROR_TEXT: ERROR_TEXT, SOURCE_TEXT: SOURCE_TEXT, T3_CAUTION: T3_CAUTION,
    reportLine: reportLine, naegeleEDC: naegeleEDC, checkBookEDC: checkBookEDC,
    decodeText: decodeText, parseCSV: parseCSV, toCSV: toCSV,
    processRow: processRow, outputHeaders: outputHeaders, outputCells: outputCells,
    dayToExcelSerial: dayToExcelSerial, isEmptyCell: isEmptyCell
  };
});
