# v4.3.1 検証記録（2026-09-08）

- JS 29テスト、Python 7テスト、全JS構文チェック成功。
- 価格帯分配の出来高保存、70% VA、欠損出来高、未来追加時の履歴不変、H1確定境界、P条件の負例、スナップショット往復を追加検証。
- Cloudflare本番とローカルで同じ保存データから再計算し、金・BTCともNO_TRADEが一致。version 4.3.1 / pullback-v1 / 出来高あり。
- 390×844のスマホ表示とPC表示、詳細パネル、コンソールエラーなしを確認。
- 実データ比較はRESEARCH_V43.mdとvalidation-v43.json。収益上の優位性は未確認。
- GitHub Pages 283c3fc のデプロイ成功・公開画面の共通IDを確認。
- 通知リンクで保存判定を再現し、現在の推奨ではない表示を確認。
- 共通判定移行のテストメールはCloudflareでemailAccepted=true。受信箱での到着確認とは区別。
- 本番Worker版: b56a50a5-b8f5-4e1c-8353-7eee5c303c5b。

以下は過去バージョンの履歴です。

# v4 検証結果 — 2026-09-08

- Node構文チェック成功。
- Nodeテスト21件成功。既存ロジック、SMC生成・失効・確定時刻、未確定足除外、欠損入力、通知キーを検証。
- Python通知テスト7件成功。ネットワーク送信はモックで、未設定時の無送信、Discord wait/mentions/429、任意ホスト拒否、SMTP TLSを検証。
- Python構文チェック成功。
- 実環境でBinance Gold/BTC足とGold API USD参考価格の取得成功。
- サーバー監視の両銘柄分析、通知先未設定表示を確認。
- ブラウザでPCと390×844のスマホ幅を確認。Gold/BTC切替、保有分離、クローズ推奨表示、テスト保有の消去を確認。
- Gold 15分足999本のブラウザ内バックテストが完了。候補0件。収益性を判断できるサンプルは得られていません。
- 取得停止で判断待機、ポーリング復旧時に価格再表示を確認。
- `/server.py`、`/.runtime/alerts.json`、`/monitor-config.json` は404、HEADは405。
- `git diff --check` 成功。

未実施: 実端末スマホからWi-Fi接続（レスポンシブ表示は実ブラウザで確認）、Discord/Email実送信、長期運用、収益性評価、外出先HTTPS公開。

デモのテスト保有は消去済み。自動発注機能なし。v4.1ではメール本文の推奨内容・公開リンクとGmail認証未設定時の送信抑止も検証。


## UI4 / 2026-09-14
- JavaScript 33 tests pass; Python 7 tests pass; syntax checks and git diff whitespace check pass.
- New tests validate ZIP central-directory offsets/CRC/binary/UTF-8, exact common 15m input, forming-candle exclusion, partial fetch errors, cancellation before fetch, and next-open outcome/missing-bar handling.
- Python standard zipfile also opened the generated ZIP and passed CRC validation.
- Actual in-app Chromium browser: 1280x800 desktop and 390x844 mobile. Checked normal chart, focus mode, 6-timeframe comparison, evidence view, both-asset 12-chart generation, 15-file ZIP preparation/download action, and AI prompt clipboard success. No new browser script errors on the final local server.
- First research run: 8 distinct canonical observations (4 per asset), no fetch errors; 12 timeframe datasets additionally gzip-saved. No performance inference or production model change.
- Export uses standardized review drawings, not DOM screenshots. Safari/iOS device-level download handling remains unverified.


## UI5 / 2026-09-14
- 36 JavaScript tests and all syntax checks pass. Added actual-trade validation/deduplication, unknown/crossed quote handling, and stale/missing overview tests.
- Actual browser: mobile confirmation table is readable; desktop1280 viewport has no horizontal overflow (dialog clientWidth=scrollWidth1238). Both-asset export prepares16 files including overview.png; download action works.
- Live public-data research capture succeeded: Gold1000 trades over438.99s and BTC60 trades over31.76s; quote capture succeeded. Raw samples and coverage saved privately, not used for alerts.
- Source review and prospective comparison plan recorded in RESEARCH_2026.md. PBO implementation is not claimed. Signal engine unchanged.
