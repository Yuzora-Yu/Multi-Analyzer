# Cloudflare無料監視

## 構成

Workers Free + SQLite Durable Objects + 5分ごとのCron + 確認済み本人宛てEmail binding。
通知は売買候補が新しく成立した場合に送る。初回に既存候補を一斉送信しない。同じ足・同じ判定は重複抑止する。
メール送信直後の障害で記録に失敗した場合など、厳密なexactly-once配信は保証しない。

公開ページ: https://yuzora-yu.github.io/Multi-Analyzer/
状態API: https://multi-analyzer-monitor.rikai-829.workers.dev/api/monitor

## 市場データと制限

クラウドはTwelve DataのXAU/USD・BTC/USDの15分・1時間・4時間足を使う。
BasicのXAU/USD試用銘柄に対する実取得を確認済み。利用権・提供範囲の変更や障害では取得が停止し得る。
クラウドで取得したローソク足を公開APIや公開チャートへ再配信しない。状態APIは稼働状態のみを返す。
公開チャートは引き続きBinanceのXAUUSDT先物・BTCUSDT現物。両者の価格・判定は一致しないため、メール・画面に取得元の違いを表示する。

- 15分足の売買候補を5分ごとに確認。秒単位の通知ではない。
- 上位足は次の足の境界まで保存データを再利用する。未確定の途中データを確定後まで再利用しない。
- 通常約636 APIリクエスト/日。1銘柄350回/日、合計700回/日の制限を設ける（無料枠800回/日）。同じAPIキーを他で大量使用すれば先にAPI側の上限に達する。
- 出来高なしのデータではVWAP・出来高スコア・POCを使用しない。架空の出来高を補わない。
- クラウド通知は新規売買候補のみ。ブラウザの保有ポジションはクラウドへ同期しない。クローズ推奨表示はブラウザ側の登録ポジションで動作する。
- 取得失敗時は該当銘柄の推奨通知を停止し、状態APIにエラーを表示する。
- 無料サービスの上限はアカウント内の他アプリと共用。有料プランへ自動変更しない。

## 設定・デプロイ

実設定はGit管理対象外の `.runtime/wrangler-monitor.jsonc`。
`wrangler.example.jsonc`をコピーし、宛先・Worker名を設定する。宛先はCloudflare Email Routingで確認済みの本人アドレスを使う。
`TWELVE_API_KEY` と `ADMIN_TOKEN` は `wrangler secret put` で登録する。APIキー・管理トークン・宛先入り実設定をGitへ追加しない。
検証中はALERTS_ENABLED=false、triggers.crons=[]。検証後に通知をtrue・Cronを5分間隔に変更する。

```powershell
npx wrangler deploy --config .runtime/wrangler-monitor.jsonc
npx wrangler types .runtime/monitor-env.d.ts --config .runtime/wrangler-monitor.jsonc
```

認証付きPOST `/run?asset=gold&dry=true` またはbtcで配信なしの分析テスト。
認証付きPOST `/test-email` は固定宛先への接続テスト。
APIの認証は `Authorization: Bearer <ADMIN_TOKEN>`。キーをURLへ含めない。
通常運用ではPC側の `--monitor` を併用しない（別データ源からの重複通知になる）。

## 検証記録

2026-09-08: 通常Workerでの分析CPUは1銘柄18〜56ms、公称10msを超えたためDOへ移した。DOは無料でもCPU30秒/呼び出し。
Binance RESTはクラウドから403。BTC WebSocketは受信成功、Gold WebSocketは403。Twelve Dataの個人キーで両銘柄・各時間足300本を取得し、DO内で分析成功。
Cloudflare Email bindingによる固定宛先テストは受付成功。受信箱への到着確認とは区別する。
試験コードはprobe.mjsに残すが、監視にはmonitor.mjsを使用する。

## 公式資料

- https://developers.cloudflare.com/durable-objects/platform/limits/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/email-service/platform/pricing/
- https://twelvedata.com/pricing
- https://twelvedata.com/exchanges/commodity?group=core
