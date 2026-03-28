import { type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test as base, expect } from '@playwright/test';

export interface TestPharmacyAccount {
  id: number;
  name: string;
  email: string;
  prefecture: string;
  password: string;
}

interface TestPharmacyResponse {
  accounts: Array<{
    id: number;
    name: string;
    email: string;
    prefecture: string;
    password: string;
  }>;
}

async function fetchTestPharmacyAccounts(request: APIRequestContext): Promise<TestPharmacyAccount[]> {
  const response = await request.get('/api/auth/test-pharmacies?includePassword=1');
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as TestPharmacyResponse;
  return (payload.accounts ?? [])
    .filter((account) => typeof account.password === 'string' && account.password.length > 0)
    .map((account) => ({
      ...account,
      password: account.password,
    }));
}

export async function loginAsTestPharmacy(page: Page, accountIndex = 0): Promise<TestPharmacyAccount> {
  const accounts = await fetchTestPharmacyAccounts(page.request);
  expect(accounts.length).toBeGreaterThan(accountIndex);

  const account = accounts[accountIndex];
  const response = await page.request.post('/api/auth/login', {
    data: {
      email: account.email,
      password: account.password,
    },
  });

  expect(response.ok()).toBeTruthy();
  await page.goto('/');
  return account;
}

export async function createAuthenticatedPage(
  browser: Browser,
  baseURL: string,
  accountIndex = 0,
): Promise<{ context: BrowserContext; page: Page; account: TestPharmacyAccount }> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const account = await loginAsTestPharmacy(page, accountIndex);
  return { context, page, account };
}

export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, use) => {
    await loginAsTestPharmacy(page, 0);
    await use(page);
  },
});

export { expect };
