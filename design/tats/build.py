#!/usr/bin/env python3
"""Build the tATS prototype into one static page.

src/page.html holds the markup with three placeholders, filled from src/:
  /*STYLE*/   style.css, with the Mona Sans and Departure Mono fonts and the mark inlined
  /*DATA*/    data.js
  /*APP*/     app.js

Writes index.html next to this file.
"""
import base64
import pathlib

root = pathlib.Path(__file__).parent
src = root / "src"

def b64(name):
    return base64.b64encode((src / name).read_bytes()).decode()

style = (src / "style.css").read_text()
style = style.replace("__DEPARTURE__", "data:font/woff2;base64," + b64("DepartureMono-Regular.woff2"))
style = style.replace("__MONA__", "data:font/woff2;base64," + b64("MonaSans.woff2"))
style = style.replace("__MARK__", "data:image/svg+xml;base64," + b64("tacit-mark.svg"))
style = style.replace("__GROK__", "data:image/png;base64," + b64("grokbot.png"))

page = (src / "page.html").read_text()
page = page.replace("/*STYLE*/", style)
page = page.replace("/*DATA*/", (src / "data.js").read_text())
page = page.replace("/*APP*/", (src / "app.js").read_text())

(root / "index.html").write_text(
    "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">"
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">"
    "<style>:root{color-scheme:light}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style>"
    "</head><body>\n" + page + "\n</body></html>\n"
)
print("built", len(page) // 1024, "KB")
