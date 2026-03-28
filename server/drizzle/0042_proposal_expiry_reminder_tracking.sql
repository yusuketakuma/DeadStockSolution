ALTER TABLE "exchange_proposals"
  ADD COLUMN IF NOT EXISTS "expiry_reminder_sent_at" timestamp;
