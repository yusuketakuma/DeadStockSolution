# careviax-pharmacy -- Codex Working Agreement (AGENTS.md)

このリポジトリでは、Codex を「速く・確実に・最後まで」動かすために、以下の規約に従う。
重要: 指示された内容を未完成で終えることは禁止。Done宣言は"検証とレビューが完了している"場合のみ。

---

## Workflow Orchestration

### 1. Plan Node Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests - then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

---

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation（ユーザー確認が必要ならここ。不要ならセルフレビューで可）
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

---

## Core Principles
- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

---

## このリポジトリの最重要「順番」ルール
**実装を一気に完了 → 最後に検証 → 広範レビュー（複数観点） → 必要なら修正して再検証 → 完了**

- 実装フェーズ中に「レビュー起点の割り込み」を入れない（効率を落とすため）。
- ただし、明らかなブロッカー（型崩壊・テスト崩壊・ビルド不能）が出た場合は、実装者が即座に最低限の修復をして続行してよい。

---

## Delegation Rubric（委譲のブレを減らすための形式化）
見積り値は「正確さ」より「一貫性」。迷ったら保守側（大きめ）に倒す。

### メトリクス
- `loc_delta_est`（数値固定）
  - small: `<= 250`
  - medium: `<= 800`
  - large: `> 800`
- `files_changed_est`
  - small: `<= 3`
  - medium: `<= 10`
  - large: `> 10`
- `tests_added`（true/false）
- `runtime_est_min`（検証の実行時間見込み）
  - short: `<= 3`
  - mid: `<= 10`
  - long: `> 10`

### 役割割り当て（Codex CLI roles）
- `explorer`:
  - 調査・影響範囲特定・設計案比較・委譲設計（実装は原則しない）
- `worker_light`（原則 spark）:
  - small〜mediumの小粒実装（<=250が主戦場）
- `worker_heavy`（codex 5.3）:
  - large実装、横断改修、複数パッケージ、設計変更
- `test_engineer`（原則 spark）:
  - テスト追加・検証設計・再現ケース・CI起因の修正
- `reviewer_*`:
  - 実装後の広範レビュー（複数観点）＋自動修正（必要時）＋再検証

### codex-spark フォールバック規約（重要）
- spark系 role の起動が失敗・権限不足・モデルダウングレードが疑われる場合：
  - そのタスクは **即座に `*_fallback`（gpt-5.3-codex + medium）で再実行**。
- 目的は「止まらないこと」「速度の再現性」。

---

## /simplify モード標準（全実装ロール共通で必須）
実装が動いた後、必ず "/simplify パス" を通す。

- 重複を消す（同型/同条件/同UI処理の二重化）
- 条件分岐を減らす（早期return、ガード節、関数抽出）
- 型を強める（any排除、境界でvalidate、戻り値の整合）
- 副作用を局所化（state更新、IO、時間依存の分離）
- 見通し優先（名前・責務・ファイル配置を再調整）
- 「動くけど汚い」を残さない（ただし過剰リファクタはしない）

---

## Web Search の使い方（積極利用）
- "仕様・挙動・互換性" が怪しい時は即 web 検索で一次情報を取りに行く
- ただし、リポジトリ固有の真実はコードを優先（README/ADR/実装が正）

---

## 完了条件（Done）
- 実装タスクが全て完了
- 検証（最低限の typecheck / lint / test）が通過
- reviewer（複数観点）で P1/P2 がゼロ、または全て修正済み
- `tasks/todo.md` に実行コマンドと結果が記録済み
