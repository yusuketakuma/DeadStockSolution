# Plans.md — DeadStockSolution

> 詳細設計は [plan.md](./plan.md) を参照

## 🔴 進行中のタスク

（なし）

## 🟡 未着手のタスク

（なし）

## 🟢 完了タスク

### v0.0.22 直近差分レビュー後の追加改善バックログ (2026-03-28) — 完了 (2026-03-28)

> 20タスク — P0/P1/P2 3段階優先度

#### P0: ユーザー価値直結 (7タスク)

- [x] T1120: 提案アイテム数量調整 UI `cc:完了` depends:T1118
- [x] T1121: 提案テンプレート UI + 再利用導線 `cc:完了` depends:T1117
- [x] T1122: 提案期限の可視化と期限切れ導線 `cc:完了` depends:T1101,T1111
- [x] T1123: マッチングスコア内訳と候補理由 UI `cc:完了` depends:T955
- [x] T1124: 日次統計の usedMedCount 実装 `cc:完了`
- [x] T1125: サブスク管理 UI と決済反映確認フロー `cc:完了`
- [x] T1126: 提案フロー Playwright E2E 実働化 `cc:完了` depends:T1119

#### P1: 鮮度・運用性改善 (7タスク)

- [x] T1127: OpenClaw retry queue UI 統合 `cc:完了` depends:T992
- [x] T1128: OpenClaw request event timeline UI `cc:完了` depends:T994
- [x] T1129: 要望対応 SLA ビュー強化 `cc:完了`
- [x] T1130: 文脈付きメッセージ起動導線 `cc:完了`
- [x] T1131: メッセージ履歴ページング・検索改善 `cc:完了`
- [x] T1132: 通知センターページ追加 `cc:完了`
- [x] T1133: 重要イベントの push 通知拡張 `cc:完了`

#### P2: 体験磨き込み・保守性改善 (6タスク)

- [x] T1134: ダッシュボード chart / badge drill-down `cc:完了`
- [x] T1135: Matching filters の永続化 `cc:完了`
- [x] T1136: 直近追加ページのモバイル再監査 + visual test `cc:完了`
- [x] T1137: リアルタイム配信経路の整理 `cc:完了`
- [x] T1138: README / セットアップ / 運用ドキュメント整合 `cc:完了`
- [x] T1139: DDS remote agent bootstrap / 接続状態の管理UI `cc:完了`

### v0.0.21 マッチング機能改善 Phase 1 (2026-03-26) — 完了 (2026-03-26)

> 19タスク — 提案ワークフロー・マッチング・通知・テスト改善

- [x] T1101: 提案有効期限 auto-reject `cc:完了`
- [x] T1102: completeProposal エラーメッセージ改善 `cc:完了`
- [x] T1103: FOR UPDATE NOWAIT + statement_timeout `cc:完了`
- [x] T1104: 通知失敗時の再試行メカニズム `cc:完了`
- [x] T1105: SSE再接続の安定化 `cc:完了`
- [x] T1106: マッチングジョブ失敗通知 `cc:完了`
- [x] T1107: 楽観的更新のロールバック通知改善 `cc:完了`
- [x] T1108: スナップショットの時間ベースTTL `cc:完了`
- [x] T1109: 薬品同等性の循環参照チェック `cc:完了`
- [x] T1110: アップロードジョブのタイムアウトUI `cc:完了`
- [x] T1111: 提案の自動リマインダー通知 `cc:完了`
- [x] T1112: 提案の監査ログ詳細化 `cc:完了`
- [x] T1113: グループ内限定マッチングモード `cc:完了`
- [x] T1114: flaky test解消 `cc:完了`
- [x] T1115: マッチング候補プリフェッチ `cc:完了`
- [x] T1116: 交換完了後の自動再マッチング `cc:完了`
- [x] T1117: 提案テンプレート機能 `cc:完了`
- [x] T1118: 部分的な提案（品目調整） `cc:完了`
- [x] T1119: E2Eテスト整備（Playwright） `cc:完了`

### v0.0.19 全体改善スプリント (2026-03-23) — 完了 (2026-03-23)

> 37タスク (6 Track + Track G 11タスク) — 全完了

- Track A: UX 改善 (T950-T954) `cc:完了`
- Track B: マッチング高度化 (T955,T961-T965) `cc:完了`
- Track C: 運用・管理改善 (T971-T975) `cc:完了`
- Track D: パフォーマンス (T983-T984) `cc:完了`
- Track E: OpenClaw 実戦配備 (T991-T994) `cc:完了`
- Track F: 横断ゲート (T996-T999) `cc:完了`
- Track G: 追加機能 (T1001-T1012) `cc:完了`

### v0.0.17 Release Hardening + Inventory Search + Auth/Account (2026-03-21) — 完了

> 27タスク (Track A 9 + Track B 4 + Track C 3 + Next Queue 11) — 全完了

---

## 📦 アーカイブ

> 完了済みスプリントは `.claude/memory/archive/` に移動済み

- [医薬品マスター管理機能スプリント](.claude/memory/archive/Plans-completed-sprint-drug-master.md) — Phase 1-6 全完了 + Backlog (23タスク, archived 2026-02-25)
- [2026-02 スプリント群](.claude/memory/archive/Plans-completed-sprints-2026-02.md) — T001-T040: コード品質改善 / システム堅牢化 / 統合通知 / コード簡素化 (40タスク, archived 2026-03-01)
- [2026-03 スプリント群](.claude/memory/archive/Plans-completed-sprints-2026-03.md) — T041-T100: パフォーマンス改善 / タイムライン / 認証強化 / UX改善 / 統計 / 薬品マスター自動更新 (60タスク, archived 2026-03-02)
- [v0.0.8 + リファクタリング](.claude/memory/archive/Plans-completed-sprints-2026-03-v008-refactor.md) — T101-T114 + Wave 1-6 リファクタリング (archived 2026-03-07)
- [v0.0.9](.claude/memory/archive/Plans-completed-sprints-2026-03-v009.md) — T115-T127: セキュリティ・テスト・UX (archived 2026-03-07)
- [v0.0.10](.claude/memory/archive/Plans-completed-sprints-2026-03-v010.md) — T201-T217: Pre-commit hooks / モニタリング / 依存関係管理 / バンドル最適化 (archived 2026-03-07)
- [v0.0.10 hooks ~ v0.4.0 refactoring](.claude/memory/archive/Plans-completed-sprints-2026-03-v011-v040.md) — T128-T130, T218-T219, T301-T312, T401-T426, T501-T503, T601-T609 (archived 2026-03-15)
- [v0.0.14 サーバーサイド簡素化](.claude/memory/archive/) — T701-T708: 38ファイルリファクタリング (archived 2026-03-17)
- [v0.0.15 UI/UX 改善スプリント](.claude/memory/archive/) — 25タスク 6 Phase 全完了 (archived 2026-03-17)
