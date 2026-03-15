import 'dotenv/config';
import app from './app';
import { ensureTestPharmacyColumnsAtStartup, backfillTestPharmacyPasswords } from './config/test-pharmacy-schema';

// Serverless cold-start: ensure test pharmacy columns and backfill passwords
void ensureTestPharmacyColumnsAtStartup().then((ok) => {
  if (ok) void backfillTestPharmacyPasswords();
});

export default app;
