# Multi-Analyzer v4

Gold/USD・BTC/USD向けのブラウザ分析補助ツール。売買候補・目標・SL・保有ポジションのクローズ推奨をPCとスマホに表示します。

公開チャート: https://yuzora-yu.github.io/Multi-Analyzer/

## 起動

```powershell
python server.py --monitor
```

http://127.0.0.1:8000/ を開きます。Python 3.10+ / Node 20+。追加パッケージ不要。

[スマホ接続・Discord・メール通知の設定](SETUP.md) / [分析定義と調査元](RESEARCH.md)

## 見方

| 表示 | 意味 |
|---|---|
| 緑 ▲ 買い候補 | 確定足・スコア・コスト・上位足の条件が合致。目標とSLを併記 |
| 赤 ▼ 売り候補 | 売り方向の条件が合致 |
| 紫 × クローズ推奨 | 入力済みポジションが撤退条件に到達 |
| 灰 — 待機 | 条件未達・データ停止・見送り条件あり |

緑／赤の細いSMC帯は需要・供給の推定領域で、単独の売買指示ではありません。実線がOB、破線がFVG。矢印は構造イベント、判断バーが総合判定です。スコアは勝率ではありません。

## v4で追加・修正

- Gold / BTCだけに整理。常時表示の判断バー、スマホ対応。
- 因果的なFVG、OB、BOS、CHoCH、Sweep、Premium/Discount、EQH/EQL、前日高安、RSI divergence、推定POC。
- 従来のEMA・VWAP・ATR・ADX・RSI・MACD・Bollinger・多時間足分析にSMCを統合。
- 未確定足と確定足を分離。将来のスイングを過去に表示しない。
- データ停止時の判断抑止、取得の競合防止、ポーリング時の上位足更新。
- 資金をUSD/USDTに統一し、Goldはoz、BTCはBTCで数量計算。保有情報は銘柄別保存。
- 独立したサーバー監視とDiscord/SMTPメール通知。重複抑止・再試行・無効シグナル破棄。
- 静的配信を許可リスト化し、監視設定や通知の秘密情報を配信しない。

## データ

無料・キー不要のBinance XAUUSDT perpetual / BTCUSDT spotのローソク足で分析します。**XAUUSDのCFDやBTCUSDそのものの足ではありません。** Gold APIのUSD参考価格を別表示し、足と混ぜません。ブローカー価格に目標・SLをそのまま転用できません。

ライブ価格はWebSocket、切断時15秒ポーリング。サーバー監視は15分足・15秒間隔。ブラウザを閉じてもPC/サーバー稼働中は継続します。通知先は環境変数で設定します。現在は未設定です。

`--host 0.0.0.0` で同じWi-Fiのスマホから閲覧可能。公開チャートはGitHub Pagesから閲覧できます。メール監視はPC側の稼働が必要です。

## 検証

```powershell
npm run check
npm test
python -m unittest discover -s tests -p "test_*.py"
```

既存の簡易バックテスト、CSV取り込みも維持。バックテストは足内のSL/TP同時接触をSL優先にし、コストを控除します。リアルタイム板・資金調達率の履歴再現ではありません。

収益性は未検証です。自動発注は行いません。分析仕様と限界はRESEARCH.mdを参照してください。
