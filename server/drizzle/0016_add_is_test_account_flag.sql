ALTER TABLE "pharmacies" ADD COLUMN "is_test_account" boolean DEFAULT false NOT NULL;

UPDATE "pharmacies"
SET "is_test_account" = true
WHERE "email" IN (
  'test-tokyo@example.com',
  'test-sapporo@example.com',
  'test-osaka@example.com',
  'test-fukuoka@example.com',
  'test-naha@example.com'
);
