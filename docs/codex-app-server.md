# Codex App Server（概要）

codex app-server は、リッチクライアント（例: IDE拡張）向けのインターフェース。
深い統合（通知/イベント/制御）が必要な場合に使う。

## 起動
- stdio:
  - codex app-server
- websocket（experimental）:
  - codex app-server --listen ws://127.0.0.1:4500

## 最低限の手順
1) 接続
2) initialize
3) initialized
4) thread/turn を開始し、イベントを消費
