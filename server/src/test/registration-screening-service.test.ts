import { describe, expect, it } from 'vitest';
import { evaluateRegistrationScreening } from '../services/registration-screening-service';

describe('registration-screening-service', () => {
  it('approves when license/name/address all match permit fields', () => {
    const result = evaluateRegistrationScreening({
      pharmacyName: '中央薬局',
      prefecture: '東京都',
      address: '千代田区1-1-1',
      licenseNumber: 'A-12345',
      permitLicenseNumber: 'A12345',
      permitPharmacyName: '中央薬局',
      permitAddress: '東京都千代田区1-1-1',
    });

    expect(result.approved).toBe(true);
    expect(result.screeningScore).toBe(100);
    expect(result.mismatches).toEqual([]);
  });

  it('rejects when permit license number does not match', () => {
    const result = evaluateRegistrationScreening({
      pharmacyName: '中央薬局',
      prefecture: '東京都',
      address: '千代田区1-1-1',
      licenseNumber: 'A-12345',
      permitLicenseNumber: 'B-98765',
      permitPharmacyName: '中央薬局',
      permitAddress: '東京都千代田区1-1-1',
    });

    expect(result.approved).toBe(false);
    expect(result.screeningScore).toBeLessThan(80);
    expect(result.mismatches).toContain('薬局開設許可番号が一致しません');
  });
});
