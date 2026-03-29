import { expect } from '@playwright/test';
import {
  createAuthenticatedAdminPage,
  createAuthenticatedPage,
  test,
} from '../fixtures/auth';

test.describe('ログイン smoke', () => {
  test('一般ユーザーがダッシュボードへ到達できる', async ({ browser, baseURL }) => {
    const { context, page, account } = await createAuthenticatedPage(browser, baseURL!, 0);

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible();
    await expect(page.getByRole('link', { name: account.name })).toBeVisible();
    await expect(page.getByText(`ようこそ、${account.name} さん`)).toBeVisible();

    await context.close();
  });

  test('管理者が管理者ダッシュボードへ到達できる', async ({ browser, baseURL }) => {
    const { context, page, account } = await createAuthenticatedAdminPage(browser, baseURL!, 0);

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: '管理者ダッシュボード' })).toBeVisible();
    await expect(page.getByRole('link', { name: account.name })).toBeVisible();
    await expect(page.getByRole('link', { name: 'OpenClaw連携' }).first()).toBeVisible();

    await context.close();
  });
});
