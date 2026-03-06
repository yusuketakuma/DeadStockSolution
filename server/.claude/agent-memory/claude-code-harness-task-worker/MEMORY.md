# Task Worker Agent Memory

## プロジェクト固有パターン

### テストファイル配置
- サーバーサイドのテストは `server/src/test/` ディレクトリに配置
- vitest を使用。`import { describe, expect, it } from 'vitest'`
- テスト実行: `npx vitest run server/src/test/<file>.test.ts`（プロジェクトルートから）

### 型定義の場所
- タイムライン関連: `server/src/types/timeline.ts`（RawTimelineEvent, TimelinePriority, TimelineEvent など）

### ビルドコマンド
- サーバービルド: `npm run build:server`（プロジェクトルートから）
- 型チェック: `tsc -p tsconfig.build.json`

### Pure Function サービスのパターン
- DBアクセス・外部API禁止のサービスは `server/src/services/` に配置
- テスト用 `now?: Date = new Date()` パラメータパターンが有効（時刻依存ロジックのテストに使用）
- ファクトリ関数（makeEvent など）でテスト用デフォルト値を提供するパターンが有効

### TDD ワークフロー
1. テストファイルを先に作成（各優先度レベルに最低2ケース）
2. 実装を作成
3. `npx vitest run` でテスト実行確認
4. `npm run build:server` でビルド確認
