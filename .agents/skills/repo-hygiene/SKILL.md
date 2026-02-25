---
name: repo-hygiene
description: "低リスクの全体改善（不要コード/危険パターン/設定齟齬/軽い性能改善）。大規模リファクタは禁止。"
---

# Repo Hygiene Sweep

対象:
- 不要コード/未使用export/未使用変数
- 危険APIの単純置換（innerHTML等はルール準拠）
- workflow/script のパス齟齬
- 認可/所有権チェックの fail-open を fail-closed に
- SQL 文字列補間の排除（パラメータ化）

制約:
- 大規模リファクタ禁止
- 変更が大きくなるなら tasks/todo.md に分割案を提案して止める
- 変更後は verifier の順に typecheck→lint→tests を通す
