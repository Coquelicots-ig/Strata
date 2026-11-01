"""カタログ CSV（とデモ用の分担 CSV）を、アプリが読む JS ファイルに変換する。

使い方（comiket-tool フォルダで実行）:
    python3 tools/convert_catalog.py dummy-data/catalog.csv app/catalog.js
    python3 tools/convert_catalog.py --demo dummy-data/assignments.csv app/demo.js

Web カタログの CSV（1 行目が Header,ComicMarketCD-ROMCatalog,... の形）も読める。
曜日を何日目にするかを --days で渡す:
    python3 tools/convert_catalog.py --webcatalog --days 土=1,日=2 WebCatalog.csv app/catalog.js

Web カタログの CSV には執筆者名・URL・メールアドレス・メモも入っているが、
ここでは日・ホール・ブロック・番号・a/b・サークル名だけを取り出す。
アプリ側は catalog.js の形（[日, 種別 c/k, 番号, 名前] の配列）だけを見る。
"""

import argparse
import csv
import json
import sys
import unicodedata

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


# Web カタログ CSV の Circle 行の列（0 から数える）。列の意味は中身からの推測で、公式の仕様書では確かめていない。
WC_DAY, WC_HALL, WC_BLOCK, WC_NUM, WC_NAME, WC_AB = 5, 6, 7, 8, 10, 21


def read_webcatalog(path, days):
    rows = []
    seen = set()
    skipped = {}
    with open(path, encoding="utf-8-sig", newline="") as f:
        for n, r in enumerate(csv.reader(f), start=1):
            if not r:
                continue
            if r[0] != "Circle":
                # Header 行と、配置の無い UnKnown 行は使わない
                skipped[r[0]] = skipped.get(r[0], 0) + 1
                continue
            wd = r[WC_DAY].strip()
            if wd not in days:
                sys.exit(f"{path}:{n}: 曜日 {wd!r} を何日目にするか --days で指定してください")
            block = unicodedata.normalize("NFKC", r[WC_BLOCK]).strip()
            try:
                num = int(unicodedata.normalize("NFKC", r[WC_NUM]))
            except ValueError:
                sys.exit(f"{path}:{n}: スペース番号が数字ではありません: {r[WC_NUM]!r}")
            ab = {"0": "a", "1": "b"}.get(r[WC_AB].strip())
            if ab is None:
                sys.exit(f"{path}:{n}: a/b の列が 0 か 1 ではありません: {r[WC_AB]!r}")
            no = f"{r[WC_HALL].strip()}{block}{num:02d}{ab}"
            key = (days[wd], "circle", no)
            if key in seen:
                sys.exit(f"{path}:{n}: 同じ日・番号が重複しています: {key}")
            seen.add(key)
            rows.append({"day": days[wd], "kind": "circle", "circle_no": no, "circle_name": r[WC_NAME].strip()})
    for k, v in skipped.items():
        print(f"使わなかった行: {k} {v} 件", file=sys.stderr)
    return rows


def parse_days(text):
    days = {}
    for part in (text or "").split(","):
        if part.strip():
            k, _, v = part.partition("=")
            days[k.strip()] = int(v)
    return days


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
    ap.add_argument("--webcatalog", action="store_true", help="Web カタログの CSV を読む")
    ap.add_argument("--days", help="Web カタログの曜日→何日目。例: 土=1,日=2")
    ap.add_argument("src")
    ap.add_argument("dst")
    a = ap.parse_args()
    if a.demo:
        data, var = read_demo(a.src), "COMIKET_DEMO"
        body = json.dumps(data, ensure_ascii=False, indent=1)
    else:
        # 4〜5 万件を見込み、1 行を [日, 種別(c/k), 番号, 名前] の配列に詰め、1 件 1 行で書く
        if a.webcatalog:
            data = read_webcatalog(a.src, parse_days(a.days))
        else:
            data = read_catalog(a.src)
        var = "COMIKET_CATALOG"
        rows = [json.dumps([r["day"], "k" if r["kind"] == "corporate" else "c", r["circle_no"], r["circle_name"]],
                           ensure_ascii=False, separators=(",", ":")) for r in data]
        body = "[\n" + ",\n".join(rows) + "\n]"
    with open(a.dst, "w", encoding="utf-8") as f:
        f.write(f"// {a.src} から生成。手で編集しない。\nwindow.{var} = {body};\n")
    print(f"{a.dst}: {len(data)} 件")


if __name__ == "__main__":
    main()
