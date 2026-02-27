export interface TestPharmacyDemoAccount {
  id: number;
  name: string;
  email: string;
  password: string;
  postalCode: string;
  address: string;
  phone: string;
  fax: string;
  licenseNumber: string;
  prefecture: string;
  latitude: number;
  longitude: number;
}

export const TEST_PHARMACY_DEMO_ACCOUNTS: TestPharmacyDemoAccount[] = [
  {
    id: 1,
    name: 'テスト薬局東京店',
    email: 'test-tokyo@example.com',
    password: 'TokyoDemo!2026',
    postalCode: '1000005',
    address: '千代田区丸の内1丁目',
    phone: '03-4589-1207',
    fax: '03-4589-1208',
    licenseNumber: 'TEST-TOKYO-001',
    prefecture: '東京都',
    latitude: 35.681236,
    longitude: 139.767125,
  },
  {
    id: 2,
    name: 'テスト薬局札幌店',
    email: 'test-sapporo@example.com',
    password: 'SapporoDemo!2026',
    postalCode: '0600806',
    address: '札幌市北区北6条西4丁目',
    phone: '011-214-3307',
    fax: '011-214-3308',
    licenseNumber: 'TEST-SAPPORO-001',
    prefecture: '北海道',
    latitude: 43.068661,
    longitude: 141.350755,
  },
  {
    id: 3,
    name: 'テスト薬局大阪店',
    email: 'test-osaka@example.com',
    password: 'OsakaDemo!2026',
    postalCode: '5300001',
    address: '大阪市北区梅田3丁目1-1',
    phone: '06-6133-7201',
    fax: '06-6133-7202',
    licenseNumber: 'TEST-OSAKA-001',
    prefecture: '大阪府',
    latitude: 34.702485,
    longitude: 135.495951,
  },
  {
    id: 4,
    name: 'テスト薬局福岡店',
    email: 'test-fukuoka@example.com',
    password: 'FukuokaDemo!2026',
    postalCode: '8120012',
    address: '福岡市博多区博多駅中央街1-1',
    phone: '092-402-8813',
    fax: '092-402-8814',
    licenseNumber: 'TEST-FUKUOKA-001',
    prefecture: '福岡県',
    latitude: 33.590355,
    longitude: 130.420137,
  },
  {
    id: 5,
    name: 'テスト薬局那覇店',
    email: 'test-naha@example.com',
    password: 'NahaDemo!2026',
    postalCode: '9010142',
    address: '那覇市鏡水150',
    phone: '098-917-4415',
    fax: '098-917-4416',
    licenseNumber: 'TEST-NAHA-001',
    prefecture: '沖縄県',
    latitude: 26.2065,
    longitude: 127.6469,
  },
];

export const TEST_PHARMACY_PASSWORD_BY_EMAIL = new Map(
  TEST_PHARMACY_DEMO_ACCOUNTS.map((account) => [account.email.toLowerCase(), account.password]),
);
