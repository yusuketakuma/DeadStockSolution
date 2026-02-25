# Codex Working Agreement (Minimal)

このリポジトリでは、以下の2点だけを最優先する：
1) multi-agent を積極的に使う
2) タスクが完了するまで粘る（未完で終わらない）

---

## 1) Multi-agent（必須）

- 並列化できる作業は必ず sub-agent に分ける（例：調査/実装/検証）。
- この環境で利用可能な role を優先する（`spawn_agent` 実測）：
  - implementer: 実装・調査の基本ロール（必要なら read-only 指示を明示）
  - claude_implementer: 実装の代替ロール
  - claude_reviewer: レビュー/監視の代替ロール
- 2026-02-25 実測で利用不可だった role（指定しない）：
  - default
  - explorer
  - worker
  - verifier
- 役割マッピング（この順で使う）：
  - explorer 相当: `implementer` に read-only 調査を指示
  - worker 相当: `implementer`（または `claude_implementer`）
  - monitor 相当: `claude_reviewer`
- `spawn_agent` 実行時は次のフォールバック順で再試行する：
  1) `implementer`
  2) `claude_implementer`
  3) `claude_reviewer`
- 1 agent = 1 仕事。まとめて投げない。
- sub-agent の結果が揃うまで待ち、最後に統合して次アクションへ進む。

---

## 2) 「完了まで粘る」（必須）

### 退出条件（これ以外は禁止）
- DONE: ユーザーの要求が満たされ、必要な検証（存在するなら type/lint/test 等）まで通して"動く根拠"を示した状態
- BLOCKED: 外部要因（権限/認証/環境差/秘密情報不足など）で、これ以上進められない状態
  - BLOCKED のときは「不足しているもの」を最小個数で列挙する（それ以外は続行）

### 禁止事項
- "次にやるなら…"だけ書いて終了
- 推測のまま完了扱い
- 失敗したコマンドを放置して先へ進む

### 実行ルール（粘り方）
- まず短いチェックリスト（3〜7項目）を作り、作業しながら更新する
- 失敗したら原因を潰して再実行し、成功するまで繰り返す
- 不確実な点は explorer 相当（`implementer` に read-only 指示）で裏取りしてから進む

Codex は AGENTS.md を起動時に読み込み、階層的に結合します。
