import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

export function haversineDistance(
  lat1: number | SQL,
  lon1: number | SQL,
  lat2: number | SQL,
  lon2: number | SQL
): SQL<number> {
  return sql`haversine_distance(${lat1}, ${lon1}, ${lat2}, ${lon2})`;
}

export function haversineDistanceKm(
  lat1: number | SQL,
  lon1: number | SQL,
  lat2: number | SQL,
  lon2: number | SQL,
  maxDistanceKm: number | SQL
): SQL<boolean> {
  return sql`haversine_distance_km(${lat1}, ${lon1}, ${lat2}, ${lon2}, ${maxDistanceKm})`;
}
