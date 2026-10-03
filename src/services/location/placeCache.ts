/*
 * In memory cache for place names. Keys are coordinates rounded to 3 decimal places (about
 * 100 m) plus the language. The cache is bounded and entries expire, so memory stays small
 * even when many different points are asked for.
 */

const COORDINATE_DECIMALS = 3;
const DECIMAL_BASE = 10;

/** What the cache holds: a place name, or null when Nominatim knows no place for the point. */
export type CachedPlace = string | null;

/** Settings for createPlaceCache. `now` can be replaced in tests. */
export interface PlaceCacheOptions {
  maxEntries: number;
  ttlMs: number;
  now?: () => number;
}

/** A bounded cache with expiry. `get` returns undefined when the key is missing or expired. */
export interface PlaceCache {
  get(key: string): CachedPlace | undefined;
  set(key: string, value: CachedPlace): void;
}

/**
 * Round a coordinate to the precision used for cache keys and Nominatim requests.
 * @param value - latitude or longitude in degrees
 * @returns the value with 3 decimal places; never -0
 */
export function roundCoordinate(value: number): number {
  const factor = DECIMAL_BASE ** COORDINATE_DECIMALS;
  // Adding 0 turns -0 into 0, so "-0.0001" and "0.0001" share one key.
  return Math.round(value * factor) / factor + 0;
}

/**
 * Build the cache key for a point.
 * @param lat - latitude in degrees
 * @param lon - longitude in degrees
 * @param language - language of the place name, for example "en"
 * @returns a key that is the same for points less than about 100 m apart
 */
export function buildCacheKey(lat: number, lon: number, language: string): string {
  return `${roundCoordinate(lat)}:${roundCoordinate(lon)}:${language}`;
}

/**
 * Create an empty place cache.
 * @param options - size limit, time to live and an optional clock
 * @returns the cache; the oldest entry is dropped when the size limit is reached
 */
export function createPlaceCache(options: PlaceCacheOptions): PlaceCache {
  const now = options.now ?? Date.now;
  const entries = new Map<string, { value: CachedPlace; expiresAt: number }>();

  return {
    /**
     * Look up a key.
     * @param key - key from buildCacheKey
     * @returns the cached value (a name or null), or undefined when missing or expired
     */
    get(key) {
      const entry = entries.get(key);
      if (entry === undefined) {
        return undefined;
      }
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },

    /**
     * Store a result.
     * @param key - key from buildCacheKey
     * @param value - the place name, or null when there is no place
     */
    set(key, value) {
      entries.delete(key);
      if (entries.size >= options.maxEntries) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey !== undefined) {
          entries.delete(oldestKey);
        }
      }
      entries.set(key, { value, expiresAt: now() + options.ttlMs });
    },
  };
}
