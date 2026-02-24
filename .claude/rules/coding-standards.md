---
description: コーディング規約（コードファイル編集時のみ適用）
paths: "**/*.{ts,tsx,js,jsx}"
_harness_template: "rules/coding-standards.md.template"
_harness_version: "2.23.6"
---

# Coding Standards

## コミットメッセージ規約

| Prefix | 用途 | 例 |
|--------|------|-----|
| `feat:` | 新機能 | `feat: 医薬品マスター検索を追加` |
| `fix:` | バグ修正 | `fix: ログインエラーを修正` |
| `docs:` | ドキュメント | `docs: README を更新` |
| `refactor:` | リファクタリング | `refactor: 認証ロジックを整理` |
| `test:` | テスト | `test: 認証テストを追加` |
| `chore:` | その他 | `chore: 依存関係を更新` |

## コードスタイル

- 既存のコードスタイルに従う
- 変更に必要な最小限の修正のみ
- TypeScript strict モードを維持
- React コンポーネントは関数コンポーネント + hooks
- API クライアントは `client/src/api/client.ts` に集約
- DB スキーマは `server/src/db/schema.ts` に集約

## エラーハンドリング

- 境界（ユーザー入力、外部API）でのみバリデーション
- サーバー側は zod でリクエストバリデーション
- 内部コードは信頼する
