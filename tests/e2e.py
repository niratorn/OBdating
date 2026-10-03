"""Browser tests for index.html (Chromium via Playwright).
Run: python tests/e2e.py
"""
import csv
import io
import sys
import tempfile
from datetime import datetime, timezone, timedelta
from pathlib import Path

from openpyxl import Workbook, load_workbook
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PAGE = (ROOT / "index.html").as_uri()
BKK = timezone(timedelta(hours=7))
OUT = Path(tempfile.mkdtemp(prefix="pregwheel-e2e-"))

passed, failed = 0, 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"FAIL {name} {detail}")


def text(page, sel):
    return page.locator(sel).inner_text().strip()


def report(page):
    if not page.locator("#report").is_visible():
        return None
    return " ".join(page.locator("#report-line").inner_text().split())


def fill_date(page, sel, value):
    page.fill(sel, value)
    page.locator(sel).blur()


def wait_until(page, expr, timeout_ms=8000):
    """Poll with page.evaluate. page.wait_for_function re-checks a string predicate with
    eval, which the page's Content-Security-Policy blocks, so it failed now and then."""
    waited = 0
    while waited <= timeout_ms:
        if page.evaluate(expr):
            return
        page.wait_for_timeout(50)
        waited += 50
    raise AssertionError("timed out waiting for: " + expr)


# ---- helpers for the table mode of the research tab ----
GRID_JS = """Array.from(document.querySelectorAll('#tm-body tr')).map(function (tr) {
  return { date: tr.cells[1].firstChild.value, read: tr.cells[2].textContent, w: tr.cells[3].textContent,
           d: tr.cells[4].textContent, note: tr.cells[5].textContent, cls: tr.className }; })"""
FOCUS_ROW_JS = """(function () {
  var a = document.activeElement, tr = a && a.closest ? a.closest('#tm-body tr') : null;
  return tr ? tr.sectionRowIndex : -1; })()"""


def grid(page):
    return page.evaluate(GRID_JS)


def wd(rows):
    return [r["w"] + "+" + r["d"] if r["w"] != "" else "" for r in rows]


def put_clip(page, value):
    page.evaluate("t => navigator.clipboard.writeText(t)", value)


def get_clip(page):
    return page.evaluate("navigator.clipboard.readText()")


def paste_at(page, sel, value):
    """Put text on the clipboard, focus sel, and press Ctrl+V: a real paste event."""
    put_clip(page, value)
    page.focus(sel)
    page.keyboard.press("Control+V")


def row_box(n):
    return f"#tm-body tr:nth-child({n}) input"


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ---------------- 1. Day rollover while the page stays open ----------------
    ctx = browser.new_context(timezone_id="Asia/Bangkok", locale="th-TH", accept_downloads=True)
    page = ctx.new_page()
    page.clock.install(time=datetime(2026, 9, 30, 23, 58, 30, tzinfo=BKK))
    page.goto(PAGE, wait_until="domcontentloaded")
    check("today chip 30 Sep", text(page, "#today-text") == "พ. 30 ก.ย. 2569", text(page, "#today-text"))
    check("visit field shows today", page.input_value("#visit-date") == "30/09/2569", page.input_value("#visit-date"))
    fill_date(page, "#lmp", "01/06/2569")
    check("GA by LMP 17+2", "17 สัปดาห์ 2 วัน" in text(page, "#lmp-ga"), text(page, "#lmp-ga"))
    check("EDC 8 Mar 2570", text(page, "#res-edc") == "จ. 8 มี.ค. 2570", text(page, "#res-edc"))
    check("big GA 17+2", text(page, "#res-ga").replace("\n", "").replace(" ", "") == "17สัปดาห์2วัน", text(page, "#res-ga"))
    check("report LMP only", report(page) == "GA 17+2 Wk by date", str(report(page)))
    fill_date(page, "#book-edc", "08/03/2570")
    check("book EDC GA 17+2", "17 สัปดาห์ 2 วัน" in text(page, "#book-ga"), text(page, "#book-ga"))
    check("book EDC matches", "ตรงกัน" in text(page, "#book-check"), text(page, "#book-check"))
    fill_date(page, "#us-date", "03/08/2569")     # GA by LMP on that day = 9+0
    page.fill("#us-w", "9"); page.fill("#us-d", "2"); page.locator("#us-d").blur()
    check("report by date = U/S", report(page) == "GA 17+2 Wk by date = U/S at GA 9+0 wk", str(report(page)))
    # focus and leave the visit field without typing: must stay in today mode
    page.focus("#visit-date")
    page.locator("#visit-date").blur()
    check("visit stays live after focus", "live" in page.get_attribute("#visit-mode", "class"))
    page.clock.fast_forward("02:00")
    page.wait_for_timeout(50)
    check("today chip rolled to 1 Oct", text(page, "#today-text") == "พฤ. 1 ต.ค. 2569", text(page, "#today-text"))
    check("visit field rolled", page.input_value("#visit-date") == "01/10/2569", page.input_value("#visit-date"))
    check("GA rolled to 17+3", "17 สัปดาห์ 3 วัน" in text(page, "#lmp-ga"), text(page, "#lmp-ga"))
    check("toast shown", page.locator("#toast").is_visible())
    check("report rolled, dating part unchanged", report(page) == "GA 17+3 Wk by date = U/S at GA 9+0 wk", str(report(page)))
    check("book EDC GA rolled to 17+3", "17 สัปดาห์ 3 วัน" in text(page, "#book-ga"), text(page, "#book-ga"))

    # A sleeping tab: the clock jumps without timers firing, then the tab becomes visible
    page.clock.set_system_time(datetime(2026, 10, 3, 8, 0, 0, tzinfo=BKK))
    page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    check("visibility re-check to 3 Oct", text(page, "#today-text") == "ส. 3 ต.ค. 2569", text(page, "#today-text"))
    check("GA 17+5 on 3 Oct", "17 สัปดาห์ 5 วัน" in text(page, "#lmp-ga"), text(page, "#lmp-ga"))

    # A fixed visit date must NOT move with the clock
    fill_date(page, "#visit-date", "01/09/2563")
    check("fixed chip", "fixed" in page.get_attribute("#visit-mode", "class"))
    page.clock.set_system_time(datetime(2026, 10, 4, 9, 0, 0, tzinfo=BKK))
    page.evaluate("window.dispatchEvent(new Event('focus'))")
    check("fixed visit unchanged", page.input_value("#visit-date") == "01/09/2563", page.input_value("#visit-date"))
    check("today chip still moves", text(page, "#today-text") == "อา. 4 ต.ค. 2569", text(page, "#today-text"))
    page.click("#visit-today")
    check("back to today", page.input_value("#visit-date") == "04/10/2569", page.input_value("#visit-date"))
    ctx.close()

    # ---------------- 2. Clinic: redating cases ----------------
    ctx = browser.new_context(timezone_id="Asia/Bangkok", locale="th-TH", accept_downloads=True)
    page = ctx.new_page()
    page.clock.install(time=datetime(2026, 9, 30, 9, 0, 0, tzinfo=BKK))
    page.goto(PAGE, wait_until="domcontentloaded")
    check("empty state", "ใส่ LMP หรือผล US" in text(page, "#res-ga"), text(page, "#res-ga"))
    check("no examples section", page.locator("section.cases").count() == 0)
    check("no report when empty", report(page) is None)
    page.click("#btn-example")
    v = text(page, "#verdict")
    check("example verdict redate", "เกินเกณฑ์ ใช้ EDC จาก US" in v, v)
    check("example diff 8 days", "ต่างกัน 8 วัน" in v and "ไตรมาสแรก" in v, v)
    check("example EDC US", text(page, "#res-edc") == "พฤ. 15 เม.ย. 2564", text(page, "#res-edc"))
    check("example GA 7+5", text(page, "#res-ga").replace("\n", "").replace(" ", "") == "7สัปดาห์5วัน", text(page, "#res-ga"))
    check("example LMP GA 8+6", "8 สัปดาห์ 6 วัน" in text(page, "#lmp-ga"), text(page, "#lmp-ga"))
    check("compare US chosen", "chosen" in (page.get_attribute("#cmp-us", "class") or ""))
    check("report by U/S", report(page) == "GA 7+5 Wk by U/S ≠ date at GA 7+5 wk", str(report(page)))
    check("report EDC fix", "แก้จาก EDC ตาม LMP 07/04/2564" in text(page, "#report-edc"), text(page, "#report-edc"))
    page.select_option("#override", "LMP")
    check("override LMP EDC", text(page, "#res-edc") == "พ. 7 เม.ย. 2564", text(page, "#res-edc"))
    check("override note", "แพทย์เลือกใช้ EDC จาก LMP" in text(page, "#verdict"))
    check("report override", report(page) == "GA 8+6 Wk by date ≠ U/S at GA 8+6 wk", str(report(page)))
    page.select_option("#override", "auto")

    # copy summary
    ctx.grant_permissions(["clipboard-read", "clipboard-write"])
    page.click("#btn-copy")
    page.wait_for_timeout(100)
    clip = page.evaluate("navigator.clipboard.readText()")
    check("copy text", "EDC ที่ใช้ 15/04/2564" in clip and "ผลต่าง 8 วัน" in clip, clip)
    check("copy starts with report", clip.split("\n")[0] == "GA 7+5 Wk by U/S ≠ date at GA 7+5 wk", clip)
    check("copy has book EDC line", "EDC ในสมุด 15/04/2564 GA 7+5 wk ตรงกับ EDC ที่ใช้" in clip, clip)
    page.click("#btn-copy-report")
    page.wait_for_timeout(100)
    clip = page.evaluate("navigator.clipboard.readText()")
    check("copy report line", clip == "GA 7+5 Wk by U/S ≠ date at GA 7+5 wk", clip)

    # ANC book EDC cross-check with the case from the user's screenshot
    page.click("#btn-clear")
    check("book cleared", not page.locator("#book-out").is_visible())
    fill_date(page, "#lmp", "06/08/2569")
    fill_date(page, "#us-date", "01/09/2569")
    page.fill("#us-w", "11"); page.fill("#us-d", "0"); page.locator("#us-d").blur()
    fill_date(page, "#book-edc", "13/05/2570")
    check("book GA from old EDC", "7 สัปดาห์ 6 วัน" in text(page, "#book-ga"), text(page, "#book-ga"))
    bc = text(page, "#book-check")
    check("book differs 51 days, matches LMP", "ต่างกัน 51 วัน" in bc and "ตรงกับ EDC ตาม LMP" in bc, bc)
    check("book does not change EDC in use", text(page, "#res-edc") == "อ. 23 มี.ค. 2570", text(page, "#res-edc"))
    fill_date(page, "#book-edc", "23/03/2570")
    check("book GA 15+1 matches", "15 สัปดาห์ 1 วัน" in text(page, "#book-ga") and "ตรงกัน" in text(page, "#book-check"),
          text(page, "#book-ga") + " / " + text(page, "#book-check"))
    page.click("#btn-clear")
    fill_date(page, "#visit-date", "01/09/2563")
    fill_date(page, "#lmp", "01/07/2563")
    fill_date(page, "#book-edc", "08/04/2564")
    bc = text(page, "#book-check")
    check("book Naegele hint", "ต่างกัน 1 วัน" in bc and "Naegele" in bc, bc)
    page.click("#btn-clear")
    fill_date(page, "#book-edc", "23/03/2570")
    check("book alone gives GA", "15 สัปดาห์ 1 วัน" in text(page, "#book-ga") and "ยังไม่มี EDC" in text(page, "#book-check"),
          text(page, "#book-ga") + " / " + text(page, "#book-check"))

    # second trimester keep LMP: LMP 14+2 vs US 12+6
    page.click("#btn-clear")
    fill_date(page, "#lmp", "01/01/2569")
    fill_date(page, "#us-date", "12/04/2569")   # 101 days = 14+3
    page.fill("#us-w", "12"); page.fill("#us-d", "6"); page.locator("#us-d").blur()
    v = text(page, "#verdict")
    check("T2 keep LMP", "ไม่เกินเกณฑ์ ใช้ EDC จาก LMP" in v and "ไตรมาสสอง" in v, v)
    check("T2 report", report(page) == "GA 38+6 Wk by date = U/S at GA 14+3 wk", str(report(page)))

    # third trimester redate with caution: "28+0" typed into the weeks box is split
    page.click("#btn-clear")
    fill_date(page, "#lmp", "5 ก.พ. 67")
    fill_date(page, "#us-date", "15/09/2567")
    page.fill("#us-w", "28+0"); page.locator("#us-w").blur()
    check("weeks box split", page.input_value("#us-w") == "28" and page.input_value("#us-d") == "0",
          page.input_value("#us-w") + "/" + page.input_value("#us-d"))
    v = text(page, "#verdict")
    check("T3 redate", "เกินเกณฑ์ ใช้ EDC จาก US" in v and "ไตรมาสสาม" in v, v)
    check("T3 caution", "growth restriction" in v, v)

    # U/S before LMP (the phone case, user decision 2026-09-30): dates by U/S with a note, never stops
    page.click("#btn-clear")
    fill_date(page, "#lmp", "01/09/2569")
    fill_date(page, "#us-date", "16/08/2569")
    page.fill("#us-w", "12"); page.fill("#us-d", "0"); page.locator("#us-d").blur()
    check("US before LMP GA 18+3", text(page, "#res-ga").replace("\n", "").replace(" ", "") == "18สัปดาห์3วัน", text(page, "#res-ga"))
    check("US before LMP EDC", text(page, "#res-edc") == "อา. 28 ก.พ. 2570", text(page, "#res-edc"))
    v = text(page, "#verdict")
    check("US before LMP note", "หมายเหตุ: มีการ US ก่อน LMP" in v and "ใช้ EDC จาก US" in v, v)
    check("US before LMP shows both dates", "อา. 16 ส.ค. 2569" in v and "อ. 1 ก.ย. 2569" in v, v)
    check("US before LMP source label", "US ก่อน LMP" in text(page, "#res-src"), text(page, "#res-src"))
    check("US before LMP report", report(page) == "GA 18+3 Wk by U/S ≠ date at GA 12+0 wk", str(report(page)))
    check("no override when LMP cannot date", not page.locator("#override-wrap").is_visible())
    check("US row chosen on conflict", "chosen" in (page.get_attribute("#cmp-us", "class") or ""))
    page.click("#btn-copy")
    page.wait_for_timeout(100)
    clip = page.evaluate("navigator.clipboard.readText()")
    check("copy carries the note", clip.split("\n")[0] == "GA 18+3 Wk by U/S ≠ date at GA 12+0 wk"
          and "หมายเหตุ: มีการ US ก่อน LMP ใช้ EDC จาก US" in clip, clip)

    # LMP typed a year early: more than 44+6 weeks before the U/S, same handling
    fill_date(page, "#lmp", "01/06/2568")
    page.fill("#us-w", "11"); page.fill("#us-d", "0"); page.locator("#us-d").blur()
    v = text(page, "#verdict")
    check("LMP beyond 44+6 note", "เกิน 44+6" in v and "ใช้ EDC จาก US" in v, v)
    check("LMP beyond 44+6 report", report(page) == "GA 17+3 Wk by U/S ≠ date at GA 11+0 wk", str(report(page)))

    # invalid date message
    page.click("#btn-clear")
    fill_date(page, "#lmp", "31/02/2569")
    check("invalid date message", "ไม่มีวันที่นี้ในปฏิทิน" in text(page, "#lmp-echo"), text(page, "#lmp-echo"))

    # US only
    page.click("#btn-clear")
    page.click("#us-same")
    page.fill("#us-w", "10"); page.fill("#us-d", "0"); page.locator("#us-d").blur()
    check("US only source", "ไม่มี LMP" in text(page, "#res-src"), text(page, "#res-src"))
    check("US only GA today 10+0", text(page, "#res-ga").replace("\n", "").replace(" ", "") == "10สัปดาห์0วัน", text(page, "#res-ga"))
    check("US only report", report(page) == "GA 10+0 Wk by U/S at GA 10+0 wk", str(report(page)))
    fill_date(page, "#lmp", "01/06/2569")
    check("LMP used when typed", "ตาม LMP" in text(page, "#res-src") or "ไม่เกินเกณฑ์" in text(page, "#verdict") or "เกินเกณฑ์" in text(page, "#verdict"))
    page.check("#lmp-unknown")
    check("LMP field disabled when ticked", page.is_disabled("#lmp"))
    check("uncertain date report", report(page) == "GA 10+0 Wk by U/S at GA 10+0 wk due to uncertain date", str(report(page)))
    check("uncertain date source", "จำประจำเดือนไม่ได้" in text(page, "#res-src"), text(page, "#res-src"))
    check("no verdict when LMP unknown", not page.locator("#verdict").is_visible())
    page.uncheck("#lmp-unknown")
    check("LMP back after untick", not page.is_disabled("#lmp") and page.locator("#verdict").is_visible())
    page.click("#btn-clear")
    page.check("#lmp-unknown")
    check("prompt for U/S when ticked", "ใส่ผล U/S" in text(page, "#res-ga"), text(page, "#res-ga"))
    page.click("#btn-clear")
    check("clear unticks", not page.is_checked("#lmp-unknown") and not page.is_disabled("#lmp"))

    # screenshots: the one look
    page.click("#btn-example")
    page.set_viewport_size({"width": 1280, "height": 900})
    page.screenshot(path=str(OUT / "clinic-desktop.png"), full_page=True)
    page.set_viewport_size({"width": 390, "height": 844})
    page.screenshot(path=str(OUT / "clinic-phone.png"), full_page=True)
    sw = page.evaluate("document.documentElement.scrollWidth")
    check("no horizontal scroll on phone", sw <= 390, str(sw))
    ctx.close()

    # dark mode
    ctx = browser.new_context(timezone_id="Asia/Bangkok", color_scheme="dark", viewport={"width": 1280, "height": 900})
    page = ctx.new_page()
    page.clock.install(time=datetime(2026, 9, 30, 9, 0, 0, tzinfo=BKK))
    page.goto(PAGE, wait_until="domcontentloaded")
    page.click("#btn-example")
    page.screenshot(path=str(OUT / "clinic-dark.png"), full_page=True)
    ctx.close()

    # ---------------- 3. Research tab, table mode: one woman at a time (requested 2026-10-03) ----------------
    EX_DATES = ["8/2/2022", "18/3/2022", "4/5/2022", "23/6/2022", "12/8/2022", "6/9/2022", "20/10/2023"]
    EX_COPY = "8\t6\r\n14\t2\r\n21\t0\r\n28\t1\r\n35\t2\r\n38\t6\r\n\t"
    ctx = browser.new_context(timezone_id="Asia/Bangkok", locale="th-TH", accept_downloads=True,
                              viewport={"width": 1280, "height": 900})
    ctx.grant_permissions(["clipboard-read", "clipboard-write"])
    page = ctx.new_page()
    page_errors = []
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    page.on("console", lambda m: page_errors.append(m.text) if m.type == "error" else None)
    page.goto(PAGE, wait_until="domcontentloaded")
    page.click("#tab-research")
    check("table mode opens first", page.locator("#research-table").is_visible()
          and not page.locator("#research-file").is_visible()
          and page.get_attribute("#mode-table", "aria-pressed") == "true"
          and page.get_attribute("#mode-file", "aria-pressed") == "false")
    check("file mode not loaded until asked for", page.evaluate("PregWheel.research._state.src") is None)
    g = grid(page)
    check("table starts with 6 empty rows", len(g) == 6 and all(r["date"] == "" and r["w"] == "" for r in g), str(g))
    check("table empty summary", text(page, "#tm-summary") == "ยังไม่มีวันที่รับบริการ", text(page, "#tm-summary"))
    check("tab label names both modes", text(page, "#tab-research") == "งานวิจัย (ตาราง หรือไฟล์)", text(page, "#tab-research"))

    # nothing to copy yet: each button says what is missing and copies nothing
    put_clip(page, "untouched")
    page.click("#tm-copy")
    check("copy without reference", "ใส่ค่าอ้างอิงในขั้นที่ 1 ก่อน" in text(page, "#tm-copy-status"), text(page, "#tm-copy-status"))
    page.fill("#tm-edc", "14/9/2022")
    page.click("#tm-copy-edc")
    check("copy without dates", "ใส่วันที่รับบริการในขั้นที่ 2 ก่อน" in text(page, "#tm-copy-status"), text(page, "#tm-copy-status"))
    check("clipboard untouched when nothing to copy", get_clip(page) == "untouched", repr(get_clip(page)))

    # reference as EDC, Enter lands on row 1, then a column pasted from Google Sheets (LF between rows)
    page.focus("#tm-edc")
    page.keyboard.press("Enter")
    echo = text(page, "#tm-anchor-echo")
    check("EDC echo", "วันพุธที่ 14 กันยายน พ.ศ. 2565" in echo and "เทียบเท่า LMP พ. 8 ธ.ค. 2564" in echo, echo)
    check("Enter moves to row 1", page.evaluate(FOCUS_ROW_JS) == 0, str(page.evaluate(FOCUS_ROW_JS)))
    put_clip(page, "\n".join(EX_DATES))
    page.keyboard.press("Control+V")
    g = grid(page)
    check("pasted rows plus one free row", [r["date"] for r in g] == EX_DATES + [""], str([r["date"] for r in g]))
    check("GA of the example rows", wd(g) == ["8+6", "14+2", "21+0", "28+1", "35+2", "38+6", "", ""], str(wd(g)))
    check("date echoed as read", g[0]["read"] == "อ. 8 ก.พ. 2565" and g[6]["read"] == "ศ. 20 ต.ค. 2566", g[0]["read"] + " / " + g[6]["read"])
    check("row beyond 44+6 left blank with a note", g[6]["note"] == "GA เกิน 44+6 สัปดาห์" and g[6]["cls"] == "st-bad", str(g[6]))
    check("paste status", text(page, "#tm-paste-status") == "วาง 7 แถว", text(page, "#tm-paste-status"))
    check("summary after paste", text(page, "#tm-summary") == "7 แถว คำนวณได้ 6 เว้นว่าง 1 · ใช้ EDC 14/09/2022", text(page, "#tm-summary"))
    check("focus on the free row after a paste", page.evaluate(FOCUS_ROW_JS) == 7, str(page.evaluate(FOCUS_ROW_JS)))
    page.screenshot(path=str(OUT / "table-desktop.png"), full_page=True)

    # copy back: same number of lines as rows, blank cells where there is no GA
    page.click("#tm-copy")
    page.wait_for_timeout(100)
    check("copy ga_week and ga_days", get_clip(page) == EX_COPY, repr(get_clip(page)))
    st = text(page, "#tm-copy-status")
    check("copy status", "คัดลอกแล้ว 7 แถว คำนวณได้ 6 เว้นว่าง 1" in st and "ช่อง ga_week ของแถวแรก" in st, st)
    page.click("#tm-copy-edc")
    page.wait_for_timeout(100)
    lines = get_clip(page).split("\r\n")
    check("copy with EDC: 3 cells a row", lines[0] == "14/09/2022\t8\t6" and lines[5] == "14/09/2022\t38\t6"
          and lines[6] == "\t\t" and len(lines) == 7, repr(lines))
    check("copy with EDC status", "ช่อง EDC ของแถวแรก" in text(page, "#tm-copy-status"), text(page, "#tm-copy-status"))
    check("no fallback box when the clipboard works", not page.locator("#tm-copy-fallback").is_visible())

    # next woman, dates pasted first (Excel style: CR LF, a trailing break, an empty cell inside),
    # with no box in focus: the old rows go, and a warning says the reference is still the old one
    check("no stale warning yet", not page.locator("#tm-stale").is_visible())
    paste_at(page, "#tm-copy", "10/8/2022\r\n\r\n3/2/2022\r\n11/1/2022\r\n")
    g = grid(page)
    check("paste replaces the rows of the woman before", [r["date"] for r in g] == ["10/8/2022", "", "3/2/2022", "11/1/2022", "", ""], str([r["date"] for r in g]))
    check("empty row inside keeps its place", wd(g) == ["35+0", "", "8+1", "4+6", "", ""], str(wd(g)))
    check("replace status", text(page, "#tm-paste-status") == "วาง 4 แถว แทนที่ของเดิม 7 แถว", text(page, "#tm-paste-status"))
    check("stale reference warning", page.locator("#tm-stale").is_visible())
    check("old copy status cleared", text(page, "#tm-copy-status") == "", text(page, "#tm-copy-status"))
    page.click("#tm-copy")
    page.wait_for_timeout(100)
    check("copy keeps the empty row", get_clip(page) == "35\t0\r\n\t\r\n8\t1\r\n4\t6", repr(get_clip(page)))
    st = text(page, "#tm-copy-status")
    check("a copy made under the warning says so", "ค่าอ้างอิงยังเป็นค่าเดิม ตรวจก่อนวาง" in st
          and "warn" in page.get_attribute("#tm-copy-status", "class") and page.locator("#tm-stale").is_visible(), st)
    paste_at(page, "#tm-copy", "10/8/2022\n19/4/2022")
    check("warning stays for the next paste", page.locator("#tm-stale").is_visible())
    page.fill("#tm-edc", "22/8/2022")
    check("warning goes when the reference changes", not page.locator("#tm-stale").is_visible())
    page.click("#tm-copy")
    page.wait_for_timeout(100)
    st = text(page, "#tm-copy-status")
    check("copy after a new reference is plain again", "ตรวจก่อนวาง" not in st and "ok" in page.get_attribute("#tm-copy-status", "class"), st)
    paste_at(page, row_box(1), "10/8/2022\n19/4/2022")
    check("pasting again after that copy warns again", page.locator("#tm-stale").is_visible())
    page.fill("#tm-edc", "22/08/2022")
    check("warning cleared by retyping the reference", not page.locator("#tm-stale").is_visible())
    check("rows follow the new EDC", wd(grid(page))[:2] == ["38+2", "22+1"], str(wd(grid(page))))

    # several columns pasted into a later row: the date column is found, rows above stay
    paste_at(page, row_box(3), "A1\t3/2/2022\t5\nA1\t11/1/2022\t2")
    g = grid(page)
    check("paste from row 3 keeps rows above", [r["date"] for r in g][:4] == ["10/8/2022", "19/4/2022", "3/2/2022", "11/1/2022"], str([r["date"] for r in g]))
    check("multi-column status", text(page, "#tm-paste-status") == "วาง 2 แถว ตั้งแต่แถว 3 ใช้คอลัมน์ที่ 2 จาก 3 คอลัมน์เป็นวันที่รับบริการ", text(page, "#tm-paste-status"))
    check("GA after a multi-column paste", wd(g)[:4] == ["38+2", "22+1", "11+3", "8+1"], str(wd(g)))

    # a note cell with a line break inside: rows stay in place and the page asks for a check
    paste_at(page, row_box(1), '10/8/2022\t"มาตามนัด\nนัดอีก 4 สัปดาห์"\n19/4/2022\tปกติ')
    g = grid(page)
    st = text(page, "#tm-paste-status")
    check("multi-line cell keeps two rows", [r["date"] for r in g][:3] == ["10/8/2022", "19/4/2022", ""], str([r["date"] for r in g]))
    check("multi-line cell asks to check the row count", "ตรวจว่าจำนวนแถวตรงกับในชีต" in st
          and "warn" in page.get_attribute("#tm-paste-status", "class"), st)

    # several cells pasted into the EDC box go to the table, never into the box
    paste_at(page, "#tm-edc", "1/3/2022\n8/3/2022\n15/3/2022")
    check("multi-cell paste in the EDC box goes to the table", page.input_value("#tm-edc") == "22/08/2022"
          and [r["date"] for r in grid(page)][:3] == ["1/3/2022", "8/3/2022", "15/3/2022"], page.input_value("#tm-edc"))
    # text without any date, pasted with no box in focus, is refused and the table stays
    paste_at(page, "#tm-copy", "ชื่อ\nนามสกุล\nที่อยู่")
    check("paste without dates refused", "ไม่มีวันที่ที่อ่านได้" in text(page, "#tm-paste-status")
          and [r["date"] for r in grid(page)][:3] == ["1/3/2022", "8/3/2022", "15/3/2022"], text(page, "#tm-paste-status"))
    # one cell pasted into a date box is an ordinary paste
    paste_at(page, row_box(4), "22/3/2022")
    check("single-cell paste fills one box", grid(page)[3]["date"] == "22/3/2022" and len(grid(page)) == 6, str(grid(page)[3]))

    # clear for the next woman
    page.click("#tm-clear")
    g = grid(page)
    check("clear empties everything", page.input_value("#tm-edc") == "" and len(g) == 6 and all(r["date"] == "" for r in g)
          and text(page, "#tm-paste-status") == "" and text(page, "#tm-copy-status") == "" and not page.locator("#tm-stale").is_visible())
    check("clear puts the cursor in the EDC box", page.evaluate("document.activeElement.id") == "tm-edc")

    # reference as GA on a date: "12+0" typed into the weeks box is split, the EDC comes out the same
    page.fill("#tm-ga-w", "12+0")
    check("weeks box split", page.input_value("#tm-ga-w") == "12" and page.input_value("#tm-ga-d") == "0",
          page.input_value("#tm-ga-w") + "/" + page.input_value("#tm-ga-d"))
    check("typing a GA selects that reference", page.is_checked("#tm-by-ga") and not page.is_checked("#tm-by-edc"))
    check("asks for the date", text(page, "#tm-anchor-echo") == "ใส่วันที่ที่ GA เท่ากับ 12+0", text(page, "#tm-anchor-echo"))
    page.fill("#tm-ga-date", "2/3/2022")
    page.press("#tm-ga-date", "Enter")
    echo = text(page, "#tm-anchor-echo")
    check("GA reference echo", echo == "EDC ที่ใช้ วันพุธที่ 14 กันยายน พ.ศ. 2565 คิดจาก GA 12+0 ณ พ. 2 มี.ค. 2565", echo)
    check("Enter after the GA date moves to row 1", page.evaluate(FOCUS_ROW_JS) == 0)
    put_clip(page, "\n".join(EX_DATES))
    page.keyboard.press("Control+V")
    check("GA reference gives the same rows", wd(grid(page)) == ["8+6", "14+2", "21+0", "28+1", "35+2", "38+6", "", ""], str(wd(grid(page))))
    page.fill("#tm-ga-d", "7")
    check("GA days above 6 refused", "วันต้องเป็น 0 ถึง 6" in text(page, "#tm-anchor-echo") and wd(grid(page))[0] == "", text(page, "#tm-anchor-echo"))
    page.fill("#tm-ga-d", "3")           # 12+3 on 2/3/2022: three days further on
    check("GA days shift every row", wd(grid(page))[:2] == ["9+2", "14+5"], str(wd(grid(page))))
    page.fill("#tm-ga-w", "0"); page.fill("#tm-ga-d", "0"); page.fill("#tm-ga-date", "8/12/2021")
    check("GA 0+0 on the LMP day", wd(grid(page))[:2] == ["8+6", "14+2"] and "วันพุธที่ 14 กันยายน พ.ศ. 2565" in text(page, "#tm-anchor-echo"),
          str(wd(grid(page))) + text(page, "#tm-anchor-echo"))
    page.check("#tm-by-edc")               # back to the EDC box, which is empty: rows wait, nothing is guessed
    g = grid(page)
    check("empty EDC reference gives no GA", wd(g)[0] == "" and g[0]["cls"] == "st-wait" and g[0]["read"] == "อ. 8 ก.พ. 2565", str(g[0]))
    check("summary without reference", text(page, "#tm-summary") == "7 แถว ยังไม่มีค่าอ้างอิง", text(page, "#tm-summary"))

    # B.E. dates: same GA, and the EDC is written back in B.E. too
    page.click("#tm-clear")
    page.fill("#tm-edc", "14/09/2565")
    paste_at(page, row_box(1), "08/02/2565\n18 มี.ค. 65\n๔/๕/๒๕๖๕")
    check("B.E., Thai month and Thai digits", wd(grid(page))[:3] == ["8+6", "14+2", "21+0"], str(wd(grid(page))))
    page.click("#tm-copy-edc")
    page.wait_for_timeout(100)
    check("EDC copied in B.E. when the dates are B.E.", get_clip(page) == "14/09/2565\t8\t6\r\n14/09/2565\t14\t2\r\n14/09/2565\t21\t0", repr(get_clip(page)))
    # EDC picked from the calendar is shown in B.E.; C.E. dates in the table still decide what is copied
    page.fill("#tm-edc-picker", "2022-09-14")
    check("calendar picker fills the EDC box", page.input_value("#tm-edc") == "14/09/2565", page.input_value("#tm-edc"))
    paste_at(page, row_box(1), "8/2/2022\n18/3/2022")
    page.click("#tm-copy-edc")
    page.wait_for_timeout(100)
    check("EDC copied in C.E. when the dates are C.E.", get_clip(page) == "14/09/2022\t8\t6\r\n14/09/2022\t14\t2", repr(get_clip(page)))

    # typing by hand: Enter and the arrows move between rows, a new row appears, a half-typed date is not an error yet
    page.click("#tm-clear")
    page.fill("#tm-edc", "14/9/2022")
    page.click(row_box(1))
    page.keyboard.type("8/2/2022")
    page.keyboard.press("Enter")
    check("Enter moves down a row", page.evaluate(FOCUS_ROW_JS) == 1)
    page.keyboard.type("18/3")
    g = grid(page)
    check("half-typed date is quiet", g[1]["note"] == "" and g[1]["cls"] == "st-wait" and g[1]["w"] == "", str(g[1]))
    page.keyboard.press("ArrowUp")
    g = grid(page)
    check("leaving the box shows the error", g[1]["cls"] == "st-bad" and g[1]["note"] != "" and page.evaluate(FOCUS_ROW_JS) == 0, str(g[1]))
    page.keyboard.press("ArrowDown")       # arriving by keyboard selects the box, as in a spreadsheet
    page.keyboard.press("End")
    page.keyboard.type("/2022")
    check("finished date clears the error", wd(grid(page))[:2] == ["8+6", "14+2"] and grid(page)[1]["note"] == "", str(grid(page)[1]))
    for n in range(3, 7):
        page.fill(row_box(n), "1/3/2022")
    check("typing in the last row adds a row", len(grid(page)) == 7, str(len(grid(page))))
    page.fill(row_box(3), "7/12/2021")
    g = grid(page)
    check("date before day 0 left blank with a note", g[2]["w"] == "" and g[2]["note"] == "วันที่อยู่ก่อนเริ่มตั้งครรภ์", str(g[2]))
    page.fill(row_box(4), "13/10/2022")   # 44+1
    g = grid(page)
    check("GA past 44 weeks shown with a note", wd(g)[3] == "44+1" and "เกิน 44 สัปดาห์" in g[3]["note"] and g[3]["cls"] == "st-warn", str(g[3]))

    # the example button, and what the fallbacks do when the clipboard API is refused
    page.click("#tm-example")
    check("example fills the table", wd(grid(page)) == ["8+6", "14+2", "21+0", "28+1", "35+2", "38+6", "", ""]
          and page.input_value("#tm-edc") == "14/09/2022" and "ตัวอย่างสมมติ 7 แถว" in text(page, "#tm-paste-status"), str(wd(grid(page))))
    put_clip(page, "before")
    page.evaluate("""(function () {
      window.__write = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = function () { return Promise.reject(new Error('blocked')); };
    })()""")
    page.click("#tm-copy")
    page.wait_for_timeout(150)
    check("fallback copy through the text box", "คัดลอกแล้ว 7 แถว" in text(page, "#tm-copy-status")
          and not page.locator("#tm-copy-fallback").is_visible()
          and get_clip(page).replace("\r\n", "\n") == EX_COPY.replace("\r\n", "\n"),   # a text box keeps LF only
          text(page, "#tm-copy-status") + " " + repr(get_clip(page)))
    page.evaluate("document.execCommand = function () { return false; }")
    page.click("#tm-copy-edc")
    page.wait_for_timeout(150)
    box = page.input_value("#tm-copy-fallback")
    check("last resort: box left open and selected", page.locator("#tm-copy-fallback").is_visible()
          and box.split("\n")[0] == "14/09/2022\t8\t6" and len(box.split("\n")) == 7 and "กด Ctrl+C" in text(page, "#tm-copy-status")
          and page.evaluate("(function () { var b = document.getElementById('tm-copy-fallback'); return document.activeElement === b && b.selectionStart === 0 && b.selectionEnd === b.value.length; })()"),
          text(page, "#tm-copy-status"))
    page.evaluate("(function () { navigator.clipboard.writeText = window.__write; delete document.execCommand; })()")
    page.click("#tm-copy")
    page.wait_for_timeout(100)
    check("box closes again once the clipboard works", not page.locator("#tm-copy-fallback").is_visible() and get_clip(page) == EX_COPY)

    # the other mode and the other tab keep what was typed
    page.click("#mode-file")
    check("file mode shown on request", page.locator("#research-file").is_visible() and not page.locator("#research-table").is_visible()
          and page.get_attribute("#mode-file", "aria-pressed") == "true")
    check("file mode loads its sample", "แถวข้อมูล\n7" in text(page, "#stats"), text(page, "#stats"))
    page.click("#tab-clinic")
    page.click("#tab-research")
    check("research tab reopens in the mode last used", page.locator("#research-file").is_visible())
    page.click("#mode-table")
    check("table kept its rows", wd(grid(page))[:2] == ["8+6", "14+2"] and page.input_value("#tm-edc") == "14/09/2022", str(wd(grid(page))))

    # a very long paste is cut at the cap and says so
    page.click("#tm-clear")
    page.fill("#tm-edc", "14/9/2022")
    paste_at(page, row_box(1), "\n".join(["8/2/2022"] * 2010))
    g = grid(page)
    check("long paste cut at 2000 rows", len(g) == 2000 and wd(g)[1999] == "8+6" and "ตารางรับได้ 2000 แถว" in text(page, "#tm-paste-status"),
          str(len(g)) + " " + text(page, "#tm-paste-status"))
    page.click("#tm-clear")

    # phone: no sideways scroll of the page, and the two results fit on screen
    page.click("#tm-example")
    page.set_viewport_size({"width": 390, "height": 844})
    page.screenshot(path=str(OUT / "table-phone.png"), full_page=True)
    sw = page.evaluate("document.documentElement.scrollWidth")
    check("table mode: no horizontal scroll on phone", sw <= 390, str(sw))
    edge = page.evaluate("document.querySelector('#tm-body tr td:nth-child(5)').getBoundingClientRect().right")
    check("table mode: ga_days visible on phone", edge <= 390, str(edge))
    check("no script errors in table mode", page_errors == [], str(page_errors))
    ctx.close()

    # dark mode
    ctx = browser.new_context(timezone_id="Asia/Bangkok", color_scheme="dark", viewport={"width": 1280, "height": 900})
    page = ctx.new_page()
    page.goto(PAGE, wait_until="domcontentloaded")
    page.click("#tab-research")
    page.click("#tm-example")
    page.screenshot(path=str(OUT / "table-dark.png"), full_page=True)
    ctx.close()

    # ---------------- 3b. Research tab, file mode ----------------
    ctx = browser.new_context(timezone_id="Asia/Bangkok", locale="th-TH", accept_downloads=True,
                              viewport={"width": 1280, "height": 900})
    page = ctx.new_page()
    page.goto(PAGE, wait_until="domcontentloaded")
    page.click("#tab-research")
    page.click("#mode-file")
    stats = text(page, "#stats")
    check("sample stats rows", "แถวข้อมูล\n7" in stats, stats)
    check("sample redate count", "ยึด US ตามเกณฑ์\n3" in stats, stats)
    mapping = page.evaluate("PregWheel.research._state.mapping")
    check("auto map lmp", mapping["lmp"] == 1, str(mapping))
    check("auto map us date", mapping["usDate"] == 3, str(mapping))
    check("auto map ga", mapping["usGA"]["col"] == 4, str(mapping))
    check("auto date cols", mapping["dateCols"] == [2, 5, 6], str(mapping))
    page.screenshot(path=str(OUT / "research-desktop.png"), full_page=True)

    with page.expect_download() as dl:
        page.click("#dl-csv")
    csv_path = OUT / dl.value.suggested_filename
    dl.value.save_as(csv_path)
    rows = list(csv.reader(io.StringIO(csv_path.read_text(encoding="utf-8-sig"))))
    hdr = rows[0]
    byid = {r[0]: dict(zip(hdr, r)) for r in rows[1:] if r}
    check("csv A001 EDC_final", byid["A001"]["EDC_final"] == "2021-04-15", str(byid["A001"]))
    check("csv A001 source US", byid["A001"]["EDC_source"] == "US")
    check("csv A001 GA at booking", byid["A001"]["GA_วันที่ฝากครรภ์"] == "7+5", byid["A001"].get("GA_วันที่ฝากครรภ์"))
    check("csv A001 GA at delivery", byid["A001"]["GA_วันคลอด"] == "39+2", byid["A001"].get("GA_วันคลอด"))
    check("csv A002 LMP only", byid["A002"]["EDC_source"] == "LMP_ONLY")
    check("csv A003 keep LMP", byid["A003"]["EDC_source"] == "LMP" and byid["A003"]["EDC_US_minus_LMP_days"] == "0")
    check("csv A004 T2 redate", byid["A004"]["EDC_source"] == "US" and byid["A004"]["rule_band"] == "T2", str(byid["A004"]))
    check("csv A005 T3 redate", byid["A005"]["EDC_source"] == "US" and "ไตรมาสสาม" in byid["A005"]["note"], str(byid["A005"]))
    check("csv A006 US only", byid["A006"]["EDC_source"] == "US_ONLY")
    check("csv A007 error note", byid["A007"]["EDC_final"] == "" and "LMP อ่านไม่ได้" in byid["A007"]["note"], str(byid["A007"]))

    with page.expect_download() as dl:
        page.click("#dl-xlsx")
    x_path = OUT / dl.value.suggested_filename
    dl.value.save_as(x_path)
    wb = load_workbook(x_path)
    ws = wb.active
    header = [c.value for c in ws[1]]
    col = {h: i for i, h in enumerate(header)}
    r2 = [c for c in ws[2]]
    check("xlsx EDC_final is a date", isinstance(r2[col["EDC_final"]].value, datetime), repr(r2[col["EDC_final"]].value))
    check("xlsx EDC_final value", r2[col["EDC_final"]].value.date().isoformat() == "2021-04-15")
    check("xlsx date format", r2[col["EDC_final"]].number_format.lower() == "dd/mm/yyyy", r2[col["EDC_final"]].number_format)
    check("xlsx BE text", r2[col["EDC_final_BE"]].value == "15/04/2564")
    check("xlsx diff numeric", r2[col["EDC_US_minus_LMP_days"]].value == 8)

    # ---- an Excel file with a title row, real dates, a B.E. year typed as C.E., text dates
    xin = OUT / "anc_export.xlsx"
    wb = Workbook()
    ws = wb.active
    ws.title = "ANC"
    ws.append(["รายงานฝากครรภ์ รพ.ตัวอย่าง"])
    ws.append(["HN", "วันที่ฝากครรภ์", "LMP", "US date", "US GA", "วันเกิดแม่"])
    ws.append(["X1", datetime(2020, 9, 1), datetime(2020, 7, 1), datetime(2020, 9, 1), "7+5", datetime(1995, 1, 1)])
    ws.append(["X2", datetime(2563, 9, 1), datetime(2563, 7, 1), None, None, datetime(1990, 5, 5)])
    ws.append(["X3", "20/01/2566", "2 พ.ย. 65", "20/01/2566", 11, None])
    for r in range(3, 6):
        for c in (2, 3, 4, 6):
            if isinstance(ws.cell(r, c).value, datetime):
                ws.cell(r, c).number_format = "dd/mm/yyyy"
    wb.save(xin)
    page.set_input_files("#file", str(xin))
    wait_until(page, "!!(PregWheel.research._state.src && PregWheel.research._state.src.fileName === 'anc_export.xlsx')")
    st = page.evaluate("PregWheel.research._state")
    check("xlsx header row 2", page.input_value("#header-row") == "2", page.input_value("#header-row"))
    check("xlsx map lmp", st["mapping"]["lmp"] == 2, str(st["mapping"]))
    check("xlsx map us", st["mapping"]["usDate"] == 3 and st["mapping"]["usGA"]["col"] == 4, str(st["mapping"]))
    check("xlsx skip DOB", 5 not in st["mapping"]["dateCols"] and 1 in st["mapping"]["dateCols"], str(st["mapping"]))
    with page.expect_download() as dl:
        page.click("#dl-xlsx")
    out2 = OUT / "anc_out.xlsx"
    dl.value.save_as(out2)
    ws2 = load_workbook(out2).active
    hdr2 = [c.value for c in ws2[2]]
    c2 = {h: i for i, h in enumerate(hdr2)}
    check("title row kept", ws2.cell(1, 1).value == "รายงานฝากครรภ์ รพ.ตัวอย่าง")
    check("orig date kept as date", isinstance(ws2.cell(3, 2).value, datetime))
    x1 = [c.value for c in ws2[3]]
    x2 = [c.value for c in ws2[4]]
    x3 = [c.value for c in ws2[5]]
    check("X1 EDC US", x1[c2["EDC_final_BE"]] == "15/04/2564" and x1[c2["EDC_source"]] == "US", str(x1))
    check("X2 BE typed as CE", x2[c2["EDC_final_BE"]] == "07/04/2564" and x2[c2["GA_วันที่ฝากครรภ์"]] == "8+6", str(x2))
    check("X3 numeric weeks and Thai text date", x3[c2["EDC_source"]] == "US" or x3[c2["EDC_source"]] == "LMP", str(x3))
    check("X3 GA 11 wk vs 11+2 keeps LMP", x3[c2["EDC_source"]] == "LMP" and x3[c2["EDC_US_minus_LMP_days"]] == 2, str(x3))

    # ---- Windows-874 CSV
    cin = OUT / "tis620.csv"
    cin.write_bytes("เลขที่,LMP,วันที่ตรวจ\r\nB1,01/06/2569,30/09/2569\r\n".encode("cp874"))
    page.set_input_files("#file", str(cin))
    wait_until(page, "!!(PregWheel.research._state.src && PregWheel.research._state.src.fileName === 'tis620.csv')")
    info = text(page, "#file-info")
    check("cp874 decoded", "Windows-874" in info, info)
    prev = text(page, "#preview")
    check("cp874 header Thai", "เลขที่" in prev and "17+2" in prev, prev)

    # ---- a file with a U/S done before the LMP: U/S EDC, note, stats say so (user decision 2026-09-30)
    cfl = OUT / "conflict.csv"
    cfl.write_text("ID,LMP,US date,US GA,วันที่ตรวจ\r\nC1,01/09/2569,16/08/2569,12+0,30/09/2569\r\n"
                   "C2,01/07/2563,01/09/2563,7+5,01/09/2563\r\n", encoding="utf-8")
    page.set_input_files("#file", str(cfl))
    wait_until(page, "!!(PregWheel.research._state.src && PregWheel.research._state.src.fileName === 'conflict.csv')")
    stats = text(page, "#stats")
    check("conflict row counted as US", "ยึด US ตามเกณฑ์\n2" in stats and "LMP ใช้ไม่ได้ 1" in stats, stats)
    prev = text(page, "#preview")
    check("conflict row previewed with note", "มีการ US ก่อน LMP" in prev and "28/02/2570" in prev and "18+3" in prev, prev)
    with page.expect_download() as dl:
        page.click("#dl-csv")
    cpath = OUT / "conflict_out.csv"
    dl.value.save_as(cpath)
    crow = list(csv.DictReader(io.StringIO(cpath.read_text(encoding="utf-8-sig"))))[0]
    check("csv conflict row", crow["EDC_source"] == "US" and crow["EDC_final_BE"] == "28/02/2570"
          and crow["rule_band"] == "" and crow["EDC_US_minus_LMP_days"] == "" and crow["note"] == "มีการ US ก่อน LMP", str(crow))
    page.set_viewport_size({"width": 390, "height": 844})
    page.screenshot(path=str(OUT / "research-phone.png"), full_page=True)
    sw = page.evaluate("document.documentElement.scrollWidth")
    check("research no horizontal scroll on phone", sw <= 390, str(sw))
    ctx.close()
    browser.close()

# ---------------- 4. Security: served over http, CSP active, nothing leaves the page ----------------
import functools
import http.server
import threading

CSP_WATCH = """
window.__csp = [];
document.addEventListener('securitypolicyviolation', function (e) {
  window.__csp.push(e.violatedDirective + ' ' + e.blockedURI);
});
"""
class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


handler = functools.partial(QuietHandler, directory=str(ROOT))
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_address[1]}/index.html"
with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(timezone_id="Asia/Bangkok", accept_downloads=True)
    ctx.grant_permissions(["clipboard-read", "clipboard-write"])
    ctx.add_init_script(CSP_WATCH)
    page = ctx.new_page()
    external = []
    page.on("request", lambda r: external.append(r.url) if not r.url.startswith(f"http://127.0.0.1:{srv.server_address[1]}/") and not r.url.startswith("blob:") and not r.url.startswith("data:") else None)
    page.goto(base, wait_until="load")
    csp = page.evaluate("document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]').content")
    check("CSP present and blocks network", "connect-src 'none'" in csp and "default-src 'none'" in csp, csp[:120])
    page.evaluate("document.fonts.ready")
    check("self-hosted font loads", page.evaluate("document.fonts.check('16px \"IBM Plex Sans Thai\"', 'กขค')"))
    page.click("#btn-example")
    check("app works under CSP", report(page) == "GA 7+5 Wk by U/S ≠ date at GA 7+5 wk", str(report(page)))
    page.click("#tab-research")
    # table mode under the policy: type the EDC, paste a column, copy both ways
    page.fill("#tm-edc", "14/9/2022")
    paste_at(page, row_box(1), "8/2/2022\n18/3/2022\n20/10/2023")
    check("table mode works under CSP", wd(grid(page))[:3] == ["8+6", "14+2", ""], str(wd(grid(page))))
    page.click("#tm-copy")
    page.wait_for_timeout(100)
    check("copy works under CSP", get_clip(page) == "8\t6\r\n14\t2\r\n\t", repr(get_clip(page)))
    page.click("#tm-copy-edc")
    page.wait_for_timeout(100)
    check("copy with EDC works under CSP", get_clip(page).split("\r\n")[0] == "14/09/2022\t8\t6", repr(get_clip(page)))
    page.click("#tm-example")
    page.click("#tm-clear")
    page.click("#mode-file")
    page.set_input_files("#file", str(xin))
    wait_until(page, "!!(PregWheel.research._state.src && PregWheel.research._state.src.fileName === 'anc_export.xlsx')")
    with page.expect_download():
        page.click("#dl-xlsx")
    with page.expect_download():
        page.click("#dl-csv")
    violations = page.evaluate("window.__csp")
    check("no CSP violations in normal use", violations == [], str(violations))
    check("no request leaves the page", external == [], str(external))
    page.evaluate("fetch('https://example.com/leak?x=1').catch(function () {})")
    page.wait_for_timeout(300)
    violations = page.evaluate("window.__csp")
    check("sending data out is blocked", any(v.startswith("connect-src") for v in violations), str(violations))
    browser.close()
srv.shutdown()

print(f"{passed} passed, {failed} failed")
print(f"screenshots in {OUT}")
sys.exit(1 if failed else 0)
