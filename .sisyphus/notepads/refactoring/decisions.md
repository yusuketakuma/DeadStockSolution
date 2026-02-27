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
