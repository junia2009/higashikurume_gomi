# 東久留米ごみナビ

東久留米市の家庭ごみ向け、**品目分別検索 ＋ 収集日カレンダー** の統合Webアプリ。
市公式「ごみサク」（品目検索のみ）との差別化として、検索結果に **「次にその区分を出せるのはいつか」** を直接表示します。

- 今日・明日に出せるごみが一目でわかるトップ画面（朝8:30を過ぎると「収集済みの可能性」表示）
- 品目のインクリメンタル検索（ひらがな/カタカナ・長音・空白を無視、読み仮名でも検索）
- 月表示カレンダー（区分ごとに色分け、祝日・年末年始を反映）
- 地区（東/西）を初回選択して端末に保存
- オフライン対応（Service Worker + Cache API による PWA）

ビルドツールなしの vanilla HTML/CSS/JS。GitHub Pages で配信できます。

## 使い方（ローカル）

`fetch` を使うため、ファイルを直接開くのではなくローカルサーバー経由で開きます。

```sh
python3 -m http.server 8000
# → http://localhost:8000/
```

## ディレクトリ構成

```
index.html            トップ+検索+カレンダーのSPA（単一ページ）
assets/
  logic.js            ロジック層（純関数・DOM非依存）。中核は nextCollectionDate()
  app.js              描画層（ロジックに委譲）
  styles.css          スタイル（ライト/ダーク対応）
  icon.svg            アプリアイコン
data/
  items.json          品目→区分データ（暫定シード。公式CSVから差し替え予定）
  schedule.json       地区別の週次収集スケジュール（市公式より）
  special_days.json   年末年始の収集なし日・祝日・注意書き（毎年手動メンテ）
tools/
  csv2json.js         東京都オープンデータCSV → items.json 変換（手動実行）
  logic.test.js       ロジック層のユニットテスト（node --test）
sw.js                 Service Worker（オフライン対応）
manifest.json         PWA マニフェスト
```

## テスト

```sh
node --test tools/logic.test.js
```

## データの更新

### 品目データ（items.json）

`data/items.json` は現在**暫定シードデータ**です（`"seed": true`）。
東京都オープンデータカタログの公式CSVで置き換えます。

```sh
# CSVを取得（東京都オープンデータカタログ）
curl -L -o tmp/garbage.csv \
  https://www.opendata.metro.tokyo.lg.jp/higashikurume/132225_higashikurumeshi_garbage_separate.csv

# 変換（区分未判定の品目は unknown で出力し、標準エラーに一覧表示される）
node tools/csv2json.js tmp/garbage.csv > data/items.json
```

CSVの実カラム構成は取得後に確認し、`tools/csv2json.js` の `COLUMN_HINTS` と
区分マッピング（`CATEGORY_MAP`）を必要に応じて調整してください。

### 収集日程（schedule.json）

市内は**2地区の固定曜日制**（ローテーションなし）。市公式サイトの
「収集曜日とごみ出しルールについて」（2022年2月更新）を基にしています。

| 曜日 | 東地区 | 西地区 |
|---|---|---|
| 月 | 容器包装プラスチック・PETボトル | 燃やせるごみ・びん |
| 火 | 燃やせるごみ・びん | 容器包装プラスチック・PETボトル |
| 水 | 燃やせないごみ・有害ごみ | 燃やせないごみ・有害ごみ |
| 木 | 缶・紙類・布類 | 燃やせるごみ・びん |
| 金 | 燃やせるごみ・びん | 缶・紙類・布類 |
| 土日 | 収集なし | 収集なし |

### 特別日（special_days.json）

年末年始（`no_collection`）と祝日（`holidays`）は**毎年手動でメンテ**します。
祝日の収集有無は公式に断定されていないため、祝日には「広報要確認」の注意バッジを表示しています。
裏取りが取れたら通常収集扱いへ変更してください（確認先: ごみ対策課 042-473-2117）。

## 注意事項

個人開発の**非公式アプリ**です。正確な分別・収集日は必ず市公式情報でご確認ください。

- ごみサク（公式品目検索）: https://www.gomisaku.jp/0069/
- 東久留米市 ごみと資源物の出し方: https://www.city.higashikurume.lg.jp/kurashi/kankyo/shigen/gomishigen/index.html

## データ出典・ライセンス

- 分別区分: 東京都オープンデータカタログ「【東久留米市】ごみの分別方法一覧」
  （利用時にデータセット個別のライセンスを確認すること。都カタログは原則 CC BY 4.0）
- 収集日程: 東久留米市公式サイト
