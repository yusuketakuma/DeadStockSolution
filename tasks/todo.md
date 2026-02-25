# tasks/todo.md
> 計画・進捗・検証・レビュー結果の単一ソース

## Phase 0: Preflight
- [x] Read tasks/lessons.md and apply relevant prevention rules
- [x] Confirm this is non-trivial and proceed with structured implementation

## Phase 1: Plan / Spec
### Goal
- 在庫更新順序に依存せずマッチング候補を更新し、通知し、提案時競合を抑止する。

### Scope
- マッチング自動再計算（upload confirm後）
- マッチング詳細通知（snapshot差分）
- 提案時仮確保テーブル導入と数量整合
- 予約を考慮した matching 算出

### Acceptance Criteria
- AC1: 他薬局更新時も候補更新が通知される
- AC2: 同一在庫の重複提案競合を提案時に防止
- AC3: typecheck/test/build 成功、review P1=0

## Phase 2: Implementation Sprint
- [x] Add DB schema + migration for reservations/snapshots/notifications
- [x] Implement reservation-aware proposal flow
- [x] Implement reservation-aware matching calculation
- [x] Implement matching refresh + snapshot diff notification service
- [x] Hook upload confirm to async matching refresh
- [x] Extend notifications API and client types/handlers
- [x] Add/adjust tests for new behavior

## Phase 3: Verification Gate
- [x] typecheck passes
- [x] tests pass
- [x] build passes

## Phase 4: Review Gate
- [x] review_lens ran
- [x] P1 fixed if any
- [x] re-verify passes
- [x] re-review confirms P1=0

## Exit
END_STATE=DONE

## Review Results
- 2026-02-25 Cron endpoint + Vercel cron re-review (read-only): `P0=0`, `P1=1`
- Remaining P1: cron retry endpoint authentication is fail-open when secret is unset and secret wiring is not aligned with Vercel cron auth convention.
- 2026-02-25 Final current-state review after cron auth fix (read-only): `P0=0`, `P1=0`
- 2026-02-26 remediation diff re-review (`2026-02-26 00:15`以降・指定コンポーネント限定, read-only): `P0=0`, `P1=1`, `P2=2`（残P1: external fetch の DNS rebinding TOCTOU）
- 2026-02-26 final re-review after remediation (sprint changed files, read-only): `P0=0`, `P1=0`, `P2=3`（残: DNS pinned fetch failover + refresh queue/cron auth test gap + DNS pinning dispatcher test gap）
- 2026-02-26 final verification review after additional reliability/test improvements (sprint changed files, read-only): `P0=0`, `P1=0`, `P2=3`（残: DNS pinning dispatcher直テスト不足 + refresh retry/stale reclaim テスト拡充余地 + upload confirm/refresh enqueue の可用性トレードオフ）

## Verification Results
- `npm run typecheck --workspace=server` ✅
- `npm run test --workspace=server` ✅ (239 passed, 1 skipped)
- `npm run build --workspace=server` ✅
- `npm run typecheck --workspace=client` ✅
- `npm run test --workspace=client` ✅ (70 passed)
- `npm run build --workspace=client` ✅
- `npm run typecheck --workspace=server` ✅ (review remediation)
- `npm run test --workspace=server` ✅ (239 passed, 1 skipped / review remediation)
- `npm run typecheck --workspace=client` ✅ (review remediation)
- `npm run test --workspace=client` ✅ (70 passed / review remediation)
- `npm run build --workspace=server` ✅ (review remediation)
- `npm run build --workspace=client` ✅ (review remediation)

## Review Results (Remediation)
- 2026-02-25 remediation re-review: `P1=0`

---

## Frontend Alignment Sprint (2026-02-25)
### Goal
- バックエンドで追加した通知・予約考慮・再計算フローをフロントで最大活用する。

### Scope
- ダッシュボード通知パネルの上部配置と操作性向上
- 通知既読処理のUI即時反映
- マッチング提案失敗時の再実行導線
- アップロード後の導線文言最適化

### Checklist
- [x] Dashboard notifications state handling を整理
- [x] Notification panel に更新導線を追加
- [x] MatchingPage に再マッチング導線を追加
- [x] UploadPage の完了文言・導線を調整
- [x] client typecheck/test を再実行

---

## Review Remediation Sprint (2026-02-25 18:00+ code review fixes)
### Goal
- 多角的レビューで抽出した P1/P2 を解消し、ジョブ処理の整合性と運用安全性を高める。

### Checklist
- [x] matching refresh job の排他claimを実装
- [x] 失敗ジョブのバックオフ/後続処理継続を実装
- [x] match notification の重複防止キーを導入
- [x] cron retry endpoint を fail-close 認可に修正
- [x] migration/schema を追従
- [x] server/client 検証を再実行

---

## Operations Sprint (2026-02-25)
### Goal
- 運用必須タスクとして DB `0012` 適用状態を確認し、production の cron 認証シークレットを設定する。

### Checklist
- [x] Server DB で `0012` 由来オブジェクト存在を確認
- [x] Vercel CLI 認証を完了（`vercel whoami`）
- [x] Vercel project link を復旧（`dead-stock-solution`）
- [x] production に `CRON_SECRET` を設定

### Verification Results
- DB確認:
  - `dead_stock_reservations` / `match_candidate_snapshots` / `match_notifications` / `matching_refresh_jobs` が存在
  - `match_notifications.dedupe_key` 列と `idx_match_notifications_dedupe` index が存在
- Vercel確認:
  - `npx vercel whoami` => `takumayusuke-9336`
  - `npx vercel env ls production | rg CRON_SECRET` で `CRON_SECRET` を確認

### Notes
- `drizzle.__drizzle_migrations` は履歴が `id=1..5` のみだが、`0011/0012` の実体は DB に反映済み。

---

## Re-Review Sprint (2026-02-26 00:xx, target: 2026-02-25 18:00+ code)
### Goal
- 18:00以降の実装コードを再スキャンし、セキュリティ/可読性/性能/安定性/外部取込/通知導線を多角レビューする。

### Scope
- `git` 範囲: `dc54f02fadd579784a778398f13e80dfa1737e89..HEAD`
- 追加対象: working tree の `server/`, `client/`, `vercel.json`

### Verification Results
- `npm run typecheck --workspace=server` ✅
- `npm run typecheck --workspace=client` ✅
- `npm run test --workspace=server` ✅ (239 passed, 1 skipped)
- `npm run test --workspace=client` ✅ (70 passed)
- `npm run build --workspace=server` ✅
- `npm run build --workspace=client` ✅

### Review Results
- 結果: `P0=0, P1=3, P2=4`
- 主な P1:
  - `completeProposal` の同時実行で二重減算が起きうる
  - `upload/confirm` で DB反映後に refresh enqueue 失敗すると 500 応答になる
  - Dashboard の `Promise.all` 結合で片系障害時に全体更新が落ちる

---

## Fix Sprint (2026-02-26, all review findings remediation)
### Phase 0: Preflight
- [x] Read tasks/lessons.md
- [x] Select implementation + verification skills/workflow

### Phase 1: Research / Plan
- [x] Collect web best practices before coding (concurrency, HTTP semantics, SSRF, frontend resilience, a11y)
- [x] Map each finding to concrete code/test changes

### Phase 2: Implementation
- [x] Fix `completeProposal` concurrency/idempotency (single-claim transition)
- [x] Fix upload confirm contract when refresh enqueue fails (avoid false 500 after committed DB write)
- [x] Fix refresh job claim-loop contention handling
- [x] Remove/decouple matching refresh side effect from `GET /notifications`
- [x] Harden external URL validation against DNS rebinding TOCTOU
- [x] Make dashboard fetch resilient to partial API failure
- [x] Fix dashboard empty-state rendering on error
- [x] Fix match-update next-action label/path inconsistency
- [x] Improve business hours form accessibility labels
- [x] Add/adjust tests for all above behavior changes

### Phase 3: Verification Gate
- [x] `npm run typecheck --workspace=server`
- [x] `npm run typecheck --workspace=client`
- [x] `npm run test --workspace=server`
- [x] `npm run test --workspace=client`
- [x] `npm run build --workspace=server`
- [x] `npm run build --workspace=client`

### Phase 4: Review Gate
- [x] Run multi-angle re-review (review_lens)
- [x] Fix any newly found P1
- [x] Re-run verification if fixes are applied
- [x] Confirm final `P1=0`

### Verification Results (Fix Sprint)
- `npm run typecheck --workspace=server` ✅
- `npm run typecheck --workspace=client` ✅
- `npm run test --workspace=server` ✅ (246 passed, 1 skipped)
- `npm run test --workspace=client` ✅ (75 passed)
- `npm run build --workspace=server` ✅
- `npm run build --workspace=client` ✅

### Review Results (Fix Sprint)
- 2026-02-26 remediation diff re-review: `P0=0`, `P1=1`（DNS rebinding TOCTOU 残）
- 2026-02-26 final re-review after DNS pinned fetch remediation: `P0=0`, `P1=0`, `P2=3`
