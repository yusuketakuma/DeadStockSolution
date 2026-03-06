# Multi-agent Playbook（確定版）

## 前提
- multi_agent は有効（[features].multi_agent=true）
- max_threads=32 / max_depth=2
- サブエージェントは 1タスク専任
- サブエージェントは非対話になり得るため、承認が必要な行為は失敗する前提で組む（approval_policy=never で回避） :contentReference[oaicite:4]{index=4}

---

## “実装を一気に完了 → 最後に検証 → 広範レビュー” 手順（委譲割り当てまで）

### Phase 0: 目標設定（goal_setter）
**目的**：曖昧さを潰し、タスク/完了条件/割当を確定
- explorer: 該当箇所/関連箇所/リスク/見積り
- docs_researcher: 必要な公式仕様
- goal_setter: tasks/todo.md を更新し、担当を割り当てる

### Phase 1: 実装（ここを一気に完了）
**ルール**：途中レビュー禁止。詰まったら再計画。
- implementer_light: 小規模（loc<=250 & files<=5）
- implementer_heavy: 中〜大規模/境界（auth/db/infra/セキュリティ）
- test_writer: 変更が回帰リスクを持つなら必須
- ci_fixer: 型/ビルド/CIの詰まりを先回りで解消

**全実装モード共通**：
- 最後に SIMPLIFY パス（simplify_reuse/quality/efficiency）を必ず実行

### Phase 2: 最後にまとめて検証（verifier）
- typecheck / lint / test / build を必要範囲で実行
- 証跡（コマンドと結果）を残す
- FAIL は “修正タスク” に分解して差し戻す（誰が何を直すか明記）

### Phase 3: 広範レビュー（まとめて）
- quality_reviewer: 実装箇所＋関連項目
- security_auditor: 認可/秘密/注入
- perf_sleuth: 性能
- test_auditor: テスト
- reviewer: 統合して優先度付きバックログ化

### Phase 4: 指摘修正 → 最終検証
- implementer_* / test_writer が修正
- verifier が再検証
- DoD を満たして終了

---

## 委譲の数値ルール（ブレ防止）

### light（spark）に投げる
- loc_est <= 250
- files_est <= 5
- runtime_est_min <= 10
- auth/db/infra の境界を触らない

### heavy（codex）に投げる
- loc_est > 250 または files_est > 5
- tests=yes（複数追加/重要経路）
- area が auth/db/infra/セキュリティ境界/設計変更
- runtime_est_min が長い・不確実

### loc_est 区分（固定）
- <=250 / <=800 / >800
