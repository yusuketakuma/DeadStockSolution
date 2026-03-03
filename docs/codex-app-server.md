# Codex App Server

## これは何？
`codex app-server` は、Codex を“自分のプロダクト/クライアント”に埋め込むためのプロトコル。
Codex VS Code extension のようなリッチクライアントが使うインターフェースでもある。 :contentReference[oaicite:15]{index=15}

## できること（要点）
- 認証、会話履歴、承認、ストリーミングイベントを含む深い統合 :contentReference[oaicite:16]{index=16}
- JSON-RPC 2.0 ベースの双方向通信 :contentReference[oaicite:17]{index=17}
- Transport:
  - stdio（デフォルト）
  - websocket（実験） :contentReference[oaicite:18]{index=18}
- スキーマ生成（TS/JSON Schema）を CLI で生成でき、実行した Codex バージョンに一致する :contentReference[oaicite:19]{index=19}

## 起動
- stdio（既定）：
  - `codex app-server`
- websocket（実験）：
  - `codex app-server --listen ws://127.0.0.1:4500` :contentReference[oaicite:20]{index=20}

## プロトコルの超概要
- initialize → initialized の後に thread/start を投げる :contentReference[oaicite:21]{index=21}
- 例（thread/start）では model/cwd/approvalPolicy/sandbox/personality などを渡せる :contentReference[oaicite:22]{index=22}

## 設計メモ（このリポジトリ方針）
- 本番統合をするなら、まずは stdio で安定稼働を確認
- websocket はキューが詰まると過負荷エラーを返すため、クライアント側でリトライ/バックオフ設計が必要 :contentReference[oaicite:23]{index=23}
- MCP server を required にすると、初期化失敗で thread/start が失敗する（運用で詰まるので基本 required にしない） :contentReference[oaicite:24]{index=24}
