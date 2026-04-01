export interface SeedTestPharmacyAccount {
  id?: number;
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

export interface SeedPayload {
  accounts: SeedTestPharmacyAccount[];
}

export const DEFAULT_TEST_PHARMACY_SEED_PAYLOAD: SeedPayload = {
  accounts: [
    {
      id: 1001,
      name: 'E2E テスト薬局A',
      email: 'e2e-pharmacy-a@example.com',
      password: 'Password123!',
      postalCode: '1000001',
      address: '東京都千代田区千代田1-1',
      phone: '03-0000-0001',
      fax: '03-0000-0002',
      licenseNumber: 'E2E-LIC-A',
      prefecture: '東京都',
      latitude: 35.6804,
      longitude: 139.7690,
    },
    {
      id: 1002,
      name: 'E2E テスト薬局B',
      email: 'e2e-pharmacy-b@example.com',
      password: 'Password123!',
      postalCode: '5300001',
      address: '大阪府大阪市北区梅田1-1',
      phone: '06-0000-0001',
      fax: '06-0000-0002',
      licenseNumber: 'E2E-LIC-B',
      prefecture: '大阪府',
      latitude: 34.7025,
      longitude: 135.4959,
    },
  ],
};

