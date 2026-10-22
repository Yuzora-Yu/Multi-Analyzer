# MT5版のビルドと配布

公開アプリと同じGitでソース、版ごとのZIP、SHA256、変更履歴を管理します。
市場データ、ログイン情報、端末のprofiles・口座記録は含めません。

1. `release-config.json` の版を上げ、MQLの版表示・説明・変更履歴も更新。
2. 既存MetaEditorで `node mt5/build-release.cjs` を実行。必要なら環境変数
   `MT5_METAEDITOR` に既存のMetaEditor64.exeを指定。インストールは行いません。
3. `node mt5/release-tools.cjs`、`python mt5/verify-archive.py`、
   `node --test tests/mt5-release.test.js` と変更に関係する検査を実行。
4. 生成された新ZIP・メタデータ・アプリのリンク・導入ページとソースをcommit/push。
5. `mt5-v<版>` の新規タグを同じcommitへ付けてpush。
   GitHub ActionsがZIPとタグを照合し、ドラフトへアップロード・読戻し照合後に公開。
6. Pagesの実際のZIP bytes・SHA256、導入ページとアプリの表示を確認。

ビルドはエラー・警告0件が必要です。配布済み版のファイルは上書きしません。
以前のZIP・タグ・リリースを保持し、アプリの最新版リンクだけを更新します。
ユーザーのMT5ファイルを遠隔で差し替える機能ではありません。

現在はプレビューのみを配布する検証フローです。正式版へ変更する際は、
XM実チャートの稼働・欠落処理・形成時刻・失敗例・計算照合を確認した後、
検証段階のゲートと説明を別の変更として更新します。
