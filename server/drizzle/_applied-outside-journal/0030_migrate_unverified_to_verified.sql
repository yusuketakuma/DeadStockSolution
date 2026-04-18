-- Migrate existing unverified users to verified status
-- All pre-verification-feature users should be treated as verified
ALTER TABLE "pharmacies"
ALTER COLUMN "verification_status" SET DEFAULT 'pending_verification';

UPDATE pharmacies
SET verification_status = 'verified', verified_at = NOW()
WHERE verification_status = 'unverified';
