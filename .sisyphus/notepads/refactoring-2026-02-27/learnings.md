## [2026-02-27] Loop 1: useAsyncState hook
- 作成: client/src/hooks/useAsyncState.ts
- 適用: LoginPage.tsx
- 結果: 成功
- 注意点: LoginPage は email/password/mode で useState を引き続き使用するため、useState import は残す必要がある。message は LoginPage では不要なので destructure しない。

## [2026-02-27] Loop 2: useAsyncState 適用
- 適用: RegisterPage, DeadStockListPage, UploadPage
- 結果: 成功
- 注意点: 3ファイルとも他に useState が残る（form, agreed, fieldErrors, items, page 等）ため useState import は全て残す。RegisterPage は message 不要のため { loading, setLoading, error, setError } のみ destructure。DeadStockListPage と UploadPage は全6変数を destructure。

## [2026-02-27] Loop 3: useAsyncState 適用
- 適用: MatchingPage, ProposalDetailPage
- 結果: 成功
- 注意点: ProposalDetailPage では useCallback 内で setLoading/setError を使用しており、カスタムフックから取得した setter は eslint exhaustive-deps が安定性を検出できないため、依存配列に追加が必要だった。両ファイルとも他に多数の useState が残るため useState import は残す。両ファイルとも loading/error/message 全6変数を destructure。

## [2026-02-27] Loop 4: findMatches ヘルパー抽出
- 抽出: fetchViablePharmacies, fetchReservationMap
- findMatches の行数: 318行 → 251行（67行削減、ヘルパー2関数として分離）
- ファイル全体: 383行 → 396行（ヘルパー関数のシグネチャ・return文分で微増）
- 結果: 成功（typecheck / lint / test すべてパス）
- 注意点: RESERVATION_ACTIVE_STATUSES 定数とテーブルimportはファイルスコープにあるのでヘルパーからそのまま参照可能。bottom-up適用のedit toolで3操作を1回で完了。

## [2026-02-27] Loop 5: buildMatchItems 抽出
- 抽出: buildMatchItems
- findMatches の行数: 251行 → 218行（33行削減）
- ファイル全体: 396行 → 387行（9行削減）
- 結果: 成功（typecheck / lint / test すべてパス）
- 注意点: itemsFromB 側は theirDeadStock が未 prepare だったため、buildMatchItems 呼び出し前に preparedTheirDeadStock を構築する map が必要。preparedDrugNameCache への副作用（set）もこの map 内で維持。

## [2026-02-27] Loop 6: useCallback適用 + InventoryBrowsePage useAsyncState + logger置換
- 適用: DeadStockListPage(useCallback), InventoryBrowsePage(useAsyncState + useCallback)
- 置換: drug-master-parser-service.ts の console.warn → logger.warn
- 結果: 成功（lint 0警告 / typecheck OK / client 111 passed / server 367 passed）
- 注意点: DeadStockListPage の fetchData の useCallback deps は [setLoading, setError]（useState setter は安定なので実質 []）、useEffect deps に fetchData を追加。InventoryBrowsePage は message state が元々なかったため useAsyncState の message は使わない（destructure しない）。logger.warn の第2引数は { error: ... } オブジェクト形式が他サービスの実例と一致。
