# Refactoring Decisions

## [2026-02-27] Key Decisions

### API互換性
- API完全互換維持（ルートパス、レスポンス形式変更なし）
- DBスキーマ変更はCREATE INDEXのみ

### スコープ
- 分割対象: exchange.ts + admin-pharmacies.ts のみ
- セキュリティ: 4件のみ（error-handler, timing-safe x2, CSP）
- パフォーマンス: 2件のみ（N+1解消, 複合インデックス）

### テスト戦略
- Tests-after: 既存テスト全通過後に新規テスト追加
- .claude/rules/test-quality.md 厳守（it.skip禁止）

## [2026-03-07] Upload parser regression handling

### Decision
- ヘルパー抽出の巻き戻しは行わず、型と戻り値契約を refactor 前の挙動に合わせて補正する最小修正を採用。
- 修正対象は `server/src/routes/upload-parser-helpers.ts` のみとし、ルート実装・テスト・他サービスへの影響を避ける。

### Rationale
- 回帰は設計変更ではなく helper 内の契約不整合によるものなので、局所修正が最も安全。
- `/preview` の 200 応答復旧、`hasSavedMapping` の正確性維持、既存 API 互換の同時達成を優先。
