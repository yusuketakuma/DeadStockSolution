# 統合通知センター設計書

## 概要

既存ダッシュボードの通知機能を拡張し、統合通知センターを構築する。
新規ページは作成せず、ダッシュボード + ヘッダーの拡張で完結させる。

## 目的

- 新しいマッチの見落としを防ぐ
- 提案への反応速度を上げる
- 薬局間コミュニケーション（提案コメント）を強化する

## 技術的アプローチ

- アプリ内通知のみ（メール送信なし）
- ポーリング方式（30秒間隔、Vercel Serverless互換）
- 既存ダッシュボードUIを拡張

---

## データベーススキーマ

### `notifications` テーブル（新設）

| カラム | 型 | 説明 |
|--------|-----|------|
| id | serial (PK) | |
| pharmacyId | integer (FK) | 通知先の薬局 |
| type | text | 通知タイプ |
| title | text | 通知タイトル |
| message | text | 通知本文 |
| referenceType | text | 参照先タイプ（'proposal' / 'match' / 'comment'） |
| referenceId | integer | 参照先のID |
| isRead | boolean | 既読フラグ（default: false） |
| readAt | timestamp | 既読日時（nullable） |
| createdAt | timestamp | 作成日時（default: now()） |

インデックス: `(pharmacyId, isRead, createdAt DESC)`

### `proposalComments` テーブル（カラム追加）

| カラム | 型 | 説明 |
|--------|-----|------|
| readByRecipient | boolean | 相手側既読フラグ（default: false） |

### 通知タイプ一覧

| type | 発火タイミング | title例 |
|------|--------------|---------|
| `new_match` | 自分のデッドストックにマッチする在庫が登録された | "○○が△△薬局で見つかりました" |
| `proposal_received` | 新しい交換提案を受信した | "△△薬局から交換提案が届きました" |
| `proposal_status_changed` | 提案のステータスが変わった | "交換提案が承認されました" |
| `new_comment` | 提案にコメントが追加された | "△△薬局がコメントしました" |

---

## API エンドポイント

### 通知 API (`/api/notifications`)

| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/notifications` | 通知一覧取得（ページネーション付き） |
| GET | `/api/notifications/unread-count` | 未読件数取得（ポーリング用、軽量） |
| PATCH | `/api/notifications/:id/read` | 1件を既読にする |
| PATCH | `/api/notifications/read-all` | 全件を既読にする |

### 通知一覧レスポンス

```json
{
  "notifications": [
    {
      "id": 1,
      "type": "proposal_received",
      "title": "△△薬局から交換提案が届きました",
      "message": "ロキソプロフェン錠60mg 他2品目",
      "referenceType": "proposal",
      "referenceId": 42,
      "isRead": false,
      "createdAt": "2026-02-26T10:30:00Z"
    }
  ],
  "total": 25,
  "page": 1,
  "limit": 20
}
```

### 未読件数レスポンス（ポーリング用）

```json
{ "unreadCount": 3 }
```

### 通知生成ロジック

通知は各サービスの既存メソッド内でベストエフォートで生成:
- `exchange-service.ts` → `proposal_received` / `proposal_status_changed`
- `matching-service.ts` → `new_match`
- コメント追加API → `new_comment`

---

## フロントエンド UI

### 既存通知タイプの拡張

`Notice.type` に `new_comment` を追加。
`types.ts` の `noticeTypeLabel` / `noticeVariant` に新タイプを追加。

### ヘッダー未読バッジ

`Header.tsx` の「ダッシュボード」リンク横に未読件数バッジを表示。
クリックでダッシュボードへ遷移。

### ダッシュボード自動更新（ポーリング）

- `useNotificationPolling` カスタムフック
- 30秒間隔で `/api/notifications/unread-count` を軽量ポーリング
- `visibilitychange` イベントでバックグラウンド時は停止
- `NotificationContext` で未読件数をヘッダーバッジと共有
- ダッシュボード表示中は全件リロード、それ以外はカウントのみ

### 提案コメントの未読管理

- `ProposalDetailPage.tsx` のコメント欄に未読バッジ表示
- コメント表示時に自動で既読 API を呼び出し
- 新コメント時に `notifications` テーブルにもレコード追加

### DashboardNextAction の拡張

`buildNextAction` に `new_comment` タイプのハンドリングを追加。

---

## エラーハンドリング

| シナリオ | 対応 |
|---------|------|
| ポーリングAPIタイムアウト | エラーを無視し次のポーリングまで待つ |
| 通知生成の失敗 | ベストエフォート。メイン処理は正常完了させる |
| 既読更新の失敗 | コンソールログのみ。ユーザー操作はブロックしない |
| ネットワーク断 | バッジは最後の値を保持。再接続後に自動復旧 |

---

## テスト計画

| テスト種別 | 対象 | 内容 |
|-----------|------|------|
| サーバーユニット | notification-service.ts | 通知作成・取得・既読更新 |
| サーバーユニット | notifications route | API 4本の正常・異常系 |
| クライアントユニット | useNotificationPolling | ポーリング開始/停止/バックグラウンド停止 |
| クライアントE2E | DashboardNotices | new_comment タイプの表示・クリック遷移 |
| 既存テスト | 影響範囲チェック | 通知追加後もテストがパスすること |

---

## スコープ外

- メール通知
- LINE連携
- WebSocket / SSE（リアルタイム通信）
- リアルタイムチャット
- 薬局間ダイレクトメッセージ
- 通知一覧の専用ページ
