"""Build the two copies of the page from src/.

index.html          full HTML document, SheetJS inlined, works offline and on any web host
dist/artifact.html  page content for the claude.ai artifact, SheetJS loaded from cdnjs

Edit files in src/ only, then run:  python build.py
"""
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / "src"
DIST = ROOT / "dist"
XLSX_LOCAL = ROOT / "vendor" / "xlsx-0.18.5.full.min.js"
XLSX_CDN = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"

TITLE = "วงล้ออายุครรภ์"
FONTS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
    'family=IBM+Plex+Sans+Thai:wght@400;500;600&family=Trirong:wght@500;600&display=swap">'
)


def read(name):
    return (SRC / name).read_text(encoding="utf-8")


def safe_inline(js):
    # A literal "</script" inside an inline script would end it early.
    return js.replace("</script", "<\\/script")


def main():
    css = read("styles.css")
    body = read("body.html")
    core = read("core.js")
    app = read("app.js")
    DIST.mkdir(exist_ok=True)

    meta = '<meta name="robots" content="noindex, nofollow">'

    artifact = "\n".join([
        f"<title>{TITLE}</title>",
        meta,
        FONTS,
        f"<style>\n{css}</style>",
        body,
        f'<script defer src="{XLSX_CDN}"></script>',
        f"<script>\n{safe_inline(core)}</script>",
        f"<script>\n{safe_inline(app)}</script>",
        "",
    ])
    (DIST / "artifact.html").write_text(artifact, encoding="utf-8")

    xlsx = XLSX_LOCAL.read_text(encoding="utf-8")
    index = "\n".join([
        "<!doctype html>",
        '<html lang="th">',
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
        meta,
        f"<title>{TITLE}</title>",
        FONTS,
        f"<style>\n{css}</style>",
        "</head>",
        "<body>",
        body,
        f"<script>\n{safe_inline(core)}</script>",
        f"<script>\n{safe_inline(app)}</script>",
        "<!-- SheetJS Community Edition 0.18.5, Apache License 2.0, https://sheetjs.com -->",
        f"<script>\n{safe_inline(xlsx)}\n</script>",
        "</body>",
        "</html>",
        "",
    ])
    (ROOT / "index.html").write_text(index, encoding="utf-8")

    for p in (DIST / "artifact.html", ROOT / "index.html"):
        print(f"{p.name}: {p.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
