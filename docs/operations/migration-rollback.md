# Migration Rollback Runbook

## 対象

- `0042_proposal_expiry_reminder_tracking.sql`
- `0043_push_notification_preferences.sql`

どちらも Drizzle の forward migration として追加されているため、ロールバックは手動 SQL で実施する。

## 事前確認

1. 対象 DB のバックアップを取得する。
2. 書き込みトラフィックを落とせる時間帯で実施する。
3. rollback 対象が `0042` のみか、`0042` と `0043` の両方かを決める。

状態確認 SQL:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'exchange_proposals'
  AND column_name = 'expiry_reminder_sent_at';

SELECT table_name
FROM information_schema.tables
WHERE table_name = 'push_notification_preferences';

SELECT indexname
FROM pg_indexes
WHERE indexname = 'idx_push_notification_preferences_pharmacy';
```

## ロールバック SQL

### 0043 を戻す

```sql
BEGIN;

DROP INDEX IF EXISTS idx_push_notification_preferences_pharmacy;
DROP TABLE IF EXISTS push_notification_preferences;

COMMIT;
```

### 0042 を戻す

```sql
BEGIN;

ALTER TABLE exchange_proposals
  DROP COLUMN IF EXISTS expiry_reminder_sent_at;

COMMIT;
```

両方戻す場合は `0043` を先に削除してから `0042` を実行する。

## 実施手順

1. 対象環境の DB に接続する。
2. `0043` の rollback が必要なら先に実行する。
3. `0042` の rollback が必要なら続けて実行する。
4. verification SQL を再実行し、対象 column / table / index が消えていることを確認する。
5. server を再起動する。

## 事後確認

確認 SQL:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'exchange_proposals'
  AND column_name = 'expiry_reminder_sent_at';

SELECT COUNT(*)
FROM information_schema.tables
WHERE table_name = 'push_notification_preferences';

SELECT COUNT(*)
FROM pg_indexes
WHERE indexname = 'idx_push_notification_preferences_pharmacy';
```

期待値:

- `expiry_reminder_sent_at` は 0 行
- `push_notification_preferences` は 0 件
- `idx_push_notification_preferences_pharmacy` は 0 件

## 注意点

- `0043` を戻すと push 通知設定データは失われる。
- `0042` を戻すと期限通知の送信済み記録は失われ、再送制御は効かなくなる。
- manual rollback 後は Drizzle の migration 履歴と実 DB がずれるため、次の forward 適用前に補正方針を決める。

## 再適用

rollback 後に再度機能を戻す場合は、対象 migration を staging で再検証した上で新しい forward migration を追加する。既存 migration の再実行を前提にしない。
