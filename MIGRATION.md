# GitHubへの反映手順

元の3つのHTMLを残したまま、新版をサブフォルダーで試す方法が安全です。

```text
Multi-Analyzer/
  index.html
  index_ver1.00.html
  index_ver1.01.html
  ultimate/
    index.html
    styles.css
    app.js
    strategy-core.js
    backtest-worker.js
    server.py
```

## 推奨手順

1. ZIPを展開する
2. フォルダー名を `ultimate` にして元リポジトリへ追加する
3. ローカルで `python server.py` を実行する
4. GOLD / SILVER / BTCの履歴取得とリアルタイム更新を確認する
5. CSVモードとバックテストを確認する
6. 問題がなければルートの `index.html` と関連ファイルを新版へ切り替える

GitHub Pagesは静的配信だけなので、環境によってBinance APIのCORSや地域制限に影響されます。確実に使う場合は `server.py` でローカル起動してください。
