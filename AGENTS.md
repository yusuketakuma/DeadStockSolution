# Codex Operating Agreement (Repo)

## 最優先ルール
- **指示された内容を未完成で終了することを禁止**（Done条件を満たすまで"完了"と言わない）
- 途中で状況が悪化したら **即停止→再計画（re-plan）**。惰性で押し切らない
- **実装→一括検証→最後にレビュー**（レビューが毎回割り込んで効率を落とすのを禁止）

---

## Workflow Orchestration

### 1. Plan Node Default
- 3ステップ以上/設計判断がある作業は必ず plan
- 仕様が曖昧なら先に「詳細仕様」を書き、曖昧さを消してから着手
- 検証手順も plan に含める（作って終わり禁止）

### 2. Subagent Strategy（マルチエージェント）
- サブエージェントを積極利用して並列化（調査/探索/分割実装/レビュー）
- **サブエージェントは1タスク1スレッド**で焦点を絞る
- 親（メイン）は指示・統合・最終品質責任に集中

> 注：マルチエージェント機能は `spawn_agent / send_input / resume_agent / wait / close_agent` が有効化される前提。 [oai_citation:7‡OpenAI Developers](https://developers.openai.com/codex/config-reference/)
> またサブエージェントは承認が非対話になる前提で、承認が必要な操作は失敗し得るため、**承認を要しそうな操作はメインが担当**する（または最初から許可済みの範囲で実行する）。 [oai_citation:8‡OpenAI Developers](https://developers.openai.com/codex/multi-agent/)

### 3. Self-Improvement（再発防止）
- ユーザーから修正指摘が入ったら `tasks/lessons.md` にパターンを追記
- 同じ事故を繰り返さないためのルール化を行う

### 4. Verification Before Done
- Doneと言う前に必ず動作証明（コマンド/ログ/差分根拠）
- "スタッフエンジニアが承認できるか？"を自問する

### 5. Demand Elegance（バランス）
- 非自明な変更は「よりエレガントにできないか？」を一度検討
- ただし単純修正は過剰設計しない

### 6. Autonomous Bug Fixing
- バグ報告は"直す"が先。手取り足取りを要求しない
- 失敗ログ/落ちたテスト→原因→修正→再実行まで自走

---

## タスク遂行の順序（固定）

### Phase A: 目標設定（Goal Setter）
1) コードベース理解（必要に応じてWeb検索も使う）  
2) 目標を自動設定し、`tasks/todo.md` にチェックリスト化  
3) 実装の分割と担当（下の委譲ルールに従う）

### Phase B: 実装（Implementation Sprint）
- **レビューは禁止**（このPhaseでは /review を呼ばない）
- 指示された項目を"全部"実装し切る
- 進捗は `tasks/todo.md` のチェックで可視化

### Phase C: 一括検証（Verification）
- typecheck → lint → tests（必要なら build）を**まとめて**実施
- 失敗したら修正して再実行（合格するまで続行）

### Phase D: 広域レビュー & 自動修正（Review + Fix）
- 実装箇所だけでなく **関連箇所まで広く**レビュー（依存元/依存先/境界/設定/CI）
- 観点は最低：正確性/セキュリティ/性能/保守性/UX(DX)/テスト/運用
- 指摘をもとに自動修正 → Phase C に戻って再検証 → もう一度レビュー
- P1/P2 が残る限り Done にしない

---

## 委譲ルール（ブレ防止の形式化）

### 入力メタ（各タスクで見積もる）
- `files_changed_est`: 変更ファイル数見込み
- `loc_delta_est`: 追加/変更行数見込み（数値固定）
  - small: **<= 250**
  - medium: **<= 800**
  - large: **> 800**
- `tests_added`: テスト追加の要否（true/false）
- `runtime_est_min`: コマンド実行時間見込み（分）

### 役割割当
- **explorer（探索）**へ委譲：
  - 公式仕様/エラー原因調査/影響範囲探索
  - `files_changed_est = 0` が基本（変更しない）
- **worker_light（軽実装）**へ委譲：
  - `files_changed_est <= 4` かつ `loc_delta_est <= 250`
  - `tests_added = false` または軽微
  - `runtime_est_min <= 5`
- **worker_heavy（重実装）**へ委譲：
  - `loc_delta_est > 250` または `files_changed_est > 4`
  - `tests_added = true` または横断変更
  - `runtime_est_min > 5`
- **メイン（指示役）**が担当：
  - 方針決定/統合/最終レビューゲート
  - 承認が絡みそうな操作、危険度が高い変更

---

## Done条件（強制）
- `tasks/todo.md` のチェックが全て完了
- 検証（typecheck/lint/tests）が合格
- 広域レビューで P1/P2 がゼロ
- 変更理由・影響範囲・戻し方が説明できる
