# Codex Operating Contract (Repo)

このリポジトリのCodex運用は「未完成で終了しない」を最優先とする。
外部の自動ループ（再実行ドライバ）は使わない。1回の実行内で完了ゲートまで到達する。

---

## 0) 退出条件（END_STATE）
最終的な終了状態は必ず次のどちらかだけ。

- END_STATE=DONE
  - 受入条件を満たし、検証ゲートとレビューゲートが“証拠付き”で通過している
- END_STATE=BLOCKED
  - 外部要因で完遂不能（認証/権限/秘密情報/環境差/ネットワーク制限など）
  - 何が足りないかを「最小の要求」で列挙し、これ以上進めないことを明示

禁止：
- “次にやること”だけ書いて終わる
- 一部だけ終えた状態で DONE を宣言する
- 検証せずに完了扱いにする

---

## 1) Workflow Orchestration

### 1. Plan Node Default（既定）
- 非自明タスク（3+ステップ or 設計判断あり）は必ず plan から入る。
  - 対話CLIなら /plan を使う
  - 非対話実行でも tasks/todo.md に「詳細仕様+手順+検証」を必ず書いてから実装する
- 想定外（失敗連鎖/影響範囲爆発/仕様矛盾/セキュリティ懸念）が出たら、
  その場で停止して re-plan。押し切らない。
- plan は「作る前」だけでなく「検証（type/lint/test）手順」にも適用する。
- 仕様は詳細に。曖昧さを残さない。

### 2. Subagent Strategy
- サブエージェントを積極利用して、メイン文脈を汚さない。
- 調査/探索/並列分析/インターネット検索は基本サブエージェントへ。
- 1サブエージェント=1タスク（責務を絞る）。

### 3. Self-Improvement（学習サイクル）
- ユーザーからの訂正/指摘が入ったら必ず tasks/lessons.md に追記する。
- 再発防止ルールを明文化し、以後“強制ルール”として適用する。
- セッション開始時に lessons を読み、今回関連するルールを先に有効化する。

### 4. Verification Before Done
- 動く証拠なしに完了扱いにしない。
- 変更前後の差分が重要なら再現手順と挙動差を示す。
- 自問：「Staff engineer が承認するか？」
- テスト/ログ/型/lint/実行結果で正しさを証明する。

### 5. Demand Elegance（Balanced）
- 非自明な変更は「よりエレガントな道」を必ず検討する。
- hacky なら最適解に置換する。
- ただし単純な修正は過剰設計しない。

### 6. Autonomous Bug Fixing
- バグ報告が来たら質問で止めずに修正を完遂する。
- ログ/エラー/失敗テストを根拠に特定して解消する。

---

## 2) Task Management（単一ソース）
- tasks/todo.md : 計画・実装・検証・レビュー結果の集約（チェックボックス）
- tasks/lessons.md : 失敗パターンと防止ルール（追記型）

必須：
1) Plan First: tasks/todo.md にチェック可能な計画を書く
2) Verify Plan: 実装前に計画を自己点検（曖昧さ/手戻り要因潰し）
3) Track Progress: 進捗はチェックで可視化
4) Explain Changes: 段階ごとに要約
5) Document Results: Review/Verification の結果を tasks/todo.md に残す
6) Capture Lessons: 訂正が入ったら lessons へ必ず追記

---

## 3) フェーズ順（レビュー割り込み禁止は継続）
レビューが実装中に割り込むと効率が落ちるため、順番を固定する。

Phase 0: Preflight
- lessons を読む
- todo を作る（なければ）

Phase 1: Plan/Spec（plan）
- 詳細仕様と検証計画を tasks/todo.md に書く

Phase 2: Implementation Sprint（レビュー禁止）
- todo の実装項目を“全部”終える
- このフェーズでは review_lens を起動しない

Phase 3: Verification Gate（型→lint→test）
- typecheck → lint → tests の順に通す（失敗は最小修正で潰して再実行）

Phase 4: Review Gate（多観点レビュー→指摘修正→再検証）
- review_lens で「実装箇所 + 関連箇所」まで広くレビュー
- 指摘を severity 順に修正
- 再検証（Phase 3）を通してから再レビュー
- P1 が 0 になるまで Phase 4 を繰り返す（ただし外部要因で進行不能なら BLOCKED）

---

## 4) DONE の定義（証拠付き）
- tasks/todo.md の実装チェックが全て完了
- 検証結果（typecheck/lint/tests）が tasks/todo.md に記録され、全て成功
- review_lens の最終結果で P1=0
- 以上を満たしたときだけ END_STATE=DONE を宣言する
