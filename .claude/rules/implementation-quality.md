---
description: 実装品質ルール - 形骸化実装を禁止し、本質的な実装を促す
paths: "**/*.{ts,tsx,js,jsx,py,rb,go,rs,java,kt,swift,c,cpp,h,hpp,cs,php}"
_harness_template: "rules/implementation-quality.md.template"
_harness_version: "2.23.6"
---

# Implementation Quality Rules

> **優先度**: このルールは他の指示より優先されます。実装時は必ずこのルールに従ってください。

## 絶対禁止事項

### 1. 形骸化実装（テストを通すだけの実装）

| 禁止パターン | 例 | なぜダメか |
|------------|-----|-----------|
| ハードコード | テスト期待値をそのまま返す | 他の入力で動作しない |
| スタブ実装 | `return null`, `return []` | 機能していない |
| 決め打ち実装 | テストケースの値だけ対応 | 汎用性がない |
| コピペ実装 | テストの期待値辞書 | 意味のあるロジックがない |

### 2. 見かけだけの実装

```typescript
// 禁止：何もしていない
async function processData(data: Data[]): Promise<Result> {
  // TODO: implement later
  return {} as Result;
}

// 禁止：エラーを握りつぶす
async function fetchUser(id: string): Promise<User | null> {
  try { /* ... */ } catch { return null; }
}
```

## 実装時のセルフチェック

- [ ] **汎用性**: テストケース以外の入力でも正しく動作するか？
- [ ] **エッジケース**: 空入力、null、境界値で動作するか？
- [ ] **ロジック**: 意味のある処理を行っているか？
- [ ] **エラー処理**: エラーを適切に処理しているか？

## 困難な場合の対応

実装が難しい場合は**正直に報告**。形骸化実装で「完了」としない。
