-- Partition dead_stock_items table by pharmacy_id using HASH
-- This improves query performance by reducing scan scope for pharmacy-specific lookups
-- 4 partitions distribute load evenly across pharmacy IDs

-- Step 1: Create partitioned table (requires table recreation)
-- Note: This migration requires downtime or careful planning with application pause

CREATE TABLE dead_stock_items_partitioned (
  id serial,
  pharmacy_id integer NOT NULL,
  upload_id integer NOT NULL,
  drug_code text,
  drug_name text NOT NULL,
  drug_master_id integer,
  drug_master_package_id integer,
  package_label text,
  quantity real NOT NULL,
  unit text,
  yakka_unit_price numeric(12, 2),
  yakka_total numeric(12, 2),
  expiration_date text,
  expiration_date_iso date,
  lot_number text,
  is_available boolean DEFAULT true,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id, pharmacy_id),
  FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id) ON DELETE CASCADE,
  FOREIGN KEY (upload_id) REFERENCES uploads(id) ON DELETE CASCADE,
  CONSTRAINT chk_dead_stock_quantity CHECK (quantity > 0),
  CONSTRAINT chk_dead_stock_yakka_price CHECK (yakka_unit_price IS NULL OR yakka_unit_price >= 0)
) PARTITION BY HASH (pharmacy_id);

-- Create 4 hash partitions
CREATE TABLE dead_stock_items_p0 PARTITION OF dead_stock_items_partitioned
  FOR VALUES WITH (MODULUS 4, REMAINDER 0);

CREATE TABLE dead_stock_items_p1 PARTITION OF dead_stock_items_partitioned
  FOR VALUES WITH (MODULUS 4, REMAINDER 1);

CREATE TABLE dead_stock_items_p2 PARTITION OF dead_stock_items_partitioned
  FOR VALUES WITH (MODULUS 4, REMAINDER 2);

CREATE TABLE dead_stock_items_p3 PARTITION OF dead_stock_items_partitioned
  FOR VALUES WITH (MODULUS 4, REMAINDER 3);

-- Step 2: Create indexes on each partition
-- Indexes on pharmacy_id + is_available + created_at (most common query pattern)
CREATE INDEX idx_dead_stock_p0_pharmacy_available_created
  ON dead_stock_items_p0 (pharmacy_id, is_available, created_at);

CREATE INDEX idx_dead_stock_p1_pharmacy_available_created
  ON dead_stock_items_p1 (pharmacy_id, is_available, created_at);

CREATE INDEX idx_dead_stock_p2_pharmacy_available_created
  ON dead_stock_items_p2 (pharmacy_id, is_available, created_at);

CREATE INDEX idx_dead_stock_p3_pharmacy_available_created
  ON dead_stock_items_p3 (pharmacy_id, is_available, created_at);

-- Indexes on pharmacy_id + created_at
CREATE INDEX idx_dead_stock_p0_pharmacy_created
  ON dead_stock_items_p0 (pharmacy_id, created_at);

CREATE INDEX idx_dead_stock_p1_pharmacy_created
  ON dead_stock_items_p1 (pharmacy_id, created_at);

CREATE INDEX idx_dead_stock_p2_pharmacy_created
  ON dead_stock_items_p2 (pharmacy_id, created_at);

CREATE INDEX idx_dead_stock_p3_pharmacy_created
  ON dead_stock_items_p3 (pharmacy_id, created_at);

-- Indexes on is_available + created_at (for global available items queries)
CREATE INDEX idx_dead_stock_p0_available_created
  ON dead_stock_items_p0 (created_at)
  WHERE is_available = true;

CREATE INDEX idx_dead_stock_p1_available_created
  ON dead_stock_items_p1 (created_at)
  WHERE is_available = true;

CREATE INDEX idx_dead_stock_p2_available_created
  ON dead_stock_items_p2 (created_at)
  WHERE is_available = true;

CREATE INDEX idx_dead_stock_p3_available_created
  ON dead_stock_items_p3 (created_at)
  WHERE is_available = true;

-- Indexes on is_available + drug_name
CREATE INDEX idx_dead_stock_p0_available_name
  ON dead_stock_items_p0 (is_available, drug_name);

CREATE INDEX idx_dead_stock_p1_available_name
  ON dead_stock_items_p1 (is_available, drug_name);

CREATE INDEX idx_dead_stock_p2_available_name
  ON dead_stock_items_p2 (is_available, drug_name);

CREATE INDEX idx_dead_stock_p3_available_name
  ON dead_stock_items_p3 (is_available, drug_name);

-- Indexes on pharmacy_id + is_available + expiration_date_iso (expiry risk queries)
CREATE INDEX idx_dead_stock_p0_expiry_risk
  ON dead_stock_items_p0 (pharmacy_id, is_available, expiration_date_iso);

CREATE INDEX idx_dead_stock_p1_expiry_risk
  ON dead_stock_items_p1 (pharmacy_id, is_available, expiration_date_iso);

CREATE INDEX idx_dead_stock_p2_expiry_risk
  ON dead_stock_items_p2 (pharmacy_id, is_available, expiration_date_iso);

CREATE INDEX idx_dead_stock_p3_expiry_risk
  ON dead_stock_items_p3 (pharmacy_id, is_available, expiration_date_iso);

-- Indexes on drug_master_id
CREATE INDEX idx_dead_stock_p0_drug_master_id
  ON dead_stock_items_p0 (drug_master_id);

CREATE INDEX idx_dead_stock_p1_drug_master_id
  ON dead_stock_items_p1 (drug_master_id);

CREATE INDEX idx_dead_stock_p2_drug_master_id
  ON dead_stock_items_p2 (drug_master_id);

CREATE INDEX idx_dead_stock_p3_drug_master_id
  ON dead_stock_items_p3 (drug_master_id);

-- Indexes on pharmacy_id + drug_master_id (available items)
CREATE INDEX idx_dead_stock_p0_pharmacy_drug_master_available
  ON dead_stock_items_p0 (pharmacy_id, drug_master_id)
  WHERE is_available = true;

CREATE INDEX idx_dead_stock_p1_pharmacy_drug_master_available
  ON dead_stock_items_p1 (pharmacy_id, drug_master_id)
  WHERE is_available = true;

CREATE INDEX idx_dead_stock_p2_pharmacy_drug_master_available
  ON dead_stock_items_p2 (pharmacy_id, drug_master_id)
  WHERE is_available = true;

CREATE INDEX idx_dead_stock_p3_pharmacy_drug_master_available
  ON dead_stock_items_p3 (pharmacy_id, drug_master_id)
  WHERE is_available = true;

-- Indexes on drug_master_package_id
CREATE INDEX idx_dead_stock_p0_drug_master_package_id
  ON dead_stock_items_p0 (drug_master_package_id);

CREATE INDEX idx_dead_stock_p1_drug_master_package_id
  ON dead_stock_items_p1 (drug_master_package_id);

CREATE INDEX idx_dead_stock_p2_drug_master_package_id
  ON dead_stock_items_p2 (drug_master_package_id);

CREATE INDEX idx_dead_stock_p3_drug_master_package_id
  ON dead_stock_items_p3 (drug_master_package_id);

-- Indexes on pharmacy_id + is_available + drug_name
CREATE INDEX idx_dead_stock_p0_pharmacy_available_name
  ON dead_stock_items_p0 (pharmacy_id, is_available, drug_name);

CREATE INDEX idx_dead_stock_p1_pharmacy_available_name
  ON dead_stock_items_p1 (pharmacy_id, is_available, drug_name);

CREATE INDEX idx_dead_stock_p2_pharmacy_available_name
  ON dead_stock_items_p2 (pharmacy_id, is_available, drug_name);

CREATE INDEX idx_dead_stock_p3_pharmacy_available_name
  ON dead_stock_items_p3 (pharmacy_id, is_available, drug_name);

-- Step 3: Copy data from old table (if migrating from non-partitioned)
-- INSERT INTO dead_stock_items_partitioned SELECT * FROM dead_stock_items;

-- Step 4: Rename tables
-- ALTER TABLE dead_stock_items RENAME TO dead_stock_items_old;
-- ALTER TABLE dead_stock_items_partitioned RENAME TO dead_stock_items;

-- Step 5: Drop old table after verification
-- DROP TABLE dead_stock_items_old;
