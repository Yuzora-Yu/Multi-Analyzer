# 無料の共通判定・通知

通知本文は日本語の結論から始まります。GOLDは候補帯に接近・帯内・条件成立を区別し、次の確認条件、帯の見立て無効化、損切り注文の参考価格、反応候補を冒頭に表示します。撤退注意は実保有の確認ではなく、反転エントリーを指示しません。メールはBybit元価格で、画面の個人用価格補正は適用されません。

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

GOLD通知は候補ゾーン分析を主役にします。有効なSMC OB/FVGにMA・BB参照値が重なり、15分確定足の価格が執行足1ATR以内へ接近・帯内再訪したときに通知します。候補帯、4H/1H/15mの構造とMA、確認条件、15分終値の帯無効化、保護SL参考、反応候補価格を表示します。遠い帯は画面で監視、接触だけでは入場確定にしません。同一帯・同一段階・上位構造の重複を抑止。Exit注意は分析通知の補足です。ゾーン通知を送っただけでは仮保有を作りません。BTC通知方式は従来通りです。

今週の経済予定は公式日程を手動確認した一部のみ（2026-10-06確認、10/10 JST期限）。予定前後30分はGOLDゾーン通知を保留します。完全なニュース配信・自動更新ではなく、期限後は未確認と表示します。突然のニュース、未掲載の発言を「警戒なし」と扱いません。

新規P条件・追加ゾーン仮説は研究段階で、利益上の優位性は未確認です。[条件と検証結果](../RESEARCH_V43.md)。
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

取得障害の診断: `/api/monitor` に `diagnosticsVersion`、現在の `dataError`、回復後も残る `lastDataError` を追加。HTTP状態・Bybit数値コード・JSON/形式不備・タイムアウト等を区別します。`startedAt`/`finishedAt` はローカル観測時刻、`recoveredAt` は後続の監視成功時刻で、相場の足時刻ではありません。応答本文・URL・retMsgは保持しません。過去の汎用エラーに診断を後付けしません。判定条件・取得間隔・無料上限は従来通りです。
