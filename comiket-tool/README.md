# コミケ買い物分担ツール

**Firestore 版（P2・P3）**：`app/firebase-config.js` の Firebase プロジェクトにつながる。
Firebase の部品（`app/vendor/`）が無いときは、これまでどおり「この端末だけに保存」で動く。

公開用フォルダ（dist/）を作って Firebase に載せる：

```sh
npm install firebase@12 firebase-tools@15          # 初回だけ
python3 tools/build_hosting.py --firebase node_modules/firebase --catalog real-data/catalog.real.js
npx firebase deploy --only hosting,firestore:rules --project comiketmtg
```

会議のない期間は全部の読み書きを止める（Windows では close.bat / open.bat をダブルクリック）：

```sh
npx firebase deploy --only firestore:rules --config firebase.closed.json --project comiketmtg   # 止める
npx firebase hosting:disable --force --project comiketmtg                                      # ページを閉じる
npx firebase deploy --only hosting,firestore:rules --project comiketmtg                         # 会議の前に戻す
```

偽の Firebase（エミュレーター）で 2 台ぶん動かすテスト（本物のプロジェクトには触れない）：

```sh
python3 tools/build_hosting.py --firebase node_modules/firebase --out /tmp/dist
npx firebase emulators:exec --only auth,firestore --project demo-comiket "node tests/e2e_cloud.js /tmp/dist"
```

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

Web カタログの CSV から作る（`--days` に開催日の曜日を並び順で。データに無い曜日も入れてよい）：

```sh
mkdir -p real-data   # real-data/ はリポジトリに入れない（.gitignore 済み）
python3 tools/convert_catalog.py --webcatalog --days 土,日 real-data/WebCatalog.csv app/catalog.js
```

本物のデータから作った `app/catalog.js` はコミットしない。

ダミーデータを変えたら作り直す：

```sh
python3 tools/convert_catalog.py --days 金,土,日 dummy-data/catalog.csv app/catalog.js
python3 tools/convert_catalog.py --demo dummy-data/assignments.csv app/demo.js
```

## テスト

```sh
node --test tests/logic.test.js   # 正規化・検索・CSV・テキスト
python3 tests/test_convert.py      # Web カタログ CSV の読み込み（架空の行）
node tests/e2e.js                  # スマホ幅のブラウザで一連の操作（Playwright が必要）

# 大きいカタログでの速さ（架空の 5 万件）
python3 tools/make_synthetic_catalog.py 50000 /tmp/big.csv
python3 tools/convert_catalog.py /tmp/big.csv /tmp/big-catalog.js
node tests/perf.js /tmp/big-catalog.js 4
```

お試し用の 1 ファイル版は `python3 tools/build_single.py 出力.html` で作る。本物のデータで作るときは `--catalog` と `--demo` で別のファイルを渡す（出力はコミットしない）。

## P1 でまだやっていないこと

- 他の端末との同期（P2）
- 公開時間外の操作の制限（P3。今はバナーに表示するだけ）
- 進行役とメンバーの権限の区別（P2〜P3。今は全員が設定画面を使える）
