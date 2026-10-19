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

ローカル入力の走査中は、選択した保存元の別名と相対パスのSHA256を `progress.localSource` に記録します。実パス・ファイル名・本文は残しません。ディレクトリ列挙後の読取りやcache照合時に保存元が利用できなくなった場合も、どの別名・入力を選択していたかを区別できます。これは原因の診断情報であり、ファイル消失の原因や復旧・Git保存の成功を示しません。走査完了後はこの情報を外します。過去の失敗記録へ後から付加しません。

OSのファイル操作例外には、`localFilesystemFailure` に許可済みの操作分類・エラー分類・範囲を限定したerrnoを残します。例外のpathが許可済み保存元の範囲なら、実際に失敗したパスの別名・相対パスSHA256も記録します。メッセージ、stack、実パス、本文は残しません。`progress.localSource` は直前に選択した入力なので、次のディレクトリ列挙で失敗した場合などは例外側のsourceと異なり得ます。`request` は最後のGitリクエストの文脈であり、成功したHTTP 200を後続のローカル障害の原因とは扱いません。診断の追加で保存・削除の条件を緩めたり、自動再試行したりしません。

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
node research-git-store.cjs lock-status
node research-git-store.cjs inspect
node research-git-store.cjs sync
node research-git-store.cjs sync --rehash
node research-git-store.cjs prune
node research-git-store.cjs prune --apply --older-than-days 1
node research-git-store.cjs restore hourly-observation research-forward/evaluation-1790559818584.json <原本SHA256>
node --test tests/research-git-store.test.js
```

`inventory`/`dry-run` は読取専用で、API書込もローカル保存も行いません。同期・復元・削除は共通のローカルlockを取得し、衝突時は停止します。古いlockを勝手に破棄しません。同期完了・失敗・prune記録は、Git対象外の `.runtime/git-data-store/` 内の固定名のJSONへ原子的に保存します。

`lock-status` は認証・API・LOCK取得を行わないローカル読取専用の診断です。1 KiB以下の通常ファイルだけを読み、LOCKのSHA256・ファイル時刻・PID・開始時刻と、[signal 0によるプロセス存在照会](https://nodejs.org/api/process.html#processkillpid-signal)を返します。権限不足・不正なメタデータ・照会中のファイル差替えは不明または検査失敗として扱います。本文の追加キーや例外messageを出力しません。`OWNER_ABSENT_CANDIDATE` はその時点でPIDが不在という診断であり、ロック解除・prune完了・削除0件・保存成功の証明ではありません。PID再利用やプロセス終了の原因までは判定せず、自動削除・再試行もしません。収集担当と同じLOCKのhash、最新receipt、現在の処理状態を照合してから復旧方法を決めます。

`inspect` は同じLOCKで直列化したGETのみの接続点検です。アカウント・非公開保存先、mainのcommit・treeの完全性と点検前後のref一致を確認します。通常8 GETで、manifest・packの本文や市場データを取得せず、保存・復元・削除や再同期を行いません。出力は `REMOTE_METADATA_VERIFIED`、`dataIntegrityVerified:false` です。これは接続とGitメタデータの確認であり、停止した同期の成功、全原本の保存や予測精度の証拠には使いません。

参照の更新は引き続き `force:false` の1回だけです。[更新API](https://docs.github.com/en/rest/git/refs#update-a-reference) が新commitのSHAを返した後、読取APIが元のbaseを返し、[履歴比較](https://docs.github.com/en/rest/commits/commits#compare-two-commits)も `behind` となる場合に限り、500ms・1,000ms後にGETだけを追加確認します。観測は最初を含め最大3回で、POST/PATCHや同期全体の再試行ではありません。更新応答が新SHAを確認できない場合、実際の分岐、別の参照、未確認状態では、この追加読取を行いません。古いbaseが残り続けた場合も保存完了とはせず停止します。新commitまたは後続の参照を確認しても、tree・manifest・pack・各原本hashとプライバシー検査を省略しません。

成功／失敗receiptの `publication` はbase・作成commit・更新応答による確認の有無・各観測refと比較分類・検証段階を記録します。HTTP200だけを履歴継承の証拠にはしません。応答本文、認証値、commit作者の情報は追加しません。以前の失敗でこれらが記録されていなければ、後の正常な履歴だけから当時の原因や同期成功を断定せず、元の失敗と後の検証を分けます。

復元は別名、相対パス、原本SHA256で**版を明示**します。保存先は `.runtime/git-data-store/restored/<別名>/<相対パス>` に限定し、既存ファイルと原本を上書きしません。全体検証後に同じディレクトリの一時ファイルへ書き、fsyncとSHA256を照合し、排他的なhardlinkで完成版だけを公開します。hardlinkを使用できない保存先では停止し、上書きrenameへ切り替えません。失敗時の一時ファイルは整理します。伏字コピーには `--allow-redacted` が必要で、完全な原本復元とは表示しません。

schema 1の個別復元は、現在ref・manifest・pack全体と各圧縮entryのハッシュを照合したうえで、指定したファイルだけを展開し、bytes/SHA256と現在のプライバシーポリシーを検査します。古いpackにメール通知の状態記録が混在していても、安全な市場原本だけを復元できます。通知記録自体の復元は拒否します。schema 2は全断片の再組立と全体検査を維持します。同期・pruneのpack全体検査や削除範囲を緩める変更ではありません。旧Git履歴を編集・削除する処理も含みません。pruneでこのような候補外の混在を検出した場合の保留は、下記の限定した規則に従います。

## ローカル容量

### 同じ保存目録の反復取得を減らす

`sync` と `prune` は、毎回の非公開リポジトリ確認と現在のref・tree取得を維持し、取得済みmanifestの正確なbytesだけを `.runtime/git-data-store/MANIFEST-CACHE.json` から再利用できます。現在のtree内のpath/Git blob SHA、bytesから計算したGit blob SHA、pathのSHA256、manifestのschema・方針・各packの現在tree内の対応を毎回照合します。過去のrefやローカル一覧だけを根拠に保存済みとは判定しません。[Git blobs](https://docs.github.com/en/rest/git/blobs) と [Git trees](https://docs.github.com/en/rest/git/trees) の内容IDを使用します。

この置換可能なローカル目録は最大1,024件・保存ファイル20 MiBです。価格原本、pack、認証値、API応答本文はキャッシュしません。壊れたbytesは使用せず通常の遠隔取得へ戻り、読書き不能なキャッシュは最適化だけを停止します。上限を超える目録は通常どおり取得します。途中で同期が停止しても、それまで完全照合できた目録を保持でき、全同期を自動再実行しません。LOCK・GitHub残量保護は維持します。

新規publication後のmanifest・pack・各保存ファイルの遠隔読戻し、およびprune候補の遠隔pack・原本bytes照合には、このキャッシュを使いません。復元・分析専用readerの取得方式と上限も変更しません。原本削除の証明や長期の研究保存先ではありません。実行記録の `catalogCache` はcache命中、blob読取試行、容量保留等を区別します。

### 評価入力を複製せず読む

`research-git-store.cjs` の `readExactBatch({inputs})` は、許可済み別名・相対パス・原本SHA256を指定した版だけをメモリへ返します。現在のcommitを固定し、manifestと必要なpackを照合し、全体SHA256と現在のプライバシー検査を通します。伏字版、欠落版、改ざん版、曖昧な版は返しません。一部が失敗したbatchを部分成功として評価へ渡しません。Git書込、復元データファイルの生成、原本変更、市場取得はありません。既存の制御LOCKは取得・解放します。

上限は1回16入力、catalog 1,024 manifest・32 MiB、返却原本合計64 MiBです。呼出元は上限を小さくできますが拡大できません。schema 1の指定ファイル検査とschema 2の全断片再組立の安全検査を継承し、同じ直近packの読込は再利用します。catalogは現在commitのmanifestを走査するため、件数の増加で上限に達した場合は停止し、独立したindexの検証が必要です。64 MiBはプロセス全体のメモリ上限ではありません。

全口座の再構築用には別の `readExactSet({inputs})` を使用できます。1回1,024入力まで、catalogと返却原本の上限は同じで、圧縮packの取得合計は256 MiBまでです。指定版を一つのcommitに固定し、pack単位で読んで、結果は指定した入力順に返します。直近一つの検証済み圧縮entry indexだけを再利用し、隣接する原本をまとめて展開しません。取得中にmainが進んでも固定commitの読取を続けます。上限・欠落・プライバシー検査に失敗したセットを部分成功として返しません。従来の16入力batchの上限は維持します。

分析専用の `demo-archive-input.cjs` は、元journalから得た `asset`、`snapshotId`、`sourceHash` と、保存時の原本ファイルSHA256を要求します。任意の入力パスを採用せず、不変source envelopeの場所をIDから導きます。ファイルhash、payload hash、銘柄、市場、コード版、15分境界、元の判定時刻を照合し、固定実行依存の監査を通してから元の時刻で共通エンジンを再計算します。取得時刻や現在の価格を過去判断へ混ぜません。出力は `ARCHIVE_ANALYSIS_RECONSTRUCTION` で、新規の前向き予測、約定、利益の証拠として扱いません。保存された初回取得時刻は第三者の時刻証明ではありません。

この追加はsource入力の読戻し基盤です。既定の `demo-review.cjs`、collector、本番通知、固定デモ条件は変更しません。既定auditorの入力読取にはjournal/view等を含む全評価入力のGit読戻しをまだ接続していないため、**現行の観測原本と不変cacheは保持**します。必要範囲だけを読む評価の統合・検証を完了してから、別の安全な整理工程へ進めます。[GitHub Git blobs](https://docs.github.com/en/rest/git/blobs)、[Git trees](https://docs.github.com/en/rest/git/trees) はGitオブジェクト取得の仕様であり、市場原本や予測の正しさの証明ではありません。

`demo-archive-ledger.cjs` は分析専用の全口座読戻しを追加します。`buildPlan({asset, sequence, auditAt, workspace})` は保存済みの不変cacheからview・連続journal・必要sourceの正確なファイル／payload SHA256一覧を作ります。同じsequenceのviewが複数ある場合は `viewHash` が必要です。任意の入力パスは使いません。この一覧は後から作る版選択であり、予測の事前登録や第三者の時刻証明ではありません。

`replay(plan, {expectedPlanHash})` は固定した一覧のSHA256、登録済み実行依存、初回取得時刻、全入力のハッシュ・銘柄・市場・判定IDとjournalの対応を照合します。Gitから全入力を取得後、既存の独立監査を元の `auditAt` で実行し、元判断、保存完了、未来の入口、固定SL/TP、費用、DD、未評価を再構築します。未来の監査時刻は拒否し、未終了の固定検証集計を開示しません。入力数はviewを含め1,024までで、上限を超える長期履歴には別途検証済みの区間・index設計が必要です。

両銘柄の保存済み区切りで、全入力のGit読戻しと元監査の完全一致を確認しました。この補助モジュールは既定auditor／collectorへ接続していません。**現行入力は引き続き保持**し、今回の一致を原本削除や全将来区間の保証には使いません。ローカルへの復元原本ファイル、全履歴clone、市場追加取得は作りません。

### 1,024入力を超える固定区切りの分割読取

分析専用の `buildPagedPlan` / `replayPaged` は、schema 2の入力一覧で `verified-pages-v1` を指定します。これは保存入力を選ぶ版で、売買条件の新バージョンではありません。既存のschema 1、一括1,024入力、通常16入力batch、sequence上限1,023は変更しません。

`readExactPages({inputs, onPage})` は一つのLOCK・Git commit・catalogを共有し、最大128ページ、各16入力・4 MiB以下で原本を検証して渡します。全入力のメタデータ、欠落、伏字、全体容量、ページ境界を先に検査します。返却原本の累計64 MiB、catalog 1,024 manifest／32 MiB、圧縮pack取得累計256 MiBの制限をページごとにリセットしません。任意に上限を広げるAPIではありません。

ページは全体完了前の仮の入力です。`replayPaged` は原本とpayloadのhash・元の取得時刻・順番・銘柄をページ内で照合し、未公開の作業領域へdecodeします。全ページと最後のprivate確認が成功してから、元の全journal/source対応・連鎖・固定口座監査を実行します。後続pack破損、欠落、重複、途中の入力一覧変更、権限確認の失敗では全体が失敗し、途中の帳簿を監査結果にしません。読取APIはraw入力の全配列を返さず、処理済みページのBufferを保持しません。ただし呼出元のdecode済み原本やpack indexもメモリを使うため、64 MiBはプロセス全体の上限ではありません。

元監査との完全一致を比較するときの `auditAt` は、対象assetの個別監査に記録された `generatedAt` を使用します。外側のreportの `generatedAt` は、その後の全体報告書作成時刻であり、同じ値とは限りません。元記録を変更したり、差を都合よく削除して一致扱いにしたりしません。

この読取も既定auditor／collectorへ接続せず、現行入力は保持します。ページ数・sequence・全体容量のいずれかを超える履歴には、さらに別途検証済みの区間・checkpoint設計が必要です。[Git trees](https://docs.github.com/en/rest/git/trees) と [Git blobs](https://docs.github.com/en/rest/git/blobs) のオブジェクト仕様を利用しますが、Gitのhashだけで市場データの真実性を証明するものではありません。

ローカルは現在の作業に必要な入力、最新レビュー、差分index、検証用の一時復元だけを維持する方針です。長期のデータ蓄積を日々ローカルへ積み重ねないよう、保存・検証後に旧生成evaluationを整理します。

今回削除可能なのは `hourly-observation/research-forward/evaluation-<epochMs>.json`（またはgzip）の旧生成レポートだけです。**最新3件、24時間以内、LATESTが指す版、原本・predictions・不変cache・登録・canonicalファイルは保持**します。削除前にGitの現在refからpackを再取得し、ローカル原本とbytes/SHA256が完全一致することを確認します。伏字済み版、未保存版、後から変わった版は削除しません。検査に失敗したpackを削除証拠に使いません。候補自体のプライバシー違反、ハッシュ改ざん、欠落や通信失敗などでは全体を停止し、削除を開始しません。これは生成レポートの個別削除で、観測原本の再帰削除は行いません。

限定した保留規則として、pack全体のハッシュ照合後に**削除候補以外**の同居レコードが `MAIL_RECORD_REQUIRES_EXCLUSION` となった場合だけ、そのpackによる候補の検証を保留し、別のpackの検査を続けます。該当packの検査を省略して候補を削除することはなく、同じファイルに別の独立した完全検証済み保存版がなければ保持します。別のpackも全体のbytes・SHA256・全レコードのプライバシー検査を通し、その後に既存のref一致、ローカル版・更新時刻・LATEST保護を再確認します。この保留はGit履歴から過去の通知記録を除去する処理ではありません。

成功記録の `retainedLegacyPacks` は保留した異なるpack数です。`completedWithWarnings:true` と `archiveWarnings` にmanifest／pack／レコード識別子のハッシュと安全な理由分類を残し、全件整理済みとは扱いません。未完了の検証を「成功」と数えません。本文・メール・例外message・ローカル絶対パスは残しません。その他の失敗は `PRUNE_FAILURE-LATEST.json` に段階と候補自身／候補外の区別、実際の生成コピー削除数を記録します。削除途中のファイル操作に失敗した場合は一部完了の可能性を明示し、無条件の削除0件とは表示しません。通常同期の成功と整理の保留・失敗は別々に確認します。

分割保存したschema 2の原本は、旧生成evaluationであっても今回のprune対象に含めません。`FRAGMENTED_ORIGINAL_RETAINED` として保持します。大容量の実Git読戻しを確認しても、この段階では削除範囲を拡大しません。

既に整理済みでローカルに存在しない旧評価や、最近更新された保護対象だけのpackは読み戻しません。manifestと現在refを照合してローカル候補を絞り、必要なpackを検証した後にパス・更新時刻・SHA256・bytesを再確認します。実際のpack検証件数は `verifiedPacks` に記録します。対象がなければpack取得は0件ですが、Git全履歴を毎回再監査した意味ではありません。

観測原本と不変cacheの保存先はGitへ移しても、既存の評価コードが直接読んでいる作業入力はこの段階で消しません。将来の原本整理は、評価コードの必要範囲のGit読戻しに対応し、その検証を通してから実施します。画像・ZIP等の既存成果物の削除もこのコマンドは扱いません。
