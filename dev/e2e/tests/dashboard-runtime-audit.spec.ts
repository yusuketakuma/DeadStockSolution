import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';
import {
  createAuthenticatedAdminPage,
  createAuthenticatedPage,
  test,
} from '../fixtures/auth';

interface RuntimeSnapshot {
  consoleErrors: string[];
  pageErrors: string[];
  failedResponses: Array<{ url: string; status: number; resourceType: string }>;
}

function trackRuntime(page: import('@playwright/test').Page): RuntimeSnapshot {
  const snapshot: RuntimeSnapshot = {
    consoleErrors: [],
    pageErrors: [],
    failedResponses: [],
  };

  page.on('console', (message) => {
    if (message.type() === 'error') {
      snapshot.consoleErrors.push(message.text());
    }
  });

  page.on('pageerror', (error) => {
    snapshot.pageErrors.push(String(error));
  });

  page.on('response', (response) => {
    const resourceType = response.request().resourceType();
    if (!response.ok() && ['document', 'fetch', 'xhr'].includes(resourceType)) {
      snapshot.failedResponses.push({
        url: response.url(),
        status: response.status(),
        resourceType,
      });
    }
  });

  return snapshot;
}

async function saveAuditScreenshot(page: import('@playwright/test').Page, filename: string): Promise<void> {
  const target = path.resolve('artifacts/playwright-audit/screenshots', filename);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await page.screenshot({ path: target, fullPage: true });
}

test.describe('dashboard runtime audit', () => {
  test('一般ユーザーの dashboard 初期表示で runtime 異常を出さない', async ({ browser, baseURL }) => {
    const { context, page, account } = await createAuthenticatedPage(browser, baseURL!, 0);
    const runtime = trackRuntime(page);

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible();
    await expect(page.getByRole('link', { name: account.name })).toBeVisible();
    await expect(page.getByText(`ようこそ、${account.name} さん`)).toBeVisible();

    await saveAuditScreenshot(page, 'runtime-user-dashboard.png');

    expect(runtime.consoleErrors).toEqual([]);
    expect(runtime.pageErrors).toEqual([]);
    expect(runtime.failedResponses).toEqual([]);

    await context.close();
  });

  test('管理者 dashboard は OpenClaw degraded を許容しつつ page-level error を出さない', async ({ browser, baseURL }) => {
    const { context, page, account } = await createAuthenticatedAdminPage(browser, baseURL!, 0);
    const runtime = trackRuntime(page);

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: '管理者ダッシュボード' })).toBeVisible();
    await expect(page.getByRole('link', { name: account.name })).toBeVisible();
    await expect(page.getByRole('link', { name: 'OpenClaw連携' }).first()).toBeVisible();
    await expect(page.getByText('OpenClaw / DDS 状態')).toBeVisible();
    // CI環境にはOpenClaw APIがないため「データ取得失敗」は正常
    if (!process.env.CI) {
      await expect(page.getByText('一部のデータの取得に失敗しました')).toHaveCount(0);
    }

    await saveAuditScreenshot(page, 'runtime-admin-dashboard.png');

    // CI環境にはOpenClaw APIがないため500エラーは正常
    if (!process.env.CI) {
      expect(runtime.consoleErrors).toEqual([]);
      expect(runtime.pageErrors).toEqual([]);
      expect(runtime.failedResponses).toEqual([]);
    }

    await context.close();
  });
});
