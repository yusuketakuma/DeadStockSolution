---
description: Plans.md タスク管理ルール（Plans.md 編集時のみ適用）
paths: "**/Plans.md"
_harness_template: "rules/plans-management.md.template"
_harness_version: "2.25.0"
---

# Plans.md Management Rules

## タスク記述フォーマット

```markdown
- [ ] タスク説明 `マーカー`
  - サブタスク1
  - サブタスク2
```

## マーカー運用

| マーカー | 付与者 | 意味 |
|---------|--------|------|
| `cc:TODO` | Claude Code | 未着手 |
| `cc:WIP` | Claude Code | 作業中 |
| `cc:DONE` | Claude Code | 完了 |
| `cc:blocked` | Claude Code | 依存タスク待ち |

## セクション構成

```markdown
## 進行中のタスク
（cc:WIP のタスク）

## 未着手のタスク
（cc:TODO のタスク）

## 完了タスク
（cc:DONE のタスク）

## アーカイブ
（古い完了タスク）
```

## 更新ルール

1. **即時更新**: タスク開始時に `cc:WIP`、完了時に `cc:DONE` を即座に付与
2. **サマリー記載**: 完了時は作業内容のサマリーを追記
3. **日付記録**: 完了セクションには日付を記載 `(YYYY-MM-DD)`
4. **アーカイブ**: 7日以上前の完了タスクはアーカイブへ移動

## 禁止事項

- 進行中タスクの削除
- サマリーなしでの完了マーク

---

## 拡張記法（オプション）

大規模プロジェクトでは以下の記法を**オプション**で使用可能：

```markdown
- [ ] T001: 認証機能 `cc:TODO`
- [ ] T002: ユーザーAPI `cc:TODO` depends:T001
- [ ] T003: 商品API `cc:TODO` [P]
```

| 記法 | 意味 |
|------|------|
| `T001:` | タスクID（依存指定用） |
| `depends:ID` | 依存タスク（カンマ区切り可） |
| `[P]` | 並列実行可（Parallelizable） |

**後方互換**: これらがなくても従来通り動作する。
