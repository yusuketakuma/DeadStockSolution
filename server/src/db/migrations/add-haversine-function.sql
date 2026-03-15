-- Haversine distance calculation function (pure SQL, no PostGIS required)
-- Calculates great-circle distance between two points on Earth in kilometers
-- Parameters: lat1, lon1, lat2, lon2 (all in degrees)
-- Returns: distance in kilometers

CREATE OR REPLACE FUNCTION haversine_distance(
  lat1 double precision,
  lon1 double precision,
  lat2 double precision,
  lon2 double precision
) RETURNS double precision AS $$
  SELECT 6371 * 2 * ASIN(SQRT(
    SIN(RADIANS(lat2 - lat1) / 2) ^ 2 +
    COS(RADIANS(lat1)) * COS(RADIANS(lat2)) * SIN(RADIANS(lon2 - lon1) / 2) ^ 2
  ))
$$ LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE;

-- Create index-friendly version for use in WHERE clauses
CREATE OR REPLACE FUNCTION haversine_distance_km(
  lat1 double precision,
  lon1 double precision,
  lat2 double precision,
  lon2 double precision,
  max_distance_km double precision
) RETURNS boolean AS $$
  SELECT haversine_distance(lat1, lon1, lat2, lon2) <= max_distance_km
$$ LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE;
