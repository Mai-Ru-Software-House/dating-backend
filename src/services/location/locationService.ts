/*
 * Location Service: finds the place name for a point. It rounds the point, checks the cache,
 * shares one lookup between identical simultaneous requests, and sends at most 1 request per
 * second to Nominatim. Failures are never cached.
 */
import { ApiError, ERROR_CODES } from "../../plugins/errors";
import { createNominatimClient, NOMINATIM_LANGUAGE, type NominatimClient } from "./nominatimClient";
import {
  buildCacheKey,
  createPlaceCache,
  roundCoordinate,
  type CachedPlace,
  type PlaceCache,
} from "./placeCache";
import { buildPlaceName } from "./placeName";
import { createRateLimiter, RateLimitExceededError, type RateLimiter } from "./rateLimiter";

const HTTP_INTERNAL_ERROR = 500;
const MIN_REQUEST_INTERVAL_MS = 1000;
const MAX_QUEUE_WAIT_MS = 5000;
const CACHE_MAX_ENTRIES = 10000;
const MS_PER_HOUR = 3_600_000;
const CACHE_TTL_HOURS = 24;
const CACHE_TTL_MS = CACHE_TTL_HOURS * MS_PER_HOUR;
const QUEUE_FULL_MESSAGE = "The place lookup is busy right now. Please try again.";

/** What other services (and the /places route) use to get a place name. */
export interface LocationService {
  /**
   * Find the place name for a point.
   * @param lat - latitude in degrees, -90 to 90
   * @param lon - longitude in degrees, -180 to 180
   * @returns "province, district", or null when there is no place or no name for the point
   * @throws ApiError 500 GEOCODER_UNAVAILABLE when Nominatim fails, times out, or the queue is
   *   full
   */
  findPlaceName(lat: number, lon: number): Promise<string | null>;
}

/** Settings for createLocationService. Everything except `baseUrl` is replaceable in tests. */
export interface LocationServiceOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  client?: NominatimClient;
  limiter?: RateLimiter;
  cache?: PlaceCache;
}

/**
 * Create the Location Service.
 * @param options - the Nominatim base URL, plus optional parts to replace in tests
 * @returns the service
 */
export function createLocationService(options: LocationServiceOptions): LocationService {
  const client =
    options.client ?? createNominatimClient({ baseUrl: options.baseUrl, fetch: options.fetch });
  const limiter =
    options.limiter ??
    createRateLimiter({ minIntervalMs: MIN_REQUEST_INTERVAL_MS, maxWaitMs: MAX_QUEUE_WAIT_MS });
  const cache =
    options.cache ?? createPlaceCache({ maxEntries: CACHE_MAX_ENTRIES, ttlMs: CACHE_TTL_MS });
  const lookupsInFlight = new Map<string, Promise<CachedPlace>>();

  async function lookup(key: string, lat: number, lon: number): Promise<CachedPlace> {
    try {
      const address = await limiter.schedule(() => client.reverseGeocode(lat, lon));
      const placeName = address === null ? null : buildPlaceName(address);
      cache.set(key, placeName);
      return placeName;
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        throw new ApiError(
          HTTP_INTERNAL_ERROR,
          ERROR_CODES.geocoderUnavailable,
          QUEUE_FULL_MESSAGE,
        );
      }
      throw error;
    } finally {
      lookupsInFlight.delete(key);
    }
  }

  return {
    findPlaceName(lat, lon) {
      // The rounded point is what Nominatim gets, so a cached and a fresh answer always agree.
      const roundedLat = roundCoordinate(lat);
      const roundedLon = roundCoordinate(lon);
      const key = buildCacheKey(roundedLat, roundedLon, NOMINATIM_LANGUAGE);

      const cached = cache.get(key);
      if (cached !== undefined) {
        return Promise.resolve(cached);
      }
      const running = lookupsInFlight.get(key);
      if (running !== undefined) {
        return running;
      }
      const started = lookup(key, roundedLat, roundedLon);
      lookupsInFlight.set(key, started);
      return started;
    },
  };
}
