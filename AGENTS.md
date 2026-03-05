# careviax-pharmacy: Codex Operating Contract

このリポジトリで Codex を使うときの「作業規約」です。
最優先は **未完了で終了しない** こと。次に **一気に実装→最後に検証→広範レビュー** で効率を最大化すること。

---

## 0. Completion Contract（途中打ち切り禁止）

- **ユーザーの指示が完了するまで終了しない。**
  - 途中で「次に進めるなら…」の提案で止めない。**提案ではなく、実行して完了させる。**
- **“確認待ち”を作らない。**
  - 「計画を確認してください」「次に進めますか？」のような中断は禁止。
  - 例外は、外部資格情報・秘密情報・決裁が必要で、代替が存在しない場合のみ。
- **Doneの定義**
  - 実装が完了している
  - 最終の検証（typecheck / lint / tests / 主要動作確認）が通っている
  - 広範レビュー（複数観点）が終わり、重大指摘が解消されている
  - 成果物（変更内容・検証結果）がドキュメントに残っている

---

## 1. Workflow Standard（必ずこの順番）

### フェーズA: Plan（非自明タスクのみ）
- 3ステップ以上 or 設計判断が必要なら plan を作る
- plan は `tasks/todo.md` に **チェックボックス付き**で書く
- plan を書いたら **確認待ちせず** そのままフェーズBへ進む

### フェーズB: Implementation（“一気に”完了させる）
- 実装中にレビューを挟まない（効率低下の元）
- ただし「自分で気付いた明白な欠陥」はその場で直す
- 変更は必要最小限（不要な整形・大規模改名は禁止）

### フェーズC: Verification（最後にまとめて）
- ここで初めて一気に検証を走らせる
  - typecheck
  - lint
  - tests（該当範囲）
  - 主要フロー確認
- 失敗したら、原因修正→再検証（このフェーズ内で完了まで粘る）

### フェーズD: Broad Review（複数観点・広範）
- 実装箇所 + **関連項目まで広く**レビューする
- 観点は最低でも:
  - Correctness（仕様通りか、境界ケース）
  - Security（権限・入力・秘密情報・注入）
  - Performance（N+1、無駄な再レンダ、クエリ）
  - Maintainability（読みやすさ、変更容易性）
  - UX/Accessibility（アラート、フォーカス、CSV式注入等）
- 指摘が出たら **修正→再検証→必要なら再レビュー** を完了まで繰り返す
- 重大指摘がない状態で Done

---

## 2. Multi-agent Strategy（積極利用・ただし統制）

### 2.1 基本
- サブエージェントを惜しまない（並列化して主スレの負担を減らす）
- 1エージェント1タスク（混ぜない）
- 最大同時スレッドは config の `agents.max_threads` に従う
- ネストは最大2（孫エージェントまで）

### 2.2 役割（agent_type）
- `planner`：コードベース理解→目標・作業分解→委譲設計
- `explorer`：読み取り・調査・根拠集め（原則 read-only）
- `worker`：軽め/中規模実装（デフォルト：spark）
- `worker_heavy`：重い実装・設計含む（codex xhigh）
- `*_fallback`：spark が使えない/失敗した時の代替（codex medium）
- `review_*`：観点別レビュー（read-only）
- `monitor`：長時間コマンド/待機/ポーリング監視

### 2.3 spark フォールバック（重要）
codex-spark は環境/プランで使えないことがある。自動フォールバックが保証されないため、**運用として**以下を必ずやる。

- 最初の非自明タスク開始時に「spark疎通」を一度だけ実施
  - `explorer`（spark）を軽い調査で spawn
  - 失敗したら以後そのセッションでは `explorer_fallback` / `worker_fallback` を使う
- spawn が失敗したら「同じ指示を fallback ロールで再実行」する（確認待ちしない）

---

## 3. Delegation Rubric（委譲ブレ防止・数値固定）

`loc_delta_est` は **数値で固定**する。

- `loc_delta_est <= 250`
  - ファイル変更数 <= 6
  - テスト追加なし
  - 実行時間見込み <= 180秒
  → `worker`（spark）へ

- `250 < loc_delta_est <= 800`
  - 変更数 <= 15 またはテスト追加あり
  → `worker`（spark）を基本、詰まる/設計が要るなら `worker_heavy`

- `loc_delta_est > 800`
  - 横断変更・設計判断が多い
  → `worker_heavy`

追加ルール:
- セキュリティ/権限/認証/秘密情報/SQL文字列生成が絡む場合は最初から `worker_heavy`
- 「調査が先」の場合は `explorer` を先に走らせて根拠を固める

---

## 4. /simplify 相当（実装モード標準）

全実装ロール（worker系）は必ず以下を守る:

- 実装完了後に **Simplify パス** を1回入れる（Claudecodeの /simplify 相当）
  - 重複削除
  - 分岐の単純化
  - 命名の一貫性（大改名は禁止、局所のみ）
  - 型の明確化（any/unknownの雑処理を放置しない）
  - “安全性を落とす近道”は禁止（例: fail-open）

---

## 5. Self-Improvement（ユーザー訂正の再発防止）
- ユーザーから修正が入ったら、必ず `tasks/lessons.md` に:
  - 何が起きたか
  - なぜ起きたか（再発条件）
  - 次回の防止ルール
  を追記する

---

## 6. インターネット検索の扱い
- 不確かな仕様/API/バージョン差は **web search で一次情報に当たる**
- 推測で進めない
- ただし実装中は検索しすぎて手が止まらないよう、調査は `explorer` に投げる

---

## 7. 完了通知（Moshi webhook）
タスクの **全フェーズ完了後（Done定義を満たした後）** に、以下を 1 回だけ実行する。

```bash
curl -X POST \
  https://api.getmoshi.app/api/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "token": "qGli1ov22jEY3PEtuI5qGXPJegjvRrFD",
    "title": "Task Complete",
    "message": "Your task finished!"
  }'
```

※この token をリポジトリに固定で置くのは漏洩リスクが高い。運用では環境変数化・ローテーションを推奨。

---
