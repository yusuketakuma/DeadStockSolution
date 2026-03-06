import { logger } from './logger';
import { FetchTimeoutError, fetchWithTimeout } from '../utils/http-utils';
import { isRecord } from '../utils/type-guards';

interface GeocodeResult {
  lat: number;
  lng: number;
}

type GeocodeFeature = {
  geometry: {
    coordinates: [number, number];
  };
};

const GEOCODE_TIMEOUT_MS = 5000;

function summarizeAddressForLog(address: string): string {
  const trimmed = address.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.length <= 4) {
    return `${trimmed.slice(0, 1)}***`;
  }
  return `${trimmed.slice(0, 2)}***(${trimmed.length})`;
}

function extractCoordinates(value: unknown): { lat: number; lng: number } | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const first = value[0];
  if (!isRecord(first)) {
    return null;
  }

  const geometry = first.geometry;
  if (!isRecord(geometry) || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) {
    return null;
  }

  const [lng, lat] = geometry.coordinates as GeocodeFeature['geometry']['coordinates'];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng };
}

/**
 * 住所文字列から緯度・経度を取得する（国土地理院 API）
 * https://msearch.gsi.go.jp/address-search/AddressSearch?q=<住所>
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const query = address.trim();
  if (!query) return null;
  const addressSummary = summarizeAddressForLog(query);

  const url = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query)}`;

  try {
    const response = await fetchWithTimeout(url, {
      timeoutMs: GEOCODE_TIMEOUT_MS,
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      logger.warn('Geocoding API returned non-OK status', { status: response.status, addressSummary });
      return null;
    }

    const data: unknown = await response.json();
    const coordinates = extractCoordinates(data);
    if (!coordinates) {
      logger.info('Geocoding returned no results', { addressSummary });
      return null;
    }

    return coordinates;
  } catch (err) {
    if (err instanceof FetchTimeoutError || (err instanceof DOMException && err.name === 'AbortError')) {
      logger.warn('Geocoding request timed out', { addressSummary });
    } else {
      logger.error('Geocoding request failed', {
        addressSummary,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  }
}
