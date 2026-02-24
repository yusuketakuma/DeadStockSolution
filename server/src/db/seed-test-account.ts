import 'dotenv/config';
import { ensureTestAccount, getAllTestAccounts } from '../services/test-account-service';

async function seed() {
  console.log('Seeding test accounts...');

  for (const account of getAllTestAccounts()) {
    const user = await ensureTestAccount(account);
    console.log(`  [ok] ${user.email}`);
  }

  console.log('Done.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
