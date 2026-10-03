/*
 * Distance helpers for the Location Service: the great-circle distance between two points
 * (haversine) and the rounding rule the API uses so an exact location cannot be worked out.
 */

const EARTH_RADIUS_KM = 6371;
const MAX_LATITUDE = 90;
const MAX_LONGITUDE = 180;
// Longitude 180 is half a turn, which is pi radians.
const DEGREES_TO_RADIANS = Math.PI / MAX_LONGITUDE;
const HALF = 2;
/** Smallest distance the API shows, so a very close user is never shown as 0 km away. */
const MIN_DISTANCE_KM = 1;

/** A point on Earth, in degrees. */
export interface Coordinates {
  lat: number;
  lon: number;
}

function assertValidCoordinates(point: Coordinates): void {
  const isLatValid = Number.isFinite(point.lat) && Math.abs(point.lat) <= MAX_LATITUDE;
  const isLonValid = Number.isFinite(point.lon) && Math.abs(point.lon) <= MAX_LONGITUDE;
  if (!isLatValid || !isLonValid) {
    throw new RangeError(`Invalid coordinates: lat ${point.lat}, lon ${point.lon}`);
  }
}

/**
 * Compute the great-circle distance between two points (haversine formula).
 * @param from - first point, latitude/longitude in degrees
 * @param to - second point, latitude/longitude in degrees
 * @returns distance in kilometres, not rounded
 * @throws RangeError when a coordinate is not a number or is outside -90..90 / -180..180
 */
export function distanceKm(from: Coordinates, to: Coordinates): number {
  assertValidCoordinates(from);
  assertValidCoordinates(to);

  const fromLat = from.lat * DEGREES_TO_RADIANS;
  const toLat = to.lat * DEGREES_TO_RADIANS;
  const deltaLat = (to.lat - from.lat) * DEGREES_TO_RADIANS;
  const deltaLon = (to.lon - from.lon) * DEGREES_TO_RADIANS;

  const a =
    Math.sin(deltaLat / HALF) ** HALF +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLon / HALF) ** HALF;
  // Floating point error can push `a` slightly above 1 for opposite points.
  const clamped = Math.min(1, a);
  return EARTH_RADIUS_KM * HALF * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));
}

/**
 * Round a distance the way the API shows it: to the nearest whole km, never below 1.
 * @param km - distance in kilometres, for example from distanceKm or the Match Engine
 * @returns whole kilometres, at least 1
 */
export function roundDistanceKm(km: number): number {
  return Math.max(MIN_DISTANCE_KM, Math.round(km));
}
