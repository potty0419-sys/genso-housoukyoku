# 元素騎士放送局

`src/` をそのまま配信する日本語の静的サイトです。ビルドやnpm依存パッケージはありません。配信予定・動画はYouTube Data API v3からJSONを生成し、ブラウザは生成済みJSONだけを読み込みます。

## ローカルで表示

```sh
cd src
python3 -m http.server 8000
```

`http://localhost:8000` を開きます。JSONを読み込むので、HTMLのダブルクリックでは動きません。テーマ、ながらモード、カウンター、タイマーなどの記録はブラウザのlocalStorageに保存されます。

## YouTubeデータの取得

Node.js 20以上で、リポジトリのルートから実行します。YouTube Data API v3を有効にしたAPIキーを用意してください。

```sh
YOUTUBE_API_KEY=... node scripts/fetch_youtube.mjs
YOUTUBE_API_KEY=... node scripts/fetch_youtube.mjs --dry-run
```

`--dry-run` はAPIから取得して件数を表示しますが、ファイルは書きません。APIキーは環境変数だけに置き、コミットしないでください。

設定は `src/data/sources.json` です。ポッティのuploadsを最大200本確認して元素騎士関連の録画動画を抽出し、ポッティとコミュニティの予約・配信中の枠、直近30日の人気動画を集めます。コミュニティ検索は予約・配信中・人気の計3回で、1回の実行は約300 unitsと数回のlist呼び出しです。

全取得と検証が成功した場合だけ、`schedule.json` と `videos.json` を更新します。失敗すると既存ファイルを保持して終了コード1を返します。取得前のリポジトリには空のJSONを置き、画面は「データ取得前です」と表示します。新形式に加えて従来の配列形式と、配信・動画JSONの欠損にも対応しています。

配信状態・再生数は最終取得時点の情報です。更新日時と予定は日本時間で表示します。動画クリック時だけyoutube-nocookieの埋め込みを開きます。外部画像の許可先は `https://i.ytimg.com/` のみです。用語集・アプリ紹介・防衛戦時刻・換算レートなどの仮設定には「サンプル」を残しています。お知らせは実データが入るまで非表示です。

## 掲示板の再開

`src/data/config.json` のフラグを変更します。

```json
"features": { "board": true, "hitokoto": true }
```

`board: false` ではナビを残して掲示板を「準備中」にし、トップの新着募集も隠します。`hitokoto: false` ではながら部屋のひとことボードを隠します。両方とも初期値はfalseです。

実装と保存データは残しています。再開すると従来のブラウザ内POCとして動作し、投稿は他人や別端末と共有されません。初回のサンプル募集、連投制限、通報、削除キーなどの詳細は `docs/board_operation.md` を参照してください。公開の共有掲示板へ移行する場合は別途バックエンドが必要です。

## GitHub Pagesの設定

1. GitHubのリポジトリで **Settings → Pages → Source: GitHub Actions** を選びます。
2. **Settings → Secrets and variables → Actions → New repository secret** に名前 `YOUTUBE_API_KEY` でAPIキーを登録します。
3. `main` へpushするか、**Actions → GitHub Pages → Run workflow** を実行します。

ワークフローはmainへのpush、手動実行、UTCの `7 */3 * * *`（日本時間の0時・3時・6時・9時・12時・15時・18時・21時の各7分、実行に遅延が生じる場合あり）で起動します。Node 20でテスト後にデータを取得し、`src/` をPagesへデプロイします。取得結果はコミットしません。

secretが空なら取得をスキップし、取得エラーでもデプロイを継続します。各ジョブは新しいcheckoutから始まるため、その実行の既存JSONはリポジトリ内のものです。現在の空JSONから開始して取得に失敗した場合、以前のデプロイの取得データを引き継がず、空状態で公開されます。

## テスト

```sh
node --test tests/
```

APIテストはfixture JSONと注入した取得関数で実行し、YouTubeへ接続しません。ブラウザ回帰テストはローカルHTTPサーバーとインストール済みChrome/Chromiumを使用し、外部通信を送信前に遮断します。ブラウザがない環境ではそのテストだけスキップします。`CHROME_BIN` で実行ファイルを指定できます。画面確認結果は無視対象の `logs/poc-check/` に保存します。

データ取得の詳細は `docs/data_sources.md`、画面の原仕様は `docs/spec.md` を参照してください。
