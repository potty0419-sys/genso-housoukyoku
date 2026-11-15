# 配信予定・動画データの更新方法

## 実装済みの取得経路

`scripts/fetch_youtube.mjs` がYouTube Data API v3（`https://www.googleapis.com/youtube/v3/`）を呼び、`src/data/` に静的JSONを生成します。Node.js 20の組み込み機能だけを使用します。設定は `sources.json`、キーは環境変数 `YOUTUBE_API_KEY` です。ブラウザからAPIは呼びません。

1. ポッティのuploadsプレイリストを `playlistItems.list` で最大4ページ×50本取得し、`videos.list` を50本ずつ呼びます。タイトル・説明がキーワードに一致する公開済み録画動画を新着順で最大30本保存します。非公開・限定公開は、公開状態が取得できた場合に除外します。
2. ポッティ自身の予約・配信中はキーワードに関係なく予定へ入れ、`genso` フラグで元素騎士関連かを示します。コミュニティは `search.list` の `eventType=upcoming` と `live` を各1回、検索語「元素騎士」・JP・ja・最大50件で取得し、`videos.list` で詳細を取得します。コミュニティはタイトル・説明のキーワード一致が必須です。
3. 人気動画は `search.list` を1回、直近30日・`order=viewCount` で呼び、`videos.list` から再生数などを取得します。予約・配信中・無関係な動画を除外し、再生数順で1チャンネル3本、全体24本までに制限します。

検索は計3回です。約300 unitsに、最大4回のplaylistItemsと数回のvideos.list分が加わります。検索結果は最初の50件まで、ポッティ動画は直近200本までを確認するため、全YouTube動画を網羅するものではありません。

キーワード判定はタイトルと説明を大文字小文字を無視して照合します。タグは `tagRules` をタイトルと照合します。種別は `actualStartTime` があれば「配信アーカイブ」、それ以外で180秒以下なら「ショート」、残りは「動画」です。ショート判定は再生時間による簡易分類です。

## 予定の絞り込み

予約配信は `scheduledStartTime` が取得時刻の3時間前〜 `scheduleDaysAhead` 日後に入るものだけを残します。放置された数年前の予約配信は入りません。配信中は `actualStartTime` があり `actualEndTime` がないものだけです。動画IDで重複を除き、配信中を先頭、同じ状態では開始時刻の早い順にします。

トップはポッティとコミュニティを分けて表示します。ON AIRはポッティのLIVE、ポッティの次の予約、コミュニティの元素騎士LIVE件数、予定なし、の順で選びます。開始時刻を過ぎただけではLIVEにはしません。APIの状態を次に取得するまでは最新の配信開始・終了を反映できません。予定のカレンダー出力は開始から2時間の枠です。

## 出力・検証・失敗時

- `schedule.json`: `{ "fetchedAt": ISO, "items": [...] }`。項目は `id`, `status`, `start`, `title`, `channelTitle`, `channelId`, `isPotty`, `genso`, `thumbnail`, `url`。
- `videos.json`: `{ "fetchedAt": ISO, "potty": [...], "popular": [...] }`。各動画は `id`, `title`, `channelTitle`, `channelId`, `isPotty`, `views`, `publishedAt`, `durationSec`, `type`, `tags`, `thumbnail`。

動画IDは11文字の英数字・`_`・`-`、タイトルは文字列で200文字までに切り詰め、数値は有限・非負、日時と項目の型を検証します。サムネイルはHTTPSの `i.ytimg.com` だけを許可し、他のホストは空にします。第三者の文字列は表示時にHTMLエスケープまたはtextContentで扱い、リンク・埋め込みは検証済みIDから作ります。

全工程と検証が成功してから両JSONを一時ファイルへ書き、置換します。置換中のエラーには元の内容へ戻す処理があります。取得・検証のエラーは既存JSONを書き換えず、エラーを表示して終了コード1にします。キーを出力に含めず、エラーメッセージ内のキーと `key=` パラメータを伏せます。`--dry-run` も取得・検証を行いますが、件数表示だけでファイルを更新しません。

初期スナップショットは `fetchedAt: null` と空配列です。画面には「データ取得前です」と出ます。従来の配列形式も読み込み可能で、配信・動画ファイルがない場合も空表示になります。

## 定期実行と配信

GitHub Actionsの `.github/workflows/pages.yml` が、mainへのpush・手動実行・UTCで3時間ごとの7分に起動します。テスト→取得→Pagesへの `src/` 配信を行い、取得JSONはGitへコミットしません。キーはリポジトリsecret `YOUTUBE_API_KEY` に置きます。設定手順とローカル実行コマンドはルートのREADMEを参照してください。

キー未設定なら取得はスキップし、取得失敗でも配信を継続します。失敗時に保持されるのはそのジョブのcheckout内JSONです。前回のPages成果物を復元する仕組みはありません。

`news.json` は空配列から始め、`sample !== true` の記事がなければセクションごと非表示です。`apps.json`・`glossary.json`・`config.json` の仮のゲーム情報は引き続きサンプルです。掲示板とひとことはconfigのfeaturesフラグで保留しています。
