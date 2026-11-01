"""Web カタログ CSV の読み込みのテスト（架空の行で試す）。実行: python3 tests/test_convert.py"""
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "tools"))
import convert_catalog as cc  # noqa: E402

SAMPLE = (
    "Header,ComicMarketCD-ROMCatalog,ComicMarket999,UTF-8,Web 1.0,,,,,,,,,,,,,,,,,\n"
    "Circle,1,1,1,1,日,東,Ｃ,6,100,架空サークル甲,カクウ,作者,,https://example.com,x@example.com,説明,メモ,,,,1\n"
    "Circle,2,1,1,1,土,西,あ,12,100,架空サークル乙,カクウ,作者,,,,,,,,,0\n"
    "Circle,3,1,1,1,土,南,ｏ,41,100,架空サークル丙,カクウ,作者,,,,,,,,,0\n"
    "UnKnown,配置なし,ハイチナシ,作者,,9,本,,,,,,,,,,,,,,,\n"
)


def main():
    with tempfile.TemporaryDirectory() as d:
        p = pathlib.Path(d) / "wc.csv"
        p.write_text(SAMPLE, encoding="utf-8")
        rows = cc.read_webcatalog(str(p), cc.parse_days("土=1,日=2"))
    assert rows == [
        {"day": 2, "kind": "circle", "circle_no": "東C06b", "circle_name": "架空サークル甲"},
        {"day": 1, "kind": "circle", "circle_no": "西あ12a", "circle_name": "架空サークル乙"},
        {"day": 1, "kind": "circle", "circle_no": "南o41a", "circle_name": "架空サークル丙"},
    ], rows
    # 執筆者名・URL・メール・メモは取り出さない
    assert all(set(r) == {"day", "kind", "circle_no", "circle_name"} for r in rows)
    print("test_convert: ok")


if __name__ == "__main__":
    main()
