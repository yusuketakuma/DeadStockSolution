- [x] 1) npm run test --workspace=client -- src/test/e2e/admin-upload-jobs-page.test.tsx
- [x] 2) npm run typecheck
- [x] 3) npm run lint
- [x] 4) npm run test
- [x] 5) npm run build:server
- [x] 6) npm run build:client
- [x] 7) npm run openapi:check
- [x] 8) npm run test:openapi-contract --workspace=server

## Security Spot-Check (latest uncommitted changes)
- [x] 1) 対象差分の抽出（cron auth secrets / CSV exports / cancel endpoints / keyword filtering SQL）
- [x] 2) 実装箇所レビュー（P1/P2判定）
- [x] 3) 関連経路レビュー（呼び出し元・同型ユーティリティ・隣接モジュール）
- [x] 4) 追加パターンスキャン（同型潜在箇所の候補抽出）
- [x] 5) 結果を整理して最終報告

## OpenClaw x DeadStockSolution 連携強化 (2026-02-28)
- [x] 1) `system_events` テーブルと記録サービスを追加し、runtime/system error を永続化する
- [x] 2) Vercel deploy error 受信用の内部Webhook（署名/シークレット必須）を実装する
- [x] 3) 管理者向け `GET /api/admin/system-events` を追加し、既存ログ画面で閲覧可能にする
- [x] 4) OpenClaw callback 完了時のユーザー通知作成とユーザー要望ステータス取得APIを追加する
- [x] 5) 新規登録に許可証記載情報入力を追加し、照合ロジックで登録可否を判定する
- [x] 6) 判定結果を審査テーブルへ監査保存し、NG登録を拒否する
- [x] 7) 関連テスト（server/client）を更新する
- [x] 8) typecheck/lint/対象テストで検証し、todo を完了更新する

## 全体速度改善 調査 (2026-03-01)
- [x] 1) サーバー/クライアントの主要ホットパス（matching, notifications, inventory, admin risk）を特定
- [x] 2) SQLパターン（`LIKE '%...%'`, 全件集約, in-memory sort/paginate）を抽出
- [x] 3) フロントの無駄な再フェッチ/ポーリング/大型描画箇所を抽出
- [x] 4) 影響度×実装コストで優先度を付けた改善候補を作成
- [x] 5) 実施順序（Quick Win / 中期 / 構造改善）として提案可能な形に整理

## 全体速度改善 実装 (2026-03-01)
- [x] 1) 公式ベストプラクティス調査（PostgreSQL index/lock/pagination, HTTP圧縮, queue運用）を反映方針へ落とし込む
- [x] 2) Excelアップロード処理を全体逐次化（enqueue後の即時実行無効化、cron処理1件化、並行実行ガード）
- [x] 3) マッチング再計算をデバウンス集約し、連続アップロード完了後にまとめて実行する
- [x] 4) マッチング計算のCPU負荷を削減（薬剤名前処理・使用量インデックスの再利用）
- [x] 5) 高頻度検索とログ検索向けに追加インデックスを導入（trgm + unread/ordering強化）
- [x] 6) 管理者リスク集計をTTLキャッシュ化し全件再集計頻度を抑制
- [x] 7) API応答圧縮とクライアント通知ポーリング最適化を適用
- [x] 8) 関連テストを更新し、typecheck/lint/test/buildで検証
- [x] 9) security/correctness/quality/perf/ux/ops観点レビューを実施し、必要修正を反映
- [x] 10) tasks/lessons.md に学びを追記

## 3点修正フォローアップ (2026-03-01)
- [x] 1) パフォーマンスインデックス作成を `CREATE INDEX CONCURRENTLY` ベースに切り替え、マイグレーション時の書き込みブロッキングを回避する
- [x] 2) matching refresh の常駐スケジューラを導入し、cron専用運用に依存しない構成へ変更する
- [x] 3) 関連テスト更新と `typecheck/lint/test/build` を再実行し、全体整合性を確認する

## レビュー指摘修正 (2026-03-01)
- [x] 1) タイムライン優先度判定の proposal metadata ミスマッチ（`isInbound` / `isRequester`）を解消する
- [x] 2) `timeline-priority-engine` テストを実データ形（`isRequester`）に合わせる
- [x] 3) `getTimeline` の `total/hasMore` を近似値ではなく厳密値で返す
- [x] 4) 変更影響のあるテストと `typecheck/build` を実行して検証する

## レビュー指摘修正フォローアップ (2026-03-01)
- [x] 1) `timeline-service` の timestamp ソートを ISO 文字列依存から脱却し、Date ベースで比較する
- [x] 2) 変更後に `typecheck/lint/対象テスト/build` を再実行して検証する

## 実装状況スキャンと次機能抽出 (2026-03-01)
- [x] 1) `Plans.md` / `tasks/todo.md` / Git履歴 を照合して本日の進捗を整理する
- [x] 2) クライアント/サーバー主要ファイルを走査し、計画と実装のズレを特定する
- [x] 3) ドキュメント（ロードマップ/設計）と現コードを突き合わせ、次に実装すべき候補を優先度付けする

## 全提案機能の一括実装 + 同時リファクタリング (2026-03-01)
- [x] 1) 提案詳細/管理者交換画面の進行履歴を共通 `ProposalTimeline` コンポーネントへ統合し、縦型ビジュアルタイムライン化する
- [x] 2) `SmartDigest` を次アクション提案型UIへ拡張し、未アップロード誘導・高優先イベント誘導を統合する
- [x] 3) 通知API・交換履歴APIにカーソルページネーションを追加し、既存ページング互換を維持したまま拡張する
- [x] 4) 共通UI部品 `AppActionBar` / `AppDataTable` を追加し、対象ページの重複UIロジックを削減する
- [x] 5) 変更に合わせてテストを更新し、`typecheck -> lint -> test -> build` を通す
- [x] 6) security / correctness / quality / perf / ux / ops 観点の最終セルフレビューを実施し、必要修正を反映する

## 継続実装: タイムラインカーソル化 + 同時リファクタ (2026-03-01)
- [x] 1) `GET /api/timeline` を cursor pagination 専用APIへ置き換える（page/limit 互換は削除）
- [x] 2) timeline service を cursor 専用へ整理し、並び順の決定論性（timestamp + id tie-break）を強化する
- [x] 3) client の timeline API/型/Context を cursor 対応へ更新し、「もっと見る」を次カーソルで継続取得する
- [x] 4) server/client テストを更新し、cursor モードの契約（正常系/不正cursor）を検証する
- [x] 5) `typecheck -> lint -> test -> build:server -> build:client` を実行する
- [x] 6) security / correctness / quality / perf / ux / ops のセルフレビューを行い、必要修正を反映する

## Timeline cursor-only changes: full verification (2026-03-01)
- [x] 1) npm run typecheck
- [x] 2) npm run lint
- [x] 3) npm run test
- [x] 4) npm run build:server
- [x] 5) npm run build:client

## コード実行速度改善アップデート検討 (2026-03-01)
- [x] 1) ホットパス再確認（timeline / notifications / exchange-history / dashboard初回ロード）
- [x] 2) ボトルネック候補の抽出（DBクエリ回数・in-memory merge/sort・HTTP往復数）
- [x] 3) 影響度×工数で優先度付け（Quick Win / 中期 / 構造改善）
- [x] 4) Quick Win実装A: `/api/exchange/history` cursor時の不要な `COUNT(*)` を削除
- [x] 5) Quick Win実装B: `/api/timeline/unread-count` の `last_timeline_viewed_at` 参照を外側クエリ再利用へ変更（重複サブクエリ削減）
- [x] 6) 中期実装A: timeline取得の `fetchAllEvents` 全件mergeを cursor-aware 取得へ刷新
- [x] 7) 中期実装B: dashboard向け timeline bootstrap API（events + digest + unread）でHTTP往復を削減

## Performance updates 後のフル検証 (2026-03-01)
- [x] 1) npm run typecheck
- [x] 2) npm run lint
- [x] 3) npm run test
- [x] 4) npm run build:server
- [x] 5) npm run build:client

## 未コミット差分の多角的レビュー (2026-03-01)
- [x] 1) `.claude`系を除く未コミット差分を抽出してレビュー対象を確定する
- [x] 2) 変更コードを精読し、security/correctness/quality/perf/ux/ops観点で懸念を洗い出す
- [x] 3) 変更テストの妥当性と不足ケースを確認する
- [x] 4) 重大度順に指摘を整理し、根拠（ファイル/行）付きで報告する

## レビュー指摘の全修正 (2026-03-01)
- [x] 1) 再認証 request type と OpenClaw callback 判定を整合させる
- [x] 2) `triggerReverification` の失敗握りつぶしを廃止し、呼び出し側で明示的にエラー応答する
- [x] 3) 再認証トリガー条件を「フィールド存在」ではなく「実値変更あり」に修正する
- [x] 4) migration に `verification_status` default 更新（pending_verification）を反映する
- [x] 5) 管理画面の `unverified` 表示フォールバックと設計ドキュメント整合を修正する
- [x] 6) 関連テストを更新し、typecheck/lint/test/build を再実行して検証する

## 再レビュー (2026-03-01)
- [x] 1) `.claude` 除外の未コミット差分を再抽出し、再レビュー対象を確定する
- [x] 2) 変更差分を security/correctness/quality/perf/ux/ops 観点で再点検する
- [x] 3) 追加・更新テストの妥当性を再確認し、未カバーを確認する
- [x] 4) 重大度順に再レビュー結果を報告する

## 再レビュー指摘修正 (2026-03-01)
- [x] 1) OpenClaw callback 後の認証キャッシュ無効化と stale callback ガードを実装する
- [x] 2) 再審査トリガーを非同期ハンドオフ化し、重複 request 作成を抑止する
- [x] 3) `partialSuccess` 応答に最新 `version` を含め、競合再発を防ぐ
- [x] 4) Upload UI の `applyMode` 固定ロジックを見直し、手動種別変更時の誤ロックを解消する
- [x] 5) docs 内の callback エンドポイント/マイグレーション記述の実装乖離を修正する
- [x] 6) 関連テスト更新と `typecheck -> lint -> test -> build` を再実行する

## 未使用API調査と初期リファクタ (2026-03-01)
- [x] 1) server ルート一覧と client 呼び出しを突合し、未使用API候補を抽出する
- [x] 2) 候補の実参照（client非test / scripts / docs / tests）を確認し、削除対象を確定する
- [x] 3) 未使用が確定した legacy endpoint（exchange status 単体API）を削除する
- [x] 4) 関連テストを整理し、動作保証を bulk-action 系に集約する
- [x] 5) `typecheck -> lint -> test` を実行し回帰がないことを確認する

## 未使用API追加整理とリファクタ実行 (2026-03-01)
- [x] 1) `POST /api/upload/confirm` を削除し、`confirm-async` ベースへ統一する
- [x] 2) upload 系テスト（route / inventory-flow / perf）を async job モデルへ移行する
- [x] 3) notifications の `POST/PATCH` 重複（`/read-all`, `/:id/read`）を統合する
- [x] 4) 関連テストを更新し、削除した legacy method 依存を解消する
- [x] 5) `npm run typecheck -> npm run lint -> npm run test` で再検証する

## マッチングロジック改善: 不動在庫優先 + ベストプラクティス反映 (2026-03-01)
- [x] 1) 薬局の不動在庫処理に関する一次情報（規制/公的ガイド）を調査し、設計方針を確定する
- [x] 2) マッチング候補の優先度に「相互不動在庫の解消」を最優先として反映する（近期限/滞留/相互引取量）
- [x] 3) 反映ロジックのユニットテストを追加・更新する
- [x] 4) `typecheck -> lint -> test` を実行して回帰を確認する
- [x] 5) security / correctness / quality / perf / ux / ops 観点で最終確認し、`tasks/lessons.md` に学びを追記する

## マッチングロジック更新: 経営インパクト指標と優先理由の実装 (2026-03-01)
- [x] 1) 既存優先度ロジックを崩さず、候補ごとの優先理由・経営インパクト指標の型を追加する
- [x] 2) マッチング生成時に指標（廃棄回避額/解放運転資金/相互不動在庫件数など）を計算して `MatchCandidate` に付与する
- [x] 3) snapshot 生成にも新指標を反映し、通知差分比較の整合を保つ
- [x] 4) 関連テストを追加・更新してロジックとシリアライズ結果を検証する
- [x] 5) `typecheck -> lint -> test` を実行し回帰がないことを確認する
- [x] 6) security / correctness / quality / perf / ux / ops 観点セルフレビューと `tasks/lessons.md` 追記を行う

## レビュー是正: マッチング期限判定統一と通知ハッシュ安定化 (2026-03-01)
- [x] 1) 期限切迫判定を `parseExpiryDate` ベースへ統一し、件数計算と金額計算の不整合を解消する
- [x] 2) snapshot の `candidateHash` を候補構成の安定情報のみで算出し、日次ノイズ通知を抑制する
- [x] 3) 関連テストを更新し、ハッシュ安定性と判定整合を検証する
- [x] 4) `typecheck -> lint -> test -> build:server` を実行して回帰がないことを確認する
- [x] 5) `tasks/lessons.md` に再発防止ルールを追記する

## 直近3時間実装分の多角的レビュー (2026-03-01)
- [x] 1) 直近3時間（2026-03-01 19:43 JST 以降）の対象差分を確定する（コミット + 未コミット）
- [x] 2) 変更内容を security / correctness / quality / perf / ux / ops 観点で精査する
- [x] 3) テスト更新有無と不足ケースを確認する
- [x] 4) 重大度順・根拠付き（ファイル/行）でレビュー結果を報告する

## レビュー指摘の全修正 (2026-03-01)
- [x] 1) `/api/exchange/proposals/:id/(accept|reject|complete)` の単体アクション経路を復旧する
- [x] 2) statistics の `pendingAction` 集計条件を実運用ロジック（proposed/accepted_a/accepted_b）へ整合させる
- [x] 3) APIクライアントの `isVerification403` 判定を非オブジェクトJSONでも安全にする
- [x] 4) `/api/statistics/summary` に短TTLキャッシュを導入し、再訪時の集計負荷を抑制する
- [x] 5) 削除した `/api/upload/confirm` の互換エンドポイントを復元（内部は async enqueue へ委譲）する
- [x] 6) server/client の不足テスト（statistics, api client, route meta, upload互換）を追加する
- [x] 7) `typecheck -> lint -> test` を実行して回帰がないことを確認する

## README更新: 機能と解決課題の明文化 (2026-03-01)
- [x] 1) README 冒頭に「どの問題を解決するシステムか」を追加する
- [x] 2) 主要機能を利用価値ベースで整理して追記する
- [x] 3) 導入効果（業務上の改善ポイント）を簡潔に追記する
