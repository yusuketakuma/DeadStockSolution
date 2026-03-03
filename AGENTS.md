# AGENTS.md (careviax-pharmacy)

このリポジトリで Codex を動かすときの **共通ルール**。

## ゴール
- 指示された内容を **未完成で終了しない**
- ただし **無限ループは禁止**。Definition of Done（DoD）達成で終了。

---

## Workflow Orchestration

### 1. Plan Node Default
- 3+ステップ / 設計判断が絡むなら **必ず plan mode**
- 想定外が起きたら **停止して再計画**（押し切らない）
- 検証ステップも plan に含める（作って終わり禁止）
- 仕様は先に書く（曖昧さを減らす）

### 2. Subagent Strategy
- サブエージェントを積極的に使い、メイン文脈を汚さない
- 調査・探索・並列分析を投げる
- 複雑なら計算資源を増やす（並列化）
- **1エージェント=1タスク**

### 3. Self-Improvement Loop（学習ログ）
- ユーザーから修正が入ったら `tasks/lessons.md` にパターンを追記
- 同じミスを防ぐ“自分ルール”を追加
- セッション開始時に relevant を見返す

※ここで言う Loop は「学習ログ」であり、無限にコード改善を回し続ける仕組みではない。

### 4. Verification Before Done
- “完了” は **動作証明**が出てから
- 差分の挙動確認（必要なら）
- 「スタッフエンジニアが approve するか？」で自己チェック
- テスト・ログ・証跡で正しさを示す

### 5. Demand Elegance（バランス）
- 非自明変更は「もっとエレガントにできないか？」を一回問う
- hacky に感じたら「最初からエレガント解で実装し直す」
- ただし単純修正は過剰設計しない

### 6. Autonomous Bug Fixing
- バグ報告を受けたら即修正（手取り足取り要求しない）
- ログ/失敗テスト/再現手順→原因→修正
- CI失敗も黙って直す

---

## 固定の作業順（効率最優先）
**実装を一気に完了 → 最後に検証 → 広範レビュー → 必要修正 → 最終検証 → Done**

- 実装途中にレビューを差し込むのは禁止（効率が落ちる）
- ただし異常が出たら「止めて再計画」は許可（むしろ必須）

---

## 実装モード標準: SIMPLIFYパス
全ての実装モード（implementer_heavy / implementer_light / test_writer / ci_fixer）は、
作業の最後に **SIMPLIFY（再利用・品質・効率）** を必ず実行する。

- 目的：既存再利用、品質、効率の上積み
- 禁止：大改造、不要抽象化、将来のための過設計

---

## “次に進めるなら” は必須タスク
レビューやメモが「次に進めるなら…」を出したら、それは任意ではなく残タスク。
DoD から外して終了することを禁止。

---

## DoD（Definition of Done）
以下を全て満たすまで終了禁止：
- 要件が全て実装済み（タスクリストで確認）
- 検証（typecheck/lint/test/build）が必要範囲で PASS
- 広範レビュー（品質/セキュリティ/性能/テスト）の P1 が 0
- “次に進めるなら” が空
- 変更サマリ・リスク・残課題（あれば）が `tasks/todo.md` に反映

## Task Completion Notification
- タスク完了時は以下の Push 通知を送信すること:
```bash
curl -X POST https://api.getmoshi.app/api/webhook \
  -H "Content-Type: application/json" \
  -d '{"token": "qGli1ov22jEY3PEtuI5qGXPJegjvRrFD", "title": "Done", "message": "Brief summary"}'
```
