# AGENTS.md

このリポジトリでCodexを動かす際の作業規律・手順。

## 絶対原則
- 指示された内容を未完成のまま終了しない（DONEを名乗るな）。
- ただし「秘密情報が必要」「権限が足りない」などで進められない場合は、質問で止めずに **BLOCKED** として条件を列挙する。
- 非対話（approval_policy=never）前提：`request_user_input` は原則使わない。

## 実行順序（効率最優先）
1. **Plan（設計・TODO化）**：tasks/todo.md にチェックリスト化
2. **実装を一気に完了**：途中でレビューを挟まない（効率悪化の原因）
3. **最後にまとめて検証**：typecheck → lint → tests → build（必要なら）
4. **最後にまとめて多観点レビュー**：security / correctness / quality / perf / ux / ops
5. **指摘を反映（fix）→ 再検証**：P1が0になるまで。P2は許容するなら理由を明記
6. **DONE判定**：DoDを満たし、tasks/todo.md の全項目が完了している

## Workflow Orchestration

### 1. Plan Node Default
- 非自明タスク（3+ステップ / 設計判断あり）は必ずPlanから入る
- 何かが崩れたら即停止して再Plan（惰性で押し切らない）
- 検証手順もPlanに含める
- 仕様を先に書いて曖昧さを消す

### 2. Subagent Strategy（multi-agent）
- 迷ったらサブエージェントに投げてメイン文脈を汚さない
- 調査・探索・並列分析はサブエージェントへ
- 1エージェント=1タスク（混ぜない）
- 並列で投げるが、同一ファイル競合は避ける

#### 委譲の数値基準（固定）
- worker_light:
  - 変更LOC見込み <=250
  - 変更ファイル数見込み <=4
  - テスト追加不要 or unit少量
  - セキュリティ/認可/データ破壊リスクなし
- worker_heavy:
  - 上記以外（<=800や>800、テスト必須、認可/SQL/秘密情報など）

### 3. Self-Improvement
- ユーザーから修正が入ったら tasks/lessons.md にパターンを追記
- 同じミスを防ぐ自分ルールを明文化

### 4. Verification Before Done
- 動作証明なしに完了扱いにしない
- 変更の前後差分がある場合は、差分で説明できるようにする
- 最低でも typecheck/lint/test を通す

### 5. Demand Elegance（Balanced）
- 非自明変更は「より単純で堅牢な方法がないか」一度考える
- ただし些末な箇所に過剰最適化しない

### 6. Autonomous Bug Fixing
- バグ報告を受けたら、手順を聞き返さず直す
- ログ/エラー/失敗テストから根因へ直行する

## Task Management（ファイル運用）
- Planは tasks/todo.md に書く（チェック可能に）
- 進捗はチェックを潰す
- 結果と検証ログを残す
- 学びは tasks/lessons.md へ

## Core Principles
- Simplicity First（必要最小限の変更）
- No Laziness（根因を潰す）
- Minimal Impact（不要な波及を作らない）
