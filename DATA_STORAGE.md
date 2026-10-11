# 検証データの保存

検証・研究データの継続的な蓄積先は、非公開の [Multi-Analyzer-data](https://github.com/Yuzora-Yu/Multi-Analyzer-data) です。アプリの公開リポジトリには観測データを含めません。ダウンロードフォルダへ日々のデータや全履歴のGit cloneを作りません。

`research-git-store.cjs` は既存の保存済みファイルだけを読み、圧縮してGitHubのGit Data APIへ追記します。市場取得、注文、メール、通知、既存の監視条件・デモ条件の変更は行いません。根幹エンジンや固定実行依存にも追加していません。

## 保存対象と個人情報

固定のルート別名を使用します。任意のパス指定は受け付けません。

| 別名 | 対象 |
| --- | --- |
| `hourly-observation` | 既存の観測・前向き評価・研究記録 |
| `demo-lab` | 登録、デモ原本・追記記録、不変cache、レビュー、担当の設計記録 |
| `persona-trend` | 順張り担当チャットの `outputs` |
| `persona-reversion` | 反発担当チャットの `outputs` |
| `persona-confirmation` | 確認担当チャットの `outputs` |

対応形式はUTF-8のJSON、JSONL、NDJSON、Markdown、TXT、CSV、TSV、およびこれらのgzipです。SMTP・メール本文/送受信payload・response・receipt・ledger、認証や設定ファイル、環境変数ファイル、一時ファイル、依存ライブラリ、画像、ZIP、動画は対象外です。リンクを辿って許可範囲外のファイルを読みません。

JSONのメールアドレス、認証値、アカウント・チャット識別子、ローカル絶対パス等の**メタデータだけ**を保存用コピーで除去します。価格、時刻、売買判断を変更しません。判定本文等のメタデータ以外に個人情報を含む場合、文章を都合よく変更せず、そのファイルを除外します。安全性が確認できない形式・サイズ・内容も除外し、件数と理由を非公開の実行記録に残します。

デモのsource/journal、不変cache、登録原本、ハッシュ付きtransport本文等の証拠が伏字を必要とする場合は、既存ハッシュを付け替えず除外します。元ファイルは一切編集しません。各manifestには原本SHA256、保存コピーSHA256、伏字有無、完全な原本として復元可能かを分けて記録します。伏字したコピーを元の原本として完全復元できるとは扱いません。自動検査が未知の個人情報を完全に検出する保証はなく、新形式の追加時は別途監査します。

## 圧縮と差分保存

1ファイルずつ安全なbytesをgzip化し、gzipのSHA256と原本サイズを記録してpackへ詰めます。packはSHA256で名前を決め、Git blobのSHAも照合します。pack自体は再度gzipします。1ファイル20 MiB、pack内のgzip payload合計18 MiB、packの展開済みJSON32 MiB、原本換算128 MiB、Git blob20 MiB以下の上限を設けています。既圧縮データが混ざっても追加圧縮率へ依存せず区切ります。復元では全原本を一度に展開せず、1ファイルずつ照合します。大きすぎる入力は分割したふりをせず除外します。

```
packs/<packのSHA256>.json.gz
manifests/<manifestのSHA256>.json
```

manifestは追記専用です。同じ相対パスでも内容が変われば別バージョンを残します。同一原本SHA256・プライバシーポリシーの既保存版は再保存せず、同一packのblobも重複作成しません。データ履歴をcloneせず、APIから小さなmanifestと必要なpackだけを読みます。

手元の差分indexは、Gitで検証済みの原本ハッシュとファイルのsize/mtime/ctime/デバイス・inodeが一致した場合に再読込を省きます。indexは20 MiB以下で1ファイルを置換する性能用cacheです。archiveの証拠にはしません。外部が内容とファイル属性を同時に偽装した場合は検出できないので、監査時は `sync --rehash` で原本を再読込します。index破損・参照先不一致は再読込へ戻します。

実行ごとにアカウント、保存先リポジトリがprivateであること、書込権限を確認します。認証は既存Git Credential Managerからプロセスのメモリだけへ取得し、トークンを表示・保存しません。Git ref更新は既存commitの子として `force:false` で行います。競合・通信失敗・更新結果不明の場合は実際のremote refで解決を試み、確認できなければ停止します。

保存後にremote ref、manifest、packのGit SHAとSHA256、各保存ファイルのSHA256・プライバシー状態を再取得して照合します。Git SHAはGitオブジェクトの内容照合であり、PGP署名・第三者の時刻証明ではありません。原本の市場データの真実性や予測精度を保証するものでもありません。

GitHubのprimary rateヘッダーと書込予算を確認します。標準では書込間隔1.5秒、1実行80回以下、1回の同期256 MiB・5,000新規ファイルまでです。上限、429/403等、アップロード失敗、照合失敗で停止し、再試行を無制限に続けません。手動実行時も他のクライアントの共有制限を考慮します。[GitHubのrate limit仕様](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)、[Git Data API](https://docs.github.com/en/rest/git)。

サイズによる除外は保存完了として扱いません。`SOURCE_FILE_TOO_LARGE_OR_NON_REGULAR`、`SOURCE_FILE_TOO_LARGE`、`STORED_FILE_TOO_LARGE`、`SOURCE_FILE_COMPRESSION_TOO_LARGE`、`INFLATED_FILE_TOO_LARGE`、`INVALID_OR_OVERSIZED_GZIP`等が1件でも発生したら、親の収集担当へ**保存障害として連携**し、原本を保持します。静かに無視してローカル増加を続ける運用にはしません。今の20 MiB上限を超えるevaluation等には、将来のファイル分割保存と完全な読戻しの実装・検証が必要です。その対応前に大きな原本を削除しません。

## 実行

設定はGit対象外の `.runtime/git-data-store/config.json` に置きます。秘密を設定に記載しません。

```json
{
  "repository": "Yuzora-Yu/Multi-Analyzer-data",
  "account": "Yuzora-Yu",
  "branch": "main",
  "roots": ["hourly-observation", "demo-lab", "persona-trend", "persona-reversion", "persona-confirmation"],
  "maxBatchBytes": 1073741824,
  "maxBatchFiles": 5000,
  "maxContentWrites": 80,
  "contentWriteIntervalMs": 1500
}
```

`maxBatchBytes` は最大1 GiBです。途中で新規保存上限へ達したら、検証済みの区切りで終わり、`deferred:true` を返します。次回は残りの差分を続けます。

```powershell
node research-git-store.cjs inventory
node research-git-store.cjs dry-run
node research-git-store.cjs sync
node research-git-store.cjs sync --rehash
node research-git-store.cjs prune
node research-git-store.cjs prune --apply --older-than-days 1
node research-git-store.cjs restore hourly-observation research-forward/evaluation-1790559818584.json <原本SHA256>
node --test tests/research-git-store.test.js
```

`inventory`/`dry-run` は読取専用で、API書込もローカル保存も行いません。同期・復元・削除は共通のローカルlockを取得し、衝突時は停止します。古いlockを勝手に破棄しません。同期完了・失敗・prune記録は、Git対象外の `.runtime/git-data-store/` 内の固定名のJSONへ原子的に保存します。

復元は別名、相対パス、原本SHA256で**版を明示**します。保存先は `.runtime/git-data-store/restored/<別名>/<相対パス>` に限定し、既存ファイルと原本を上書きしません。伏字コピーには `--allow-redacted` が必要で、完全な原本復元とは表示しません。

## ローカル容量

ローカルは現在の作業に必要な入力、最新レビュー、差分index、検証用の一時復元だけを維持する方針です。長期のデータ蓄積を日々ローカルへ積み重ねないよう、保存・検証後に旧生成evaluationを整理します。

今回削除可能なのは `hourly-observation/research-forward/evaluation-<epochMs>.json`（またはgzip）の旧生成レポートだけです。**最新3件、24時間以内、LATESTが指す版、原本・predictions・不変cache・登録・canonicalファイルは保持**します。削除前にGitの現在refからpackを再取得し、ローカル原本とbytes/SHA256が完全一致することを確認します。伏字済み版、未保存版、後から変わった版は削除しません。確認途中の失敗では削除を開始しません。これは生成レポートの個別削除で、観測原本の再帰削除は行いません。

既に整理済みでローカルに存在しない旧評価や、最近更新された保護対象だけのpackは読み戻しません。manifestと現在refを照合してローカル候補を絞り、必要なpackを検証した後にパス・更新時刻・SHA256・bytesを再確認します。実際のpack検証件数は `verifiedPacks` に記録します。対象がなければpack取得は0件ですが、Git全履歴を毎回再監査した意味ではありません。

観測原本と不変cacheの保存先はGitへ移しても、既存の評価コードが直接読んでいる作業入力はこの段階で消しません。将来の原本整理は、評価コードの必要範囲のGit読戻しに対応し、その検証を通してから実施します。画像・ZIP等の既存成果物の削除もこのコマンドは扱いません。
