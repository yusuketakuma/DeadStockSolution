import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const originalFetch = global.fetch;
const fetchMock = vi.fn();

import { geocodeAddress } from '../services/geocode-service';
import { FetchTimeoutError } from '../utils/http-utils';
import { logger } from '../services/logger';

describe('geocode-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('returns null for empty address', async () => {
    const result = await geocodeAddress('');

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null for whitespace-only address', async () => {
    const result = await geocodeAddress('   ');

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns coordinates for valid address', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{
        geometry: { coordinates: [139.76, 35.68] },
        properties: { title: '東京都千代田区' },
      }],
    });

    const result = await geocodeAddress('東京都千代田区');

    expect(result).toEqual({ lat: 35.68, lng: 139.76 });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('msearch.gsi.go.jp'),
      expect.objectContaining({
        headers: { Accept: 'application/json' },
      }),
    );
  });

  it('returns null when API returns non-OK status', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
    });

    const result = await geocodeAddress('東京都千代田区');

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      'Geocoding API returned non-OK status',
      expect.objectContaining({ addressSummary: '東京***(7)' }),
    );
  });

  it('returns null when API returns empty results', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    const result = await geocodeAddress('存在しない住所');

    expect(result).toBeNull();
  });

  it('returns null when API returns non-array', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ error: 'invalid' }),
    });

    const result = await geocodeAddress('東京都千代田区');

    expect(result).toBeNull();
  });

  it('returns null when coordinates are not finite numbers', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{
        geometry: { coordinates: [NaN, Infinity] },
        properties: { title: 'test' },
      }],
    });

    const result = await geocodeAddress('テスト住所');

    expect(result).toBeNull();
  });

  it('returns null on fetch error', async () => {
    fetchMock.mockRejectedValue(new Error('Network error'));

    const result = await geocodeAddress('東京都千代田区');

    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      'Geocoding request failed',
      expect.objectContaining({ addressSummary: '東京***(7)' }),
    );
  });

  it('returns null on abort timeout', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    fetchMock.mockRejectedValue(abortError);

    const result = await geocodeAddress('東京都千代田区');

    expect(result).toBeNull();
  });

  it('returns null when the first result is missing a coordinate tuple', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ geometry: { coordinates: ['139.76'] } }],
    });

    const result = await geocodeAddress('東京都千代田区');

    expect(result).toBeNull();
  });

  it('returns null on fetch timeout helper error', async () => {
    fetchMock.mockRejectedValue(new FetchTimeoutError('request timed out'));

    const result = await geocodeAddress('東京都千代田区');

    expect(result).toBeNull();
  });
});
