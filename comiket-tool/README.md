# コミケ買い物分担ツール

設計は [BLUEPRINT.md](BLUEPRINT.md)。今は **P1（試作）**：データはその端末のブラウザにだけ保存し、他の端末とは同期しません。

## 試し方

`app/index.html` をブラウザで開く。または、このフォルダで

```sh
python3 -m http.server -d app 8000
```

を実行して http://localhost:8000/ を開く。同じ Wi-Fi のスマホからは `http://<PC の IP>:8000/` で開ける。
最初の画面の「デモデータで始める」で、ダミーのメンバーと分担の例が入る。

同じブラウザで 2 つのタブを開くと、タブ同士で変更が反映されるので、同時編集の動きを 1 台で試せる。

## ファイル

| ファイル | 中身 |
|----------|------|
| `app/index.html`, `app/style.css`, `app/app.js` | 画面 |
| `app/logic.js` | 番号の正規化・検索・集計・CSV とテキストの出力 |
| `app/store.js` | データの保存（P1 は localStorage。P2 で Firestore 版に差し替える） |
| `app/catalog.js`, `app/demo.js` | `dummy-data/` から生成したカタログとデモデータ（手で編集しない） |
| `tools/convert_catalog.py` | CSV → `catalog.js` / `demo.js` の変換 |
| `tests/` | テスト |

ダミーデータを変えたら作り直す：

```sh
python3 tools/convert_catalog.py dummy-data/catalog.csv app/catalog.js
python3 tools/convert_catalog.py --demo dummy-data/assignments.csv app/demo.js
```

## テスト

```sh
node --test tests/logic.test.js   # 正規化・検索・CSV・テキスト
node tests/e2e.js                  # スマホ幅のブラウザで一連の操作（Playwright が必要）
```

## P1 でまだやっていないこと

- 他の端末との同期（P2）
- 公開時間外の操作の制限（P3。今はバナーに表示するだけ）
- 進行役とメンバーの権限の区別（P2〜P3。今は全員が設定画面を使える）
