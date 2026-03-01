import { logger } from './logger';

interface GeocodeResult {
  lat: number;
  lng: number;
}

const GEOCODE_TIMEOUT_MS = 5000;

/**
 * 住所文字列から緯度・経度を取得する（国土地理院 API）
 * https://msearch.gsi.go.jp/address-search/AddressSearch?q=<住所>
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const query = address.trim();
  if (!query) return null;

  const url = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      logger.warn('Geocoding API returned non-OK status', { status: response.status, address: query });
      return null;
    }

    const data = await response.json() as Array<{
      geometry: { coordinates: [number, number] };
      properties: { title: string };
    }>;

    if (!Array.isArray(data) || data.length === 0) {
      logger.info('Geocoding returned no results', { address: query });
      return null;
    }

    // coordinates are [lng, lat] in GeoJSON format
    const [lng, lat] = data[0].geometry.coordinates;

    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      logger.warn('Geocoding returned invalid coordinates', { address: query, lat, lng });
      return null;
    }

    return { lat, lng };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      logger.warn('Geocoding request timed out', { address: query });
    } else {
      logger.error('Geocoding request failed', {
        address: query,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
