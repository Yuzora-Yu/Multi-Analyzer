# 無料の共通判定・通知

Workers Free + SQLite Durable Objects + 1分ごとの永続アラーム + 確認済み本人宛てEmail binding。
市場取得はBybit公開APIでキー不要。金XAUUSDT無期限契約、BTCUSDT現物。XMのUSD市場とは異なります。
PCの常時起動は不要。有料プランへの変更は行っていません。

15分足の確定2秒後以降、15分・1時間・4時間のデータを保存して共通エンジンで分析します。
公開画面とメールは同じスナップショット・設定・エンジンを使用。秒単位の価格表示は別途WebSocketで更新します。

- GET `/api/monitor`: 稼働状態。更新停止・データエラーを表示。
- GET `/api/snapshot?asset=gold|btc`: 最新の共通OHLCVと設定。
- GET `/api/snapshot?asset=gold|btc&id=...`: 通知時点の保存記録。各銘柄24判定＋送信済み100通知を保持。
- 認証POST `/run?asset=...&dry=true`: 配信なし分析。
- 認証POST `/start?asset=...`: 初回30秒後、その後1分間隔の永続アラーム。
- 認証POST `/test-email`: 固定宛先へ検証メール。

新規P条件は研究段階で、利益上の優位性は未確認です。[条件と検証結果](../RESEARCH_V43.md)。
同じ足・同じ判定の重複を抑止。初回は既存候補を送信しません。
GOLDの新規・撤退アラートは日本時間の土曜0:00〜月曜0:00に停止します。BTCは土日も対象です。
GOLDは日本時間の土日と市場休場中に取得・新規分析・通知を停止します。月曜も市場再開まで待機します。既存の仮保有は保持し、再開後の有効足で評価します。
履歴の休場時間はNY時間の金曜17時〜日曜18時、平日17〜18時を除外（夏冬時間に自動追従）。金曜NYの有効な取引足は、日本時間で土曜早朝でも後日の履歴に保持します。
GOLDの1時間以上の足は有効な1時間足から組み直し、週末と日々の休場中のBybit取引をOHLCV・MA・ボリバン・出来高の計算に混ぜません。休場による時刻の空白はデータ欠損と数えません。
Bybitの価格・出来高・日中のUTC基準の足区切りは維持します。日足はNY18時基準に集計し、短い日曜足を作りません。ブローカー価格、祝日の短縮取引や銘柄固有の取引時間まで完全一致するものではありません。
`/api/monitor` の `collectionSchedule` に取得可否、`MARKET_CLOSED` に休場待機を表示します。市場再開後も、土日の足を遅れて通知しません。
`/api/monitor` の各銘柄の `alertSchedule` に通知可否・日本時間の曜日ルールを表示します。
送信済み候補を仮の保有として追跡し、撤退条件では「前回候補を保有中なら」と送ります。
実保有の取得・同期や自動注文は行いません。実際のSL設定をメールで代行しません。
送信直後の保存失敗では重複する可能性があり、exactly-onceは保証しません。

通常1銘柄約1,470回/日の市場API取得、上限2,000回/日。超過・市場取得失敗では候補通知を停止。
無料枠は他Workerと共用で、停止の可能性はあります。有料への自動変更はありません。

設定はGit非公開の `.runtime/wrangler-monitor.jsonc`。公開用サンプルは `wrangler.example.jsonc`。
秘密はADMIN_TOKENのみ。旧TWELVE_API_KEYは現行監視では使用しません。
検証中はALERTS_ENABLED=false、triggers.crons=[]。運用はALERTS_ENABLED=trueと認証POST `/start`。

```powershell
npx wrangler deploy --config .runtime/wrangler-monitor.jsonc
npx wrangler types .runtime/monitor-env.d.ts --config .runtime/wrangler-monitor.jsonc
```

認証はAuthorization Bearerヘッダー。秘密をURLやGitに含めません。
ローカルmonitor.jsも同じスナップショットへ移行済みですが、クラウドとの併用は重複通知になるため避けます。

## 検証履歴

2026-09-08: 従来のTwelve DataとBinanceの判定不一致を修正。CloudflareとPCの両方でBybitの両銘柄300本を取得成功。
BinanceはCloudflareで403、OKXは金取得成功・BTC429、Bybitは双方成功を確認したため採用。
最終のデプロイ・メール検証はTEST_REPORT.md参照。

- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/durable-objects/platform/limits/
- https://developers.cloudflare.com/email-service/platform/pricing/
- https://bybit-exchange.github.io/docs/v5/market/kline
