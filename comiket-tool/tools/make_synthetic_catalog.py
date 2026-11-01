"""大きさの確認用に、架空のカタログ CSV を作る（本物の配置とは関係ない）。

使い方: python3 tools/make_synthetic_catalog.py 件数 出力.csv

3 日 × 東西南 × ブロック（大文字・小文字・ひらがな・カタカナ）× 番号 × a/b を、
件数に達するまで順に埋める。サークル名は 6〜16 文字の架空の文字列。
"""

import csv
import random
import sys

UPPER = [chr(c) for c in range(ord("A"), ord("Z") + 1)]
LOWER = [chr(c) for c in range(ord("a"), ord("z") + 1)]
HIRA = list("あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろ")
KATA = list("アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロ")
HALL_BLOCKS = {"東": UPPER + KATA, "西": HIRA + LOWER, "南": LOWER[:12] + KATA[:12]}
NAME_CHARS = "あいうえおかきくけこさしすせそアイウエオカキクケコ星月花風空海森工房堂舎団社書屋会組"


def main():
    total, out = int(sys.argv[1]), sys.argv[2]
    rnd = random.Random(1)
    rows = []
    per_day = total // 3 + 1
    for day in (1, 2, 3):
        n = 0
        for num in range(1, 100):
            for hall, blocks in HALL_BLOCKS.items():
                for b in blocks:
                    for ab in "ab":
                        if n >= per_day or len(rows) >= total:
                            break
                        name = "".join(rnd.choice(NAME_CHARS) for _ in range(rnd.randint(6, 16)))
                        rows.append((day, "circle", f"{hall}{b}{num:02d}{ab}", name))
                        n += 1
    with open(out, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["day", "kind", "circle_no", "circle_name"])
        w.writerows(rows)
    print(f"{out}: {len(rows)} 件")


if __name__ == "__main__":
    main()
