"""Build the two copies of the page from src/.

index.html          full HTML document for GitHub Pages and for opening from disk.
                    SheetJS and the fonts are served from this repo, so the page never
                    contacts another site, and a Content-Security-Policy locks that in.
dist/artifact.html  page content for the claude.ai artifact (SheetJS from cdnjs,
                    Google Fonts; the claude.ai viewer applies its own policy).

Edit files in src/ only, then run:  python build.py
"""
import base64
import hashlib
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / "src"
DIST = ROOT / "dist"
XLSX_LOCAL = ROOT / "vendor" / "xlsx-0.18.5.full.min.js"
XLSX_CDN = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"
FONTS_CSS = ROOT / "fonts" / "fonts.css"

TITLE = "วงล้ออายุครรภ์"
GOOGLE_FONTS = (
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


def sha256(text):
    return "'sha256-" + base64.b64encode(hashlib.sha256(text.encode("utf-8")).digest()).decode() + "'"


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
        GOOGLE_FONTS,
        f"<style>\n{css}</style>",
        body,
        f'<script defer src="{XLSX_CDN}"></script>',
        f"<script>\n{safe_inline(core)}</script>",
        f"<script>\n{safe_inline(app)}</script>",
        "",
    ])
    (DIST / "artifact.html").write_text(artifact, encoding="utf-8")

    # Standalone page: exact text of every inline block, so the policy can list their hashes.
    style_text = "\n" + FONTS_CSS.read_text(encoding="utf-8") + css
    scripts = [
        "\n" + safe_inline(core),
        "\n" + safe_inline(app),
        "\n" + safe_inline(XLSX_LOCAL.read_text(encoding="utf-8")) + "\n",
    ]
    csp = "; ".join([
        "default-src 'none'",
        "script-src " + " ".join(sha256(s) for s in scripts),
        "style-src " + sha256(style_text),
        "font-src 'self'",
        "img-src 'self' data:",
        "connect-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "object-src 'none'",
    ])
    index = "\n".join([
        "<!doctype html>",
        '<html lang="th">',
        "<head>",
        '<meta charset="utf-8">',
        f'<meta http-equiv="Content-Security-Policy" content="{csp}">',
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
        '<meta name="referrer" content="no-referrer">',
        meta,
        f"<title>{TITLE}</title>",
        f"<style>{style_text}</style>",
        "</head>",
        "<body>",
        body,
        f"<script>{scripts[0]}</script>",
        f"<script>{scripts[1]}</script>",
        "<!-- SheetJS Community Edition 0.18.5, Apache License 2.0, https://sheetjs.com -->",
        f"<script>{scripts[2]}</script>",
        "</body>",
        "</html>",
        "",
    ])
    (ROOT / "index.html").write_text(index, encoding="utf-8")

    for p in (DIST / "artifact.html", ROOT / "index.html"):
        print(f"{p.name}: {p.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
