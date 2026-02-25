---
description: Solo ワークフロールール
alwaysApply: true
_harness_template: "rules/workflow.md.template"
_harness_version: "2.23.6"
---

# Solo Workflow Rules

このプロジェクトは **Solo モード**（Claude Code 単体）で運用しています。

## タスク管理

- タスクは `Plans.md` で一元管理
- マーカーでステータスを追跡:
  - `cc:TODO` → 実行予定
  - `cc:WIP` → 作業中
  - `cc:DONE` → 完了
  - `cc:blocked` → 依存タスク待ち

## Sub-agent Role Compatibility

- `spawn_agent` で利用する role は次を優先:
  - `implementer`
  - `claude_implementer`
  - `claude_reviewer`
- 実測で利用不可（`agent type is currently not available`）:
  - `default`
  - `explorer`
  - `worker`
  - `verifier`
- 失敗時のフォールバック順:
  1. `implementer`
  2. `claude_implementer`
  3. `claude_reviewer`

## プロジェクト構造

| パス | 内容 |
|------|------|
| `client/src/pages/` | ページコンポーネント |
| `client/src/components/` | 再利用可能コンポーネント |
| `client/src/api/client.ts` | API クライアント |
| `server/src/routes/` | Express ルートハンドラ |
| `server/src/services/` | ビジネスロジック |
| `server/src/db/schema.ts` | Drizzle ORM スキーマ（全テーブル集約） |
| `server/src/middleware/` | Express ミドルウェア |

## コマンド

| 用途 | コマンド |
|------|---------|
| テスト | `npm test` |
| 型チェック | `npm run typecheck` |
| サーバービルド | `npm run build:server` |
| クライアントビルド | `npm run build:client` |
| マイグレーション生成 | `cd server && npx drizzle-kit generate` |

## 禁止事項

- 開発用ファイルの外部公開（CLAUDE.md, AGENTS.md, Plans.md）
- 明示的な依頼なしの大規模リファクタリング
- テストなしの機能追加
- 本番環境への直接デプロイ（ユーザー承認必須）
