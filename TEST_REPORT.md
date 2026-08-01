# Test Report

実施日: 2026-08-01

## 合格

- `npm run check`
  - `app.js` 構文エラーなし
  - `strategy-core.js` 構文エラーなし
  - `backtest-worker.js` 構文エラーなし
- `npm test`
  - 11テストすべて合格
- `python3 -m py_compile server.py`
  - 構文エラーなし
- HTMLのIDとJavaScript参照IDの照合
  - 未定義参照なし
- ローカル静的サーバー
  - `/` がHTTP 200
  - `/api/health` が正常JSONを返す

## テストで確認した性質

1. OHLCの並び替え、重複除去、不正値除外
2. 形成中足を確定足分析から除外
3. 上位足集計で未完成バケットを除外
4. 右側足が揃う前のスイング情報を過去へ漏らさない
5. LONG / SHORT独立スコアとリスクプランの生成
6. 重要指標ブラックアウトがhard vetoになる
7. ライブ価格がストップに達した場合、即時EXITになる
8. 同一足でSLとTPに触れた場合、SLを優先する
9. CSV解析
10. TP1後、同一足で建値ストップにも触れた場合の保守的決済
11. バックテストが未来情報関連の例外なく完了する

## この環境で未確認

- Binance本番APIへの完全な外部疎通
- WebSocketの長時間安定性
- XAUUSDT / XAGUSDTが利用地域で提供されるか
- 実ブローカーのスプレッド、スリッページ、契約サイズとの一致
- Chrome / Edge / Safari / Firefoxの全組み合わせでの長時間E2E

本番利用前に、対象ブローカーのCSVとペーパートレードで再検証してください。
