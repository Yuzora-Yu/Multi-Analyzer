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
