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

    # US before LMP
    page.click("#btn-clear")
    fill_date(page, "#lmp", "01/06/2569")
    fill_date(page, "#us-date", "01/05/2569")
    page.fill("#us-w", "8"); page.locator("#us-w").blur()
    check("US before LMP error", "ตรวจสอบวันที่" in text(page, "#verdict"))
    check("no EDC on conflict", "คำนวณไม่ได้" in text(page, "#res-ga"))
    check("no report on conflict", report(page) is None)

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

    # ---------------- 3. Research tab ----------------
    ctx = browser.new_context(timezone_id="Asia/Bangkok", locale="th-TH", accept_downloads=True,
                              viewport={"width": 1280, "height": 900})
    page = ctx.new_page()
    page.goto(PAGE, wait_until="domcontentloaded")
    page.click("#tab-research")
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
    page.wait_for_function("PregWheel.research._state.src && PregWheel.research._state.src.fileName === 'anc_export.xlsx'")
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
    page.wait_for_function("PregWheel.research._state.src && PregWheel.research._state.src.fileName === 'tis620.csv'")
    info = text(page, "#file-info")
    check("cp874 decoded", "Windows-874" in info, info)
    prev = text(page, "#preview")
    check("cp874 header Thai", "เลขที่" in prev and "17+2" in prev, prev)
    page.set_viewport_size({"width": 390, "height": 844})
    page.screenshot(path=str(OUT / "research-phone.png"), full_page=True)
    sw = page.evaluate("document.documentElement.scrollWidth")
    check("research no horizontal scroll on phone", sw <= 390, str(sw))
    ctx.close()
    browser.close()

print(f"{passed} passed, {failed} failed")
print(f"screenshots in {OUT}")
sys.exit(1 if failed else 0)
