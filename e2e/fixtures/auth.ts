import { type Page } from '@playwright/test';
import { test as base, expect } from '@playwright/test';

// テスト用認証の基盤（storageState を使ったセッション永続化）
export const test = base.extend<{ authenticatedPage: Page }>({
  // 将来の認証ヘルパー
});

export { expect };
