"""カタログ CSV（とデモ用の分担 CSV）を、アプリが読む JS ファイルに変換する。

使い方（comiket-tool フォルダで実行）:
    python3 tools/convert_catalog.py dummy-data/catalog.csv app/catalog.js
    python3 tools/convert_catalog.py --demo dummy-data/assignments.csv app/demo.js

本物のカタログ DB が手に入ったら、その形式を読む関数をここに足す。
アプリ側は catalog.js の形（day, kind, circle_no, circle_name）だけを見る。
"""

import argparse
import csv
import json
import sys

KINDS = {"circle", "corporate"}


def read_catalog(path):
    rows = []
    seen = set()
    with open(path, encoding="utf-8-sig", newline="") as f:
        for n, r in enumerate(csv.DictReader(f), start=2):
            try:
                day = int(r["day"])
            except (KeyError, ValueError):
                sys.exit(f"{path}:{n}: day が整数ではありません")
            kind = (r.get("kind") or "circle").strip()
            if kind not in KINDS:
                sys.exit(f"{path}:{n}: kind は circle か corporate です: {kind}")
            no = (r.get("circle_no") or "").strip()
            name = (r.get("circle_name") or "").strip()
            if not no or not name:
                sys.exit(f"{path}:{n}: circle_no と circle_name は必須です")
            key = (day, kind, no)
            if key in seen:
                sys.exit(f"{path}:{n}: 同じ日・種別・番号が重複しています: {key}")
            seen.add(key)
            rows.append({"day": day, "kind": kind, "circle_no": no, "circle_name": name})
    return rows


def read_demo(path):
    rows = []
    with open(path, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            requests = {}
            for part in (r.get("requesters") or "").split(";"):
                part = part.strip()
                if not part:
                    continue
                name, _, qty = part.partition(":")
                requests[name.strip()] = int(qty or 1)
            rows.append({
                "day": int(r["day"]),
                "kind": (r.get("kind") or "circle").strip(),
                "circle_no": r["circle_no"].strip(),
                "circle_name": r["circle_name"].strip(),
                "item": r["item"].strip(),
                "requests": requests,
                "assignee": (r.get("assignee") or "").strip() or None,
                "note": (r.get("note") or "").strip(),
            })
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true", help="分担 CSV をデモデータとして変換する")
    ap.add_argument("src")
    ap.add_argument("dst")
    a = ap.parse_args()
    if a.demo:
        data, var = read_demo(a.src), "COMIKET_DEMO"
    else:
        data, var = read_catalog(a.src), "COMIKET_CATALOG"
    body = json.dumps(data, ensure_ascii=False, indent=1)
    with open(a.dst, "w", encoding="utf-8") as f:
        f.write(f"// {a.src} から生成。手で編集しない。\nwindow.{var} = {body};\n")
    print(f"{a.dst}: {len(data)} 件")


if __name__ == "__main__":
    main()
