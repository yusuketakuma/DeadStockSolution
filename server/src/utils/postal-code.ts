import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../services/logger';

interface PostalGeocode {
  [postalCode: string]: { lat: number; lng: number };
}

let postalData: PostalGeocode | null = null;

function loadPostalData(): PostalGeocode {
  if (postalData) return postalData;
  const filePath = path.join(__dirname, '../../data/postal-geocode.json');
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    postalData = JSON.parse(raw);
    return postalData!;
  } catch {
    logger.warn('postal-geocode.json not found, geocoding will be unavailable');
    postalData = {};
    return postalData;
  }
}

export function postalCodeToCoordinates(postalCode: string): { lat: number; lng: number } | null {
  const normalized = postalCode.replace(/[-ー－\s]/g, '');
  const data = loadPostalData();

  if (data[normalized]) {
    return data[normalized];
  }

  // Try first 5 digits as a fallback (area-level)
  const prefix5 = normalized.substring(0, 5);
  for (const key of Object.keys(data)) {
    if (key.startsWith(prefix5)) {
      return data[key];
    }
  }

  return null;
}
