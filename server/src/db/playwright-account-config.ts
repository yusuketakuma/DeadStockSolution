export type PlaywrightAccountMode = 'user' | 'admin';

export interface PlaywrightSeedAccount {
  mode: PlaywrightAccountMode;
  email: string;
  password: string;
  name: string;
  postalCode: string;
  address: string;
  phone: string;
  fax: string;
  licenseNumber: string;
  prefecture: string;
  latitude: number;
  longitude: number;
}

export const PLAYWRIGHT_SEED_ACCOUNTS: PlaywrightSeedAccount[] = [
  {
    mode: 'user',
    email: 'playwright-user@example.com',
    password: 'PlaywrightUser!2026',
    name: 'Playwright 検証薬局',
    postalCode: '1500001',
    address: '東京都渋谷区神宮前1-1-1',
    phone: '03-1111-0001',
    fax: '03-1111-0002',
    licenseNumber: 'PLAYWRIGHT-USER-001',
    prefecture: '東京都',
    latitude: 35.6702,
    longitude: 139.7026,
  },
  {
    mode: 'admin',
    email: 'playwright-admin@example.com',
    password: 'PlaywrightAdmin!2026',
    name: 'Playwright 検証管理者',
    postalCode: '1000001',
    address: '東京都千代田区千代田1-1',
    phone: '03-2222-0001',
    fax: '03-2222-0002',
    licenseNumber: 'PLAYWRIGHT-ADMIN-001',
    prefecture: '東京都',
    latitude: 35.6850,
    longitude: 139.7528,
  },
];
