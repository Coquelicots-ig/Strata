"""公開用のフォルダ dist/ を作る（Firebase Hosting に載せるもの）。

使い方（comiket-tool フォルダで実行）:
    python3 tools/build_hosting.py --firebase node_modules/firebase [--catalog 本物のcatalog.js]

- app/ のファイルを dist/ に写す（デモデータ demo.js は入れない）
- --catalog を渡すと、app/catalog.js の代わりにそれを入れる（本物のカタログ）
- Firebase の部品（compat 版）を npm の firebase パッケージから dist/vendor/ に写す
dist/ はリポジトリに入れない（.gitignore 済み）。
"""

import argparse
import pathlib
import shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = ROOT / "app"
VENDOR = ["firebase-app-compat.js", "firebase-auth-compat.js", "firebase-firestore-compat.js"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--firebase", required=True, help="npm の firebase パッケージのフォルダ（node_modules/firebase）")
    ap.add_argument("--catalog", help="app/catalog.js の代わりに使うカタログ")
    ap.add_argument("--out", default=str(ROOT / "dist"))
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    if out.exists():
        shutil.rmtree(out)
    (out / "vendor").mkdir(parents=True)
    for f in APP.iterdir():
        if f.is_file() and f.name != "demo.js":
            shutil.copy2(f, out / f.name)
    # demo.js は読み込みの順番を崩さないよう空のファイルにする（デモは Firestore 版では使わない）
    (out / "demo.js").write_text("window.COMIKET_DEMO = [];\n", encoding="utf-8")
    if a.catalog:
        shutil.copy2(a.catalog, out / "catalog.js")
    fb = pathlib.Path(a.firebase)
    for name in VENDOR:
        shutil.copy2(fb / name, out / "vendor" / name)
    total = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print(f"{out}: {sum(1 for p in out.rglob('*') if p.is_file())} ファイル、{total // 1024} KB")


if __name__ == "__main__":
    main()
