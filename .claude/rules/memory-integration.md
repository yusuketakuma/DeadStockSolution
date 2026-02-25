---
description: Memory Integration ルール - Claude-mem との連携によるセッション跨ぎ品質強化
paths: "**"
_harness_template: "rules/memory-integration.md.template"
_harness_version: "2.25.0"
_harness_condition: "claude_mem.enabled"
---

# Memory Integration

このプロジェクトでは **Claude-mem 統合**が有効です。

セッション跨ぎの品質・文脈維持機能により、過去の学習が活用されます。

---

## 機能概要

| 機能 | 説明 |
|------|------|
| 過去の記憶検索 | `mem-search` スキルで過去の作業履歴を検索 |
| ガードレール履歴 | 過去のテスト改ざん防止記録を参照 |
| 文脈継続 | 前回セッションの状態から即座に継続 |
| パターン学習 | 過去のバグ修正・設計決定を再利用 |

---

## スキルでの活用方法

### 1. セッション開始時（session-init）
セッション開始時に過去の文脈が自動表示されます。

### 2. 実装時（impl スキル）
実装前に過去の関連パターンを自動検索。

### 3. レビュー時（harness-review スキル）
過去の類似レビュー指摘を参照。

### 4. 検証時（verify スキル）
過去のビルドエラー・解決策を参照。

---

## SSOT との連携

重要な観測は SSOT（decisions.md / patterns.md）に昇格できます：

```bash
# 重要な決定を SSOT に昇格
/memory sync
```

---

## 無効化

Claude-mem 統合を一時的に無効化する場合：
`.claude-mem.config.yaml` の `mode` を変更してください。
