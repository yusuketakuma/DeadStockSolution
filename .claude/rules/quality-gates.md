# 品質判定ゲート

> このルールは Claude harness によって自動生成されました。
> 目的: タスク種別・ファイルパスから適切な品質基準を自動提案します。

## 品質判定マトリクス

| 判定タイプ | 発動条件 | 対象スキル | 提案内容 |
|-----------|---------|-----------|---------|
| **TDD** | [feature] + ビジネスロジック | impl, verify | テスト先行を提案 |
| **セキュリティ** | auth/, api/, payment/ | impl, harness-review, auth | チェックリスト表示 |
| **カバレッジ** | テストなし/不足検出 | harness-review | テスト追加を指摘 |
| **a11y** | UI コンポーネント | ui, harness-review | アクセシビリティチェック |
| **パフォーマンス** | DB クエリ, ループ | impl, harness-review | 最適化警告 |

## 判定基準詳細

### TDD 判定

| 条件 | TDD 推奨度 |
|------|-----------|
| [feature] + src/core/ | 強く推奨 |
| [feature] + src/services/ | 強く推奨 |
| [feature] + src/api/ | 推奨 |
| [bugfix] | 再現テスト推奨 |
| [config], [docs] | 不要 |

### セキュリティ判定

| パス | 注意レベル |
|------|-----------|
| auth/, login/, session/ | 高 |
| api/, routes/, middleware/ | 中 |
| payment/, billing/, stripe/ | 高 |
| config/, .env | 中 |

### パフォーマンス判定

| パターン | 警告内容 |
|---------|---------|
| `SELECT * FROM` + ループ内 | N+1 クエリの可能性 |
| 大きな配列の `.map().filter()` | 複数回走査 |
| `useEffect` 内の重い処理 | レンダリング遅延 |

## 注意事項

- **提案であり強制ではない**: ユーザーが最終判断
- **false positive を許容**: 安全側に倒す
- **複数判定の同時表示**: 該当する全ての判定を表示
