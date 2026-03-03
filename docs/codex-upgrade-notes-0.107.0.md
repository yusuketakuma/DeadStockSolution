# Codex CLI 0.107.0 Upgrade Notes

このリポジトリ設定は 0.107.0 以降を前提にしている。

## 0.107.0 で押さえるポイント（公式リリースより）
- app-server に thread/fork リクエスト追加 :contentReference[oaicite:25]{index=25}
- thread/start が、MCP auth check 等で無関係な app-server リクエストをブロックしないよう改善（スタック/停止の軽減） :contentReference[oaicite:26]{index=26}
- Memories の設定可能化、debug clear-memories 追加 :contentReference[oaicite:27]{index=27}
- custom tools の multimodal 出力サポート :contentReference[oaicite:28]{index=28}

## 設定互換の要点
- `approval_policy`: on-failure は deprecated（on-request / never を使う） :contentReference[oaicite:29]{index=29}
- `web_search`: top-level 設定（disabled|cached|live） :contentReference[oaicite:30]{index=30}
- `collab` は multi_agent へ（このリポジトリは multi_agent を使用） :contentReference[oaicite:31]{index=31}
- `connectors` は apps へ（このリポジトリは apps を使用） :contentReference[oaicite:32]{index=32}
