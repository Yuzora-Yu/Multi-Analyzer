# 起動・スマホ・通知設定

Python 3.10以上、Node.js 20以上。外部パッケージのインストールは不要です。

## PC

```powershell
cd C:\Users\ship2\Documents\04-Gemini\Multi-Analyzer
python server.py --monitor
```

http://127.0.0.1:8000/ を開きます。監視プロセスはGold・BTCの15分足を15秒間隔で確認します。ブラウザの選択銘柄・時間足には依存しません。価格はWebSocket、切断時は15秒ポーリング。USD参考値は30秒間隔です。サーバー・PCの停止やスリープ中は通知されません。

## 同じWi-Fiのスマホ

```powershell
python server.py --host 0.0.0.0 --port 8000 --monitor
ipconfig
```

スマホで `http://PCのIPv4アドレス:8000/` を開きます。Windows Firewallで必要な場合はPythonのプライベートネットワーク通信を許可してください。インターネットへのポート開放は不要です。外出先で使う場合は、別途HTTPSホスティングまたはプライベートVPNが必要です。本改修では公開デプロイしていません。

## Discord

自分の通知用チャンネルでWebhookを作成し、同じPowerShell内で設定して起動します。

```powershell
$env:MA_DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/ID/TOKEN'
python server.py --monitor
```

URLは秘密情報です。ブラウザ、Git、共有スクリーンショットに貼り付けないでください。通知送信は設定後に初めて有効になります。既存シグナルは起動時に基準として記録し、新しい買い／売り候補とクローズ推奨を送ります。WATCH・WAITは通知しません。同一足・同一状態は重複抑制します。READY→STRONGは別の状態です。

## メール（任意・Discordとの併用可）

```powershell
$env:MA_SMTP_HOST = 'smtp.example.com'
$env:MA_SMTP_PORT = '465'
$env:MA_SMTP_USER = 'your-user'
$env:MA_SMTP_PASSWORD = 'your-app-password'
$env:MA_EMAIL_FROM = 'sender@example.com'
$env:MA_EMAIL_TO = 'recipient@example.com'
python server.py --monitor
```

465はTLS、その他のポートはSTARTTLSを必須にします。メールサービス側の認証・送信制限が適用されます。今回、実際の通知先は設定しておらず、送信先への実送信は未検証です。

## サーバー監視用のリスク・保有設定

ブラウザの保有入力は端末内・銘柄別に保存されます。サーバー監視には自動転送しません。クローズ通知が必要なら、`monitor-config.example.json` を `monitor-config.json` にコピーして保有を設定します。

```powershell
$env:MA_MONITOR_CONFIG = 'C:\Users\ship2\Documents\04-Gemini\Multi-Analyzer\monitor-config.json'
python server.py --monitor
```

ファイルは監視のたびに読み直します。保有を解消したら該当銘柄を `null` にしてください。ブラウザと監視で設定をそろえると同じ計算規則になりますが、取得時刻による価格差があります。口座資金はUSD/USDT、Gold数量はoz、BTCはBTCです。ブローカーのlotではありません。

## 通知の状態・再試行

「詳細」内に監視状況と通知先の設定有無を表示します。内部状態は `.runtime/` に保存し、Web経由では配信しません。Discord 429は指定待機時間後に再試行し、無効になったシグナルは再送しません。401/403/404など恒久的エラーは送信停止します。修正後はサーバー停止中に `.runtime/alerts.json` の `disabled` を `{}` にして再起動してください。

通信タイムアウトで配信成否が不明な場合、再試行による重複が生じる可能性があります。完全なexactly-once配信は保証しません。

## 検証

```powershell
npm run check
npm test
python -m unittest discover -s tests -p "test_*.py"
python -m py_compile server.py alert_delivery.py
```


## Gmailのローカル設定（v4.1）

`.runtime/email-config.json` の `host` を `smtp.gmail.com`、`port` を `465`、`user` / `from` を送信元Gmail、`to` を宛先、`appPassword` をGoogleで発行したアプリパスワードにします。このファイルはGit対象外でHTTP配信もしません。環境変数が指定されている場合は環境変数が優先です。

Google公式: https://support.google.com/accounts/answer/185833?hl=ja
発行画面: https://myaccount.google.com/apppasswords

アプリパスワードは2段階認証が必要です。組織やアカウントの制限で利用できない場合があります。通常のログインパスワードは入力しないでください。

設定保存後、次で自分の宛先へ接続テストを送信できます。

```powershell
python alert_delivery.py --test
```

監視サーバーを再起動すると設定が反映されます。通知本文には推奨内容と `https://yuzora-yu.github.io/Multi-Analyzer/?asset=gold&tf=15m` またはBTCへのリンクが入り、対象銘柄の公開チャートを開けます。通知時点の推奨とリンク先の最新判定は異なることがあります。

現在の監視はCloudflareで動作し、PCは不要です。15分足は画面・メールで共通のBybitスナップショットを使用します。以下のPC監視は代替運用向けで、クラウドと併用しないでください。個別の保有情報はブラウザ内に保存します。
