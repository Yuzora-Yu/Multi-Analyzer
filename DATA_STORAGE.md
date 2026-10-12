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

通常の監視API JSONに埋め込まれた非nullの `lastEmail`・メール履歴も、ファイル全体を `MAIL_RECORD_REQUIRES_EXCLUSION` で除外します。送信記録を伏字コピーで蓄積する運用にはしません。過去に保存された版の変更・履歴書換はこの処理では行いません。

従来のschema 1は、1ファイル20 MiB以下の安全なbytesをgzip化してpackへ詰めます。gzipのSHA256と原本サイズ、packのSHA256とGit blobのSHAを照合します。pack内のgzip payload合計18 MiB、packの展開済みJSON32 MiB、原本換算128 MiB、Git blob20 MiB、API応答32 MiBの上限を維持します。既圧縮データが混ざっても追加圧縮率へ依存せず区切ります。

20 MiB超の入力、または単独gzip payloadが18 MiBを超える入力には、schema 2の `ordered-fragments-v1` を使用します。入力・保存コピーは各64 MiB以下、gzipの全体展開も64 MiB以下に制限します。完全なUTF-8/JSONを検査し、安全な保存用コピーを確定してから8 MiBごとの断片へ分けます。断片を単独JSONとして検査・認証せず、境界を跨ぐ秘密や絶対パスも全体検査で扱います。JSONの深さ128、走査ノード200万を超える入力は明示的に除外します。

schema 2のmanifestは1ファイルの原本・保存コピーのSHA256とサイズ、各断片の順序・offset・サイズ・SHA256・pack参照を記録します。読戻し時は断片を順番に照合して再組立し、全体SHA256と全体のプライバシーを再検査します。欠落、重複した順序番号、順序・offset・サイズ・hashの改ざんは拒否します。同じ内容の断片のpack再利用は可能ですが、位置の照合を省きません。従来のschema 1とschema 2は同じ保存履歴に共存でき、復元時は形式ごとに検証します。

全履歴を一度に展開せず、全体検査に必要な入力は1ファイルずつ処理します。大容量JSONの検査は全体の解析オブジェクトと再組立Bufferを必要とするため、64 MiBはプロセス全体のメモリ使用量の上限ではありません。作業用の解析オブジェクトだけを変更し、巨大な複製の生成を抑えます。断片アップロードの途中失敗・競合ではmanifestの公開を完了扱いせず、原本を保持します。

```
packs/<packのSHA256>.json.gz
manifests/<manifestのSHA256>.json
```

manifestは追記専用です。同じ相対パスでも内容が変われば別バージョンを残します。同一原本SHA256・プライバシーポリシーの既保存版は再保存せず、同一packのblobも重複作成しません。データ履歴をcloneせず、APIから小さなmanifestと必要なpackだけを読みます。

同期記録の `baseCommit` は読み始めたGitの版、`publishedCommit` は追加した版、`verifiedRef` は読戻しを照合した版です。これらを混同せず記録します。以前の同期記録は `baseCommit` に照合後の版を記録していたため、過去の開始版の証拠として使いません。

手元の差分indexは、Gitで検証済みの原本ハッシュとファイルのsize/mtime/ctime/デバイス・inodeが一致した場合に再読込を省きます。indexは20 MiB以下で1ファイルを置換する性能用cacheです。archiveの証拠にはしません。外部が内容とファイル属性を同時に偽装した場合は検出できないので、監査時は `sync --rehash` で原本を再読込します。index破損・参照先不一致は再読込へ戻します。

実行ごとにアカウント、保存先リポジトリがprivateであること、書込権限を確認します。認証は既存Git Credential Managerからプロセスのメモリだけへ取得し、トークンを表示・保存しません。Git ref更新は既存commitの子として `force:false` で行います。競合・通信失敗・更新結果不明の場合は実際のremote refで解決を試み、確認できなければ停止します。

保存後にremote ref、manifest、packのGit SHAとSHA256、各保存ファイルのSHA256・プライバシー状態を再取得して照合します。Git SHAはGitオブジェクトの内容照合であり、PGP署名・第三者の時刻証明ではありません。原本の市場データの真実性や予測精度を保証するものでもありません。

GitHubのprimary rateヘッダーと書込予算を確認します。標準では書込間隔1.5秒、1実行80回以下、1回の同期256 MiB・5,000新規ファイルまでです。上限、429/403等、アップロード失敗、照合失敗で停止し、再試行を無制限に続けません。手動実行時も他のクライアントの共有制限を考慮します。[GitHubのrate limit仕様](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)、[Git Data API](https://docs.github.com/en/rest/git)。

同期失敗の `FAILURE-LATEST.json` は、処理段階、読込済みmanifest数、開始commit、直近リクエストと直近失敗リクエストを記録します。リクエスト記録はGET/POST/PATCH、操作分類、開始・終了時刻、所要時間、HTTP status、応答ヘッダー／本文読込／JSON解析の段階と、許可済みの通信エラー分類だけです。URL、body、認証情報、例外message・stack・cause全体は残しません。HTTP応答がない、途中で本文が途切れた、HTTPで拒否された、内容が不正だった場合を区別します。`RESPONSE_RECEIVED` はAPIのJSONを受け取った意味で、保存データの照合成功ではありません。

`contentWrites:0` はその実行でPOST/PATCHを試行していないことを示します。書込試行があって応答不明なら、既存のremote ref/readback照合を維持します。通信エラーだけで障害原因や保存成功を断定せず、過去の詳細がない失敗記録を後から書き換えません。自動再試行やLOCK破棄は追加しません。[GitHub REST APIの障害確認](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api)。

サイズや構造による除外は保存完了として扱いません。`SOURCE_FILE_TOO_LARGE_OR_NON_REGULAR`、`SOURCE_FILE_TOO_LARGE`、`STORED_FILE_TOO_LARGE`、`INFLATED_FILE_TOO_LARGE`、`INVALID_OR_OVERSIZED_GZIP`、`JSON_STRUCTURE_BUDGET_EXCEEDED`等が1件でも発生したら、親の収集担当へ**保存障害として連携**し、原本を保持します。64 MiBを超える入力も黙って無視しません。上限を拡大する前に、検査・展開・復元の資源上限と追加検証が必要です。

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
node research-git-store.cjs inspect
node research-git-store.cjs sync
node research-git-store.cjs sync --rehash
node research-git-store.cjs prune
node research-git-store.cjs prune --apply --older-than-days 1
node research-git-store.cjs restore hourly-observation research-forward/evaluation-1790559818584.json <原本SHA256>
node --test tests/research-git-store.test.js
```

`inventory`/`dry-run` は読取専用で、API書込もローカル保存も行いません。同期・復元・削除は共通のローカルlockを取得し、衝突時は停止します。古いlockを勝手に破棄しません。同期完了・失敗・prune記録は、Git対象外の `.runtime/git-data-store/` 内の固定名のJSONへ原子的に保存します。

`inspect` は同じLOCKで直列化したGETのみの接続点検です。アカウント・非公開保存先、mainのcommit・treeの完全性と点検前後のref一致を確認します。通常8 GETで、manifest・packの本文や市場データを取得せず、保存・復元・削除や再同期を行いません。出力は `REMOTE_METADATA_VERIFIED`、`dataIntegrityVerified:false` です。これは接続とGitメタデータの確認であり、停止した同期の成功、全原本の保存や予測精度の証拠には使いません。

復元は別名、相対パス、原本SHA256で**版を明示**します。保存先は `.runtime/git-data-store/restored/<別名>/<相対パス>` に限定し、既存ファイルと原本を上書きしません。全体検証後に同じディレクトリの一時ファイルへ書き、fsyncとSHA256を照合し、排他的なhardlinkで完成版だけを公開します。hardlinkを使用できない保存先では停止し、上書きrenameへ切り替えません。失敗時の一時ファイルは整理します。伏字コピーには `--allow-redacted` が必要で、完全な原本復元とは表示しません。

schema 1の個別復元は、現在ref・manifest・pack全体と各圧縮entryのハッシュを照合したうえで、指定したファイルだけを展開し、bytes/SHA256と現在のプライバシーポリシーを検査します。古いpackにメール通知の状態記録が混在していても、安全な市場原本だけを復元できます。通知記録自体の復元は拒否します。schema 2は全断片の再組立と全体検査を維持します。同期・pruneのpack全体検査や削除範囲を緩める変更ではありません。旧Git履歴を編集・削除する処理も含みません。pruneでこのような候補外の混在を検出した場合の保留は、下記の限定した規則に従います。

## ローカル容量

### 評価入力を複製せず読む

`research-git-store.cjs` の `readExactBatch({inputs})` は、許可済み別名・相対パス・原本SHA256を指定した版だけをメモリへ返します。現在のcommitを固定し、manifestと必要なpackを照合し、全体SHA256と現在のプライバシー検査を通します。伏字版、欠落版、改ざん版、曖昧な版は返しません。一部が失敗したbatchを部分成功として評価へ渡しません。Git書込、復元データファイルの生成、原本変更、市場取得はありません。既存の制御LOCKは取得・解放します。

上限は1回16入力、catalog 1,024 manifest・32 MiB、返却原本合計64 MiBです。呼出元は上限を小さくできますが拡大できません。schema 1の指定ファイル検査とschema 2の全断片再組立の安全検査を継承し、同じ直近packの読込は再利用します。catalogは現在commitのmanifestを走査するため、件数の増加で上限に達した場合は停止し、独立したindexの検証が必要です。64 MiBはプロセス全体のメモリ上限ではありません。

全口座の再構築用には別の `readExactSet({inputs})` を使用できます。1回1,024入力まで、catalogと返却原本の上限は同じで、圧縮packの取得合計は256 MiBまでです。指定版を一つのcommitに固定し、pack単位で読んで、結果は指定した入力順に返します。直近一つの検証済み圧縮entry indexだけを再利用し、隣接する原本をまとめて展開しません。取得中にmainが進んでも固定commitの読取を続けます。上限・欠落・プライバシー検査に失敗したセットを部分成功として返しません。従来の16入力batchの上限は維持します。

分析専用の `demo-archive-input.cjs` は、元journalから得た `asset`、`snapshotId`、`sourceHash` と、保存時の原本ファイルSHA256を要求します。任意の入力パスを採用せず、不変source envelopeの場所をIDから導きます。ファイルhash、payload hash、銘柄、市場、コード版、15分境界、元の判定時刻を照合し、固定実行依存の監査を通してから元の時刻で共通エンジンを再計算します。取得時刻や現在の価格を過去判断へ混ぜません。出力は `ARCHIVE_ANALYSIS_RECONSTRUCTION` で、新規の前向き予測、約定、利益の証拠として扱いません。保存された初回取得時刻は第三者の時刻証明ではありません。

この追加はsource入力の読戻し基盤です。既定の `demo-review.cjs`、collector、本番通知、固定デモ条件は変更しません。既定auditorの入力読取にはjournal/view等を含む全評価入力のGit読戻しをまだ接続していないため、**現行の観測原本と不変cacheは保持**します。必要範囲だけを読む評価の統合・検証を完了してから、別の安全な整理工程へ進めます。[GitHub Git blobs](https://docs.github.com/en/rest/git/blobs)、[Git trees](https://docs.github.com/en/rest/git/trees) はGitオブジェクト取得の仕様であり、市場原本や予測の正しさの証明ではありません。

`demo-archive-ledger.cjs` は分析専用の全口座読戻しを追加します。`buildPlan({asset, sequence, auditAt, workspace})` は保存済みの不変cacheからview・連続journal・必要sourceの正確なファイル／payload SHA256一覧を作ります。同じsequenceのviewが複数ある場合は `viewHash` が必要です。任意の入力パスは使いません。この一覧は後から作る版選択であり、予測の事前登録や第三者の時刻証明ではありません。

`replay(plan, {expectedPlanHash})` は固定した一覧のSHA256、登録済み実行依存、初回取得時刻、全入力のハッシュ・銘柄・市場・判定IDとjournalの対応を照合します。Gitから全入力を取得後、既存の独立監査を元の `auditAt` で実行し、元判断、保存完了、未来の入口、固定SL/TP、費用、DD、未評価を再構築します。未来の監査時刻は拒否し、未終了の固定検証集計を開示しません。入力数はviewを含め1,024までで、上限を超える長期履歴には別途検証済みの区間・index設計が必要です。

両銘柄の保存済み区切りで、全入力のGit読戻しと元監査の完全一致を確認しました。この補助モジュールは既定auditor／collectorへ接続していません。**現行入力は引き続き保持**し、今回の一致を原本削除や全将来区間の保証には使いません。ローカルへの復元原本ファイル、全履歴clone、市場追加取得は作りません。

ローカルは現在の作業に必要な入力、最新レビュー、差分index、検証用の一時復元だけを維持する方針です。長期のデータ蓄積を日々ローカルへ積み重ねないよう、保存・検証後に旧生成evaluationを整理します。

今回削除可能なのは `hourly-observation/research-forward/evaluation-<epochMs>.json`（またはgzip）の旧生成レポートだけです。**最新3件、24時間以内、LATESTが指す版、原本・predictions・不変cache・登録・canonicalファイルは保持**します。削除前にGitの現在refからpackを再取得し、ローカル原本とbytes/SHA256が完全一致することを確認します。伏字済み版、未保存版、後から変わった版は削除しません。検査に失敗したpackを削除証拠に使いません。候補自体のプライバシー違反、ハッシュ改ざん、欠落や通信失敗などでは全体を停止し、削除を開始しません。これは生成レポートの個別削除で、観測原本の再帰削除は行いません。

限定した保留規則として、pack全体のハッシュ照合後に**削除候補以外**の同居レコードが `MAIL_RECORD_REQUIRES_EXCLUSION` となった場合だけ、そのpackによる候補の検証を保留し、別のpackの検査を続けます。該当packの検査を省略して候補を削除することはなく、同じファイルに別の独立した完全検証済み保存版がなければ保持します。別のpackも全体のbytes・SHA256・全レコードのプライバシー検査を通し、その後に既存のref一致、ローカル版・更新時刻・LATEST保護を再確認します。この保留はGit履歴から過去の通知記録を除去する処理ではありません。

成功記録の `retainedLegacyPacks` は保留した異なるpack数です。`completedWithWarnings:true` と `archiveWarnings` にmanifest／pack／レコード識別子のハッシュと安全な理由分類を残し、全件整理済みとは扱いません。未完了の検証を「成功」と数えません。本文・メール・例外message・ローカル絶対パスは残しません。その他の失敗は `PRUNE_FAILURE-LATEST.json` に段階と候補自身／候補外の区別、実際の生成コピー削除数を記録します。削除途中のファイル操作に失敗した場合は一部完了の可能性を明示し、無条件の削除0件とは表示しません。通常同期の成功と整理の保留・失敗は別々に確認します。

分割保存したschema 2の原本は、旧生成evaluationであっても今回のprune対象に含めません。`FRAGMENTED_ORIGINAL_RETAINED` として保持します。大容量の実Git読戻しを確認しても、この段階では削除範囲を拡大しません。

既に整理済みでローカルに存在しない旧評価や、最近更新された保護対象だけのpackは読み戻しません。manifestと現在refを照合してローカル候補を絞り、必要なpackを検証した後にパス・更新時刻・SHA256・bytesを再確認します。実際のpack検証件数は `verifiedPacks` に記録します。対象がなければpack取得は0件ですが、Git全履歴を毎回再監査した意味ではありません。

観測原本と不変cacheの保存先はGitへ移しても、既存の評価コードが直接読んでいる作業入力はこの段階で消しません。将来の原本整理は、評価コードの必要範囲のGit読戻しに対応し、その検証を通してから実施します。画像・ZIP等の既存成果物の削除もこのコマンドは扱いません。
