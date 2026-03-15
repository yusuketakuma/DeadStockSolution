-- Partition notifications table by RANGE on created_at (monthly)
-- This improves query performance by enabling partition pruning on time-based queries
-- Partitions cover the last 12 months + next 3 months for operational flexibility

CREATE TABLE notifications_partitioned (
  id serial PRIMARY KEY,
  pharmacy_id integer NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  reference_type text,
  reference_id integer,
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamp,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id) ON DELETE CASCADE
) PARTITION BY RANGE (created_at);

-- Create monthly partitions
-- Adjust dates based on current date; these are examples for 2025-2026

CREATE TABLE notifications_2024_12 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2024-12-01') TO ('2025-01-01');

CREATE TABLE notifications_2025_01 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE TABLE notifications_2025_02 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');

CREATE TABLE notifications_2025_03 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');

CREATE TABLE notifications_2025_04 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');

CREATE TABLE notifications_2025_05 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');

CREATE TABLE notifications_2025_06 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');

CREATE TABLE notifications_2025_07 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');

CREATE TABLE notifications_2025_08 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');

CREATE TABLE notifications_2025_09 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');

CREATE TABLE notifications_2025_10 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');

CREATE TABLE notifications_2025_11 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');

CREATE TABLE notifications_2025_12 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');

CREATE TABLE notifications_2026_01 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

CREATE TABLE notifications_2026_02 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

CREATE TABLE notifications_2026_03 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

-- Create indexes on each partition
-- Index on pharmacy_id + is_read + created_at (most common query pattern)
CREATE INDEX idx_notifications_2024_12_pharmacy_unread
  ON notifications_2024_12 (pharmacy_id, is_read, created_at);

CREATE INDEX idx_notifications_2025_01_pharmacy_unread
  ON notifications_2025_01 (pharmacy_id, is_read, created_at);

CREATE INDEX idx_notifications_2025_02_pharmacy_unread
  ON notifications_2025_02 (pharmacy_id, is_read, created_at);

CREATE INDEX idx_notifications_2025_03_pharmacy_unread
  ON notifications_2025_03 (pharmacy_id, is_read, created_at);

CREATE INDEX idx_notifications_2025_04_pharmacy_unread
  ON notifications_2025_04 (pharmacy_id, is_read, created_at);

CREATE INDEX idx_notifications_2025_05_pharmacy_unread
  ON notifications_2025_05 (pharmacy_id, is_read, created_at);

CREATE INDEX idx_notifications_2025_06_pharmacy_unread
  ON notifications_2025_06 (pharmacy_id, is_read, created_at);

CREATE INDEX idx_notifications_2025_07_pharmacy_unread
  ON notifications_2025_07 (pharmacy_id, is_read, created_at);

CREATE INDEX idx_notifications_2025_08_pharmacy_unread
  ON notifications_2025_08 (pharmacy_id, is_read, created_at);

CREATE INDEX idx_notifications_2025_09_pharmacy_unread
  ON notifications_2025_09 (pharmacy_id, is_read, created_at);

CREATE INDEX idx_notifications_2025_10_pharmacy_unread
  ON notifications_2025_10 (pharmacy_id, is_read, created_at);

CREATE INDEX idx_notifications_2025_11_pharmacy_unread
  ON notifications_2025_11 (pharmacy_id, is_read, created_at);

CREATE INDEX idx_notifications_2025_12_pharmacy_unread
  ON notifications_2025_12 (pharmacy_id, is_read, created_at);

CREATE INDEX idx_notifications_2026_01_pharmacy_unread
  ON notifications_2026_01 (pharmacy_id, is_read, created_at);

CREATE INDEX idx_notifications_2026_02_pharmacy_unread
  ON notifications_2026_02 (pharmacy_id, is_read, created_at);

CREATE INDEX idx_notifications_2026_03_pharmacy_unread
  ON notifications_2026_03 (pharmacy_id, is_read, created_at);

-- Index on type + created_at (for type-based queries)
CREATE INDEX idx_notifications_2024_12_type_created
  ON notifications_2024_12 (type, created_at DESC);

CREATE INDEX idx_notifications_2025_01_type_created
  ON notifications_2025_01 (type, created_at DESC);

CREATE INDEX idx_notifications_2025_02_type_created
  ON notifications_2025_02 (type, created_at DESC);

CREATE INDEX idx_notifications_2025_03_type_created
  ON notifications_2025_03 (type, created_at DESC);

CREATE INDEX idx_notifications_2025_04_type_created
  ON notifications_2025_04 (type, created_at DESC);

CREATE INDEX idx_notifications_2025_05_type_created
  ON notifications_2025_05 (type, created_at DESC);

CREATE INDEX idx_notifications_2025_06_type_created
  ON notifications_2025_06 (type, created_at DESC);

CREATE INDEX idx_notifications_2025_07_type_created
  ON notifications_2025_07 (type, created_at DESC);

CREATE INDEX idx_notifications_2025_08_type_created
  ON notifications_2025_08 (type, created_at DESC);

CREATE INDEX idx_notifications_2025_09_type_created
  ON notifications_2025_09 (type, created_at DESC);

CREATE INDEX idx_notifications_2025_10_type_created
  ON notifications_2025_10 (type, created_at DESC);

CREATE INDEX idx_notifications_2025_11_type_created
  ON notifications_2025_11 (type, created_at DESC);

CREATE INDEX idx_notifications_2025_12_type_created
  ON notifications_2025_12 (type, created_at DESC);

CREATE INDEX idx_notifications_2026_01_type_created
  ON notifications_2026_01 (type, created_at DESC);

CREATE INDEX idx_notifications_2026_02_type_created
  ON notifications_2026_02 (type, created_at DESC);

CREATE INDEX idx_notifications_2026_03_type_created
  ON notifications_2026_03 (type, created_at DESC);

-- Index on reference_type + reference_id (for reference lookups)
CREATE INDEX idx_notifications_2024_12_reference_lookup
  ON notifications_2024_12 (reference_type, reference_id);

CREATE INDEX idx_notifications_2025_01_reference_lookup
  ON notifications_2025_01 (reference_type, reference_id);

CREATE INDEX idx_notifications_2025_02_reference_lookup
  ON notifications_2025_02 (reference_type, reference_id);

CREATE INDEX idx_notifications_2025_03_reference_lookup
  ON notifications_2025_03 (reference_type, reference_id);

CREATE INDEX idx_notifications_2025_04_reference_lookup
  ON notifications_2025_04 (reference_type, reference_id);

CREATE INDEX idx_notifications_2025_05_reference_lookup
  ON notifications_2025_05 (reference_type, reference_id);

CREATE INDEX idx_notifications_2025_06_reference_lookup
  ON notifications_2025_06 (reference_type, reference_id);

CREATE INDEX idx_notifications_2025_07_reference_lookup
  ON notifications_2025_07 (reference_type, reference_id);

CREATE INDEX idx_notifications_2025_08_reference_lookup
  ON notifications_2025_08 (reference_type, reference_id);

CREATE INDEX idx_notifications_2025_09_reference_lookup
  ON notifications_2025_09 (reference_type, reference_id);

CREATE INDEX idx_notifications_2025_10_reference_lookup
  ON notifications_2025_10 (reference_type, reference_id);

CREATE INDEX idx_notifications_2025_11_reference_lookup
  ON notifications_2025_11 (reference_type, reference_id);

CREATE INDEX idx_notifications_2025_12_reference_lookup
  ON notifications_2025_12 (reference_type, reference_id);

CREATE INDEX idx_notifications_2026_01_reference_lookup
  ON notifications_2026_01 (reference_type, reference_id);

CREATE INDEX idx_notifications_2026_02_reference_lookup
  ON notifications_2026_02 (reference_type, reference_id);

CREATE INDEX idx_notifications_2026_03_reference_lookup
  ON notifications_2026_03 (reference_type, reference_id);

-- Migration steps (manual execution required):
-- 1. Create the partitioned table and partitions (above)
-- 2. Copy data: INSERT INTO notifications_partitioned SELECT * FROM notifications;
-- 3. Rename tables: ALTER TABLE notifications RENAME TO notifications_old;
--                   ALTER TABLE notifications_partitioned RENAME TO notifications;
-- 4. Verify data integrity and application functionality
-- 5. Drop old table: DROP TABLE notifications_old;
-- 6. Create new partitions monthly as needed (e.g., notifications_2026_04 for April 2026)
