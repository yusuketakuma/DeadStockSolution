import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('postalCodeToCoordinates', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('returns coordinates for exact match', async () => {
    vi.doMock('fs', () => ({
      readFileSync: vi.fn().mockReturnValue(
        JSON.stringify({ '1000001': { lat: 35.6762, lng: 139.6503 } }),
      ),
    }));
    vi.doMock('../services/logger', () => ({
      logger: { warn: vi.fn() },
    }));
    const { postalCodeToCoordinates } = await import('../utils/postal-code');
    expect(postalCodeToCoordinates('1000001')).toEqual({ lat: 35.6762, lng: 139.6503 });
  });

  it('normalizes hyphen in postal code', async () => {
    vi.doMock('fs', () => ({
      readFileSync: vi.fn().mockReturnValue(
        JSON.stringify({ '1000001': { lat: 35.6762, lng: 139.6503 } }),
      ),
    }));
    vi.doMock('../services/logger', () => ({
      logger: { warn: vi.fn() },
    }));
    const { postalCodeToCoordinates } = await import('../utils/postal-code');
    expect(postalCodeToCoordinates('100-0001')).toEqual({ lat: 35.6762, lng: 139.6503 });
  });

  it('normalizes full-width dash in postal code', async () => {
    vi.doMock('fs', () => ({
      readFileSync: vi.fn().mockReturnValue(
        JSON.stringify({ '1000001': { lat: 35.6762, lng: 139.6503 } }),
      ),
    }));
    vi.doMock('../services/logger', () => ({
      logger: { warn: vi.fn() },
    }));
    const { postalCodeToCoordinates } = await import('../utils/postal-code');
    expect(postalCodeToCoordinates('100ー0001')).toEqual({ lat: 35.6762, lng: 139.6503 });
  });

  it('normalizes full-width hyphen-minus in postal code', async () => {
    vi.doMock('fs', () => ({
      readFileSync: vi.fn().mockReturnValue(
        JSON.stringify({ '1000001': { lat: 35.6762, lng: 139.6503 } }),
      ),
    }));
    vi.doMock('../services/logger', () => ({
      logger: { warn: vi.fn() },
    }));
    const { postalCodeToCoordinates } = await import('../utils/postal-code');
    expect(postalCodeToCoordinates('100－0001')).toEqual({ lat: 35.6762, lng: 139.6503 });
  });

  it('normalizes spaces in postal code', async () => {
    vi.doMock('fs', () => ({
      readFileSync: vi.fn().mockReturnValue(
        JSON.stringify({ '1000001': { lat: 35.6762, lng: 139.6503 } }),
      ),
    }));
    vi.doMock('../services/logger', () => ({
      logger: { warn: vi.fn() },
    }));
    const { postalCodeToCoordinates } = await import('../utils/postal-code');
    expect(postalCodeToCoordinates('100 0001')).toEqual({ lat: 35.6762, lng: 139.6503 });
  });

  it('falls back to prefix5 match when exact match not found', async () => {
    vi.doMock('fs', () => ({
      readFileSync: vi.fn().mockReturnValue(
        JSON.stringify({
          '1000002': { lat: 35.68, lng: 139.65 },
          '2000001': { lat: 36.0, lng: 140.0 },
        }),
      ),
    }));
    vi.doMock('../services/logger', () => ({
      logger: { warn: vi.fn() },
    }));
    const { postalCodeToCoordinates } = await import('../utils/postal-code');
    const result = postalCodeToCoordinates('1000099');
    expect(result).toEqual({ lat: 35.68, lng: 139.65 });
  });

  it('returns null when no match found', async () => {
    vi.doMock('fs', () => ({
      readFileSync: vi.fn().mockReturnValue(
        JSON.stringify({ '1000001': { lat: 35.6762, lng: 139.6503 } }),
      ),
    }));
    vi.doMock('../services/logger', () => ({
      logger: { warn: vi.fn() },
    }));
    const { postalCodeToCoordinates } = await import('../utils/postal-code');
    expect(postalCodeToCoordinates('9999999')).toBeNull();
  });

  it('returns null and logs warning when file not found', async () => {
    const warnFn = vi.fn();
    vi.doMock('fs', () => ({
      readFileSync: vi.fn().mockImplementation(() => {
        throw new Error('ENOENT');
      }),
    }));
    vi.doMock('../services/logger', () => ({
      logger: { warn: warnFn },
    }));
    const { postalCodeToCoordinates } = await import('../utils/postal-code');
    expect(postalCodeToCoordinates('1000001')).toBeNull();
    expect(warnFn).toHaveBeenCalledWith(
      'postal-geocode.json not found, geocoding will be unavailable',
    );
  });

  it('empty postal code falls through to prefix5 match (startsWith empty is always true)', async () => {
    vi.doMock('fs', () => ({
      readFileSync: vi.fn().mockReturnValue(
        JSON.stringify({ '1000001': { lat: 35.6762, lng: 139.6503 } }),
      ),
    }));
    vi.doMock('../services/logger', () => ({
      logger: { warn: vi.fn() },
    }));
    const { postalCodeToCoordinates } = await import('../utils/postal-code');
    expect(postalCodeToCoordinates('')).toEqual({ lat: 35.6762, lng: 139.6503 });
  });

  it('empty postal code returns null when data is empty', async () => {
    vi.doMock('fs', () => ({
      readFileSync: vi.fn().mockReturnValue(JSON.stringify({})),
    }));
    vi.doMock('../services/logger', () => ({
      logger: { warn: vi.fn() },
    }));
    const { postalCodeToCoordinates } = await import('../utils/postal-code');
    expect(postalCodeToCoordinates('')).toBeNull();
  });

  it('returns null when data is empty and no prefix match exists', async () => {
    vi.doMock('fs', () => ({
      readFileSync: vi.fn().mockReturnValue(JSON.stringify({})),
    }));
    vi.doMock('../services/logger', () => ({
      logger: { warn: vi.fn() },
    }));
    const { postalCodeToCoordinates } = await import('../utils/postal-code');
    expect(postalCodeToCoordinates('1000001')).toBeNull();
  });

  it('handles multiple entries matching the same prefix5', async () => {
    vi.doMock('fs', () => ({
      readFileSync: vi.fn().mockReturnValue(
        JSON.stringify({
          '1000010': { lat: 35.67, lng: 139.64 },
          '1000020': { lat: 35.68, lng: 139.65 },
        }),
      ),
    }));
    vi.doMock('../services/logger', () => ({
      logger: { warn: vi.fn() },
    }));
    const { postalCodeToCoordinates } = await import('../utils/postal-code');
    const result = postalCodeToCoordinates('1000099');
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('lat');
    expect(result).toHaveProperty('lng');
  });

  it('prefers exact match over prefix5 match', async () => {
    vi.doMock('fs', () => ({
      readFileSync: vi.fn().mockReturnValue(
        JSON.stringify({
          '1000001': { lat: 35.6762, lng: 139.6503 },
          '1000002': { lat: 99.0, lng: 99.0 },
        }),
      ),
    }));
    vi.doMock('../services/logger', () => ({
      logger: { warn: vi.fn() },
    }));
    const { postalCodeToCoordinates } = await import('../utils/postal-code');
    expect(postalCodeToCoordinates('1000001')).toEqual({ lat: 35.6762, lng: 139.6503 });
  });

  it('postal code with only dashes normalizes to empty and matches first entry via prefix5', async () => {
    vi.doMock('fs', () => ({
      readFileSync: vi.fn().mockReturnValue(
        JSON.stringify({ '1000001': { lat: 35.6762, lng: 139.6503 } }),
      ),
    }));
    vi.doMock('../services/logger', () => ({
      logger: { warn: vi.fn() },
    }));
    const { postalCodeToCoordinates } = await import('../utils/postal-code');
    expect(postalCodeToCoordinates('---')).toEqual({ lat: 35.6762, lng: 139.6503 });
  });

  it('readFileSync is called with correct file path', async () => {
    const readFileSyncMock = vi.fn().mockReturnValue(JSON.stringify({}));
    vi.doMock('fs', () => ({
      readFileSync: readFileSyncMock,
    }));
    vi.doMock('../services/logger', () => ({
      logger: { warn: vi.fn() },
    }));
    const { postalCodeToCoordinates } = await import('../utils/postal-code');
    postalCodeToCoordinates('1000001');
    expect(readFileSyncMock).toHaveBeenCalledTimes(1);
    const calledPath = readFileSyncMock.mock.calls[0][0] as string;
    expect(calledPath).toContain('postal-geocode.json');
    expect(readFileSyncMock.mock.calls[0][1]).toBe('utf-8');
  });
});
