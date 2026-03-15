# Database Partitioning Strategy

This directory contains SQL migration scripts for implementing table partitioning on large tables in the DeadStockSolution database.

## Overview

Partitioning improves query performance by:
- Reducing the amount of data scanned per query (partition pruning)
- Enabling parallel query execution across partitions
- Improving index efficiency and cache locality
- Facilitating easier maintenance and archival of old data

## Partitioning Strategies

### 1. dead_stock_items - HASH Partitioning by pharmacy_id

**File**: `partition-dead-stock-items.sql`

**Strategy**: HASH partitioning on `pharmacy_id` with 4 partitions

**Rationale**:
- Most queries filter by `pharmacy_id` (single pharmacy lookups)
- HASH distribution ensures even load across partitions
- 4 partitions provide good balance for typical deployment sizes

**Query Patterns Optimized**:
- `SELECT * FROM dead_stock_items WHERE pharmacy_id = ?`
- `SELECT * FROM dead_stock_items WHERE pharmacy_id = ? AND is_available = true`
- `SELECT * FROM dead_stock_items WHERE pharmacy_id = ? AND created_at > ?`

**Partitions**:
- `dead_stock_items_p0` - pharmacy_id % 4 = 0
- `dead_stock_items_p1` - pharmacy_id % 4 = 1
- `dead_stock_items_p2` - pharmacy_id % 4 = 2
- `dead_stock_items_p3` - pharmacy_id % 4 = 3

**Indexes per Partition**:
- `(pharmacy_id, is_available, created_at)` - primary query pattern
- `(pharmacy_id, created_at)` - time-range queries
- `(created_at)` WHERE is_available = true - global available items
- `(is_available, drug_name)` - drug name searches
- `(pharmacy_id, is_available, expiration_date_iso)` - expiry risk analysis
- `(drug_master_id)` - drug master lookups
- `(pharmacy_id, drug_master_id)` WHERE is_available = true - available drug lookups
- `(drug_master_package_id)` - package lookups
- `(pharmacy_id, is_available, drug_name)` - combined searches

### 2. notifications - RANGE Partitioning by created_at (Monthly)

**File**: `partition-notifications.sql`

**Strategy**: RANGE partitioning on `created_at` with monthly partitions

**Rationale**:
- Notifications are time-series data with natural monthly boundaries
- Enables efficient archival of old notifications
- Improves query performance for recent notifications (most common use case)
- Supports partition pruning on time-range queries

**Query Patterns Optimized**:
- `SELECT * FROM notifications WHERE pharmacy_id = ? AND created_at > ? ORDER BY created_at DESC`
- `SELECT * FROM notifications WHERE pharmacy_id = ? AND is_read = false`
- `SELECT * FROM notifications WHERE type = ? AND created_at > ?`

**Partition Coverage**:
- 12 months of historical data (2024-12 through 2025-11)
- 3 months of future partitions (2026-01 through 2026-03)
- Adjust dates based on current deployment date

**Indexes per Partition**:
- `(pharmacy_id, is_read, created_at)` - unread notifications
- `(type, created_at DESC)` - type-based queries
- `(reference_type, reference_id)` - reference lookups

**Maintenance**:
- Create new monthly partitions as needed (e.g., `notifications_2026_04` for April 2026)
- Archive old partitions by detaching and exporting to cold storage
- Example: `ALTER TABLE notifications DETACH PARTITION notifications_2024_12;`

## Migration Steps

### For dead_stock_items (HASH Partitioning)

1. **Backup existing data**:
   ```sql
   CREATE TABLE dead_stock_items_backup AS SELECT * FROM dead_stock_items;
   ```

2. **Create partitioned table and partitions**:
   ```sql
   -- Run the SQL from partition-dead-stock-items.sql (lines 1-45)
   ```

3. **Copy data**:
   ```sql
   INSERT INTO dead_stock_items_partitioned SELECT * FROM dead_stock_items;
   ```

4. **Verify data integrity**:
   ```sql
   SELECT COUNT(*) FROM dead_stock_items;
   SELECT COUNT(*) FROM dead_stock_items_partitioned;
   -- Should match
   ```

5. **Rename tables** (requires brief downtime):
   ```sql
   ALTER TABLE dead_stock_items RENAME TO dead_stock_items_old;
   ALTER TABLE dead_stock_items_partitioned RENAME TO dead_stock_items;
   ```

6. **Test application** - Verify all queries work correctly

7. **Drop old table**:
   ```sql
   DROP TABLE dead_stock_items_old;
   ```

### For notifications (RANGE Partitioning)

1. **Backup existing data**:
   ```sql
   CREATE TABLE notifications_backup AS SELECT * FROM notifications;
   ```

2. **Create partitioned table and partitions**:
   ```sql
   -- Run the SQL from partition-notifications.sql (lines 1-69)
   ```

3. **Copy data**:
   ```sql
   INSERT INTO notifications_partitioned SELECT * FROM notifications;
   ```

4. **Verify data integrity**:
   ```sql
   SELECT COUNT(*) FROM notifications;
   SELECT COUNT(*) FROM notifications_partitioned;
   -- Should match
   ```

5. **Rename tables** (requires brief downtime):
   ```sql
   ALTER TABLE notifications RENAME TO notifications_old;
   ALTER TABLE notifications_partitioned RENAME TO notifications;
   ```

6. **Test application** - Verify all queries work correctly

7. **Drop old table**:
   ```sql
   DROP TABLE notifications_old;
   ```

## Drizzle ORM Compatibility

**Important**: Drizzle ORM does not fully support partitioned tables in schema definitions. Therefore:

- Partitioning is implemented via raw SQL migrations only
- Drizzle schema.ts remains unchanged
- Queries continue to work transparently (Postgres handles partition routing)
- No application code changes required

## Performance Expectations

### dead_stock_items (HASH)
- **Before**: Full table scan for pharmacy-specific queries
- **After**: Scan only 1/4 of the table (partition pruning)
- **Expected improvement**: 3-4x faster for pharmacy-specific queries

### notifications (RANGE)
- **Before**: Full table scan for recent notifications
- **After**: Scan only current + recent partitions
- **Expected improvement**: 5-10x faster for recent notification queries (typical use case)

## Monitoring

Monitor partition effectiveness:

```sql
-- Check partition sizes
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE tablename LIKE 'dead_stock_items_%' OR tablename LIKE 'notifications_%'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Check query plans to verify partition pruning
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM dead_stock_items WHERE pharmacy_id = 123 AND is_available = true;
-- Should show "Subplans Removed: 3" indicating 3 partitions were pruned
```

## Rollback Procedure

If issues arise:

1. **Rename partitioned table back**:
   ```sql
   ALTER TABLE dead_stock_items RENAME TO dead_stock_items_partitioned;
   ALTER TABLE dead_stock_items_old RENAME TO dead_stock_items;
   ```

2. **Drop partitioned table**:
   ```sql
   DROP TABLE dead_stock_items_partitioned;
   ```

3. **Restart application**

## Future Enhancements

- Implement automatic partition creation via triggers or scheduled jobs
- Archive old notification partitions to cold storage
- Consider sub-partitioning for very large tables (e.g., dead_stock_items by pharmacy_id + created_at)
- Monitor and adjust partition count based on actual data distribution

## References

- PostgreSQL Partitioning: https://www.postgresql.org/docs/current/ddl-partitioning.html
- Partition Pruning: https://www.postgresql.org/docs/current/ddl-partitioning.html#DDL-PARTITIONING-CONSTRAINT-EXCLUSION
- Drizzle ORM: https://orm.drizzle.team/
