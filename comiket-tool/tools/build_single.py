"""app/ のファイルを 1 つの HTML にまとめる（スマホで試すためのお試し版）。

使い方（comiket-tool フォルダで実行）:
    python3 tools/build_single.py 出力先.html [--catalog 別のcatalog.js] [--demo 別のdemo.js]

まとめた版ではダウンロードと印刷を隠し、代わりに「CSV をコピー」を使う。
<html> <head> <body> は付けない（公開先が付ける）。
"""

import argparse
import pathlib
import re

APP = pathlib.Path(__file__).resolve().parent.parent / "app"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--catalog", help="app/catalog.js の代わりに使うファイル（本物のデータなど）")
    ap.add_argument("--demo", help="app/demo.js の代わりに使うファイル")
    a = ap.parse_args()
    src = {"catalog.js": a.catalog, "demo.js": a.demo}
    html = (APP / "index.html").read_text(encoding="utf-8")
    body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
    body = re.sub(r'<script src="[^"]+"></script>\s*', "", body)
    scripts = ["window.COMIKET_EMBED = true;"]
    for name in ["catalog.js", "demo.js", "logic.js", "store.js", "app.js"]:
        path = pathlib.Path(src.get(name) or APP / name)
        scripts.append(path.read_text(encoding="utf-8"))
    script = "\n".join(scripts).replace("</script", "<\\/script")
    out = (
        "<title>コミケ買い物分担</title>\n"
        '<meta name="claude:viewport-fit-sides" content="cover">\n'
        '<meta name="robots" content="noindex, nofollow">\n'
        f"<style>\n{(APP / 'style.css').read_text(encoding='utf-8')}\n</style>\n"
        f"{body.strip()}\n"
        f"<script>\n{script}\n</script>\n"
    )
    pathlib.Path(a.out).write_text(out, encoding="utf-8")
    print(f"{a.out}: {len(out.encode('utf-8'))} bytes")


if __name__ == "__main__":
    main()
