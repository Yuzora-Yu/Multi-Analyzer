# データ・分析仕様 / 2026-09-08

## 無料データの確認

- Binance XAUUSDT perpetual / BTCUSDT spot: 公開Kline・bookTicker、GoldはpremiumIndex。実環境で取得成功。
- USD参考価格: https://gold-api.com/docs の無料 `/price/XAU` と `/price/BTC` を実確認。USDT足に混ぜず別表示。無料の過去OHLCVを保証するものではありません。
- WebSocket: https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md
- Futures Kline: https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Kline-Candlestick-Streams
- XAUUSDTの市場仕様: https://www.binance.com/en-TR/support/announcement/detail/55bd3594394a46daa910df5746355ff4
- Discord通知: https://docs.discord.com/developers/resources/webhook / https://docs.discord.com/developers/topics/rate-limits

価格は各データ提供者のものです。GoldのOTC XAUUSDやXMなど個別CFD、BTCUSDとUSDT市場は同一ではありません。提示した目標価格の直接転用はできません。利用条件・無料枠・公開表示権は変更されるため、広く公開配信する際は提供元で再確認してください。

## 実装した判定の定義

公開されている一般概念を参考にした独自実装で、有料スクリプトの複製はありません。SMCは統一規格ではなく、以下の数値条件は検証可能にするためのヒューリスティックです。

- 確定スイング: 左右3本。右側3本が確定して初めて利用可能。
- BOS / CHoCH: 既知スイングを終値で突破。同方向継続をBOS、直前構造方向の反転をCHoCH。チャートは認識した足にマーカーを置きます。
- Liquidity sweep: 既知スイング外までヒゲが出て終値が内側へ復帰。
- FVG: 3本の非重複高安帯。中央足実体が前のATRの0.8倍超、ギャップが0.1ATR超。最外端まで埋めたら無効。最長150本。
- Order block: 終値構造突破と0.8ATR超の実体変位に先立つ8本以内の最後の逆色足。終値が遠い側の端を破ったら無効。生成時刻は突破時刻。
- 再訪: 既存の有効ゾーンへ接触後、同方向の実体・帯の外側の終値で反発。加点は6点で制限。
- Premium / discount: 最新確定スイング高安の中央を境界。補助加点のみ。
- EQH / EQL: 直近スイングの差が0.15ATR以内。消化済み水準を除外。
- PDH / PDL: UTC前日の収録範囲の高安。全日が収録されている保証はありません。
- RSI divergence: 直近2つの確定スイングで価格とRSIが逆行、3ポイント超。確認後5本以内。
- 推定POC: 直近96本の典型価格に出来高を割り当てた24ビンの最大出来高水準。実約定のvolume profile / footprintではありません。
- 従来指標: EMA20/50/200、ATR、ADX/DMI、RSI、MACD、Bollinger、rolling/day/week VWAP、出来高Z、相場環境、夏時間対応セッション、多時間足整合、スプレッド、最良気配数量の偏り、Gold資金調達率とベーシス。

## 意図的な限界

「すべての技法」「最強」「利益の確約」を客観的に満たす手法は確認できません。実機関注文、OTC全市場の板、完全なCVD/footprint、清算ヒートマップ、オプション全件、ニュース速報、経済指標の自動ブラックアウトは統合していません。無料の確実なデータがない部分を推測値で置き換えてはいません。

スコアは勝率ではありません。バックテストは現在取得した足の限定検証です。SMC加点の収益優位性は未確認。将来成績の根拠にする前に、長期間・コスト込み・期間外データで検証が必要です。
