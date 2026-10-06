/*
 * Tests for the Location Service: cache, shared in flight lookups, rate limiting, rounding of
 * the point sent to Nominatim, and failures that must not be cached. fetch is always fake.
 */
import { describe, expect, it } from "bun:test";

import { ApiError } from "../../src/plugins/errors";
import { createLocationService } from "../../src/services/location/locationService";
import { createRateLimiter } from "../../src/services/location/rateLimiter";
import { createMockFetch, jsonResponse } from "./mockFetch";

const BASE_URL = "http://nominatim.test";
const PATHUM_WAN_ANSWER = { address: { state: "Bangkok", city_district: "Pathum Wan" } };

describe("createLocationService", () => {
  it("returns the place name built from the address", async () => {
    const { fetch } = createMockFetch(() => jsonResponse(PATHUM_WAN_ANSWER));
    const service = createLocationService({ baseUrl: BASE_URL, fetch });

    expect(await service.findPlaceName(13.7466, 100.5347)).toBe("Pathum Wan, Bangkok");
  });

  it("answers the second call for the same area from the cache", async () => {
    const { fetch, calls } = createMockFetch(() => jsonResponse(PATHUM_WAN_ANSWER));
    const service = createLocationService({ baseUrl: BASE_URL, fetch });

    await service.findPlaceName(13.7466, 100.5347);
    const second = await service.findPlaceName(13.74661, 100.53469);

    expect(second).toBe("Pathum Wan, Bangkok");
    expect(calls).toHaveLength(1);
  });

  it("sends the rounded point to Nominatim", async () => {
    const { fetch, calls } = createMockFetch(() => jsonResponse(PATHUM_WAN_ANSWER));
    const service = createLocationService({ baseUrl: BASE_URL, fetch });

    await service.findPlaceName(13.746612345, 100.534698765);

    expect(calls[0]!.url.searchParams.get("lat")).toBe("13.747");
    expect(calls[0]!.url.searchParams.get("lon")).toBe("100.535");
  });

  it("makes one request for simultaneous calls for the same area", async () => {
    const { fetch, calls } = createMockFetch(() => jsonResponse(PATHUM_WAN_ANSWER));
    const service = createLocationService({ baseUrl: BASE_URL, fetch });

    const results = await Promise.all([
      service.findPlaceName(13.7466, 100.5347),
      service.findPlaceName(13.7466, 100.5347),
      service.findPlaceName(13.74662, 100.53468),
    ]);

    expect(results).toEqual(["Pathum Wan, Bangkok", "Pathum Wan, Bangkok", "Pathum Wan, Bangkok"]);
    expect(calls).toHaveLength(1);
  });

  it("caches the result when there is no place", async () => {
    const { fetch, calls } = createMockFetch(() => jsonResponse({ error: "Unable to geocode" }));
    const service = createLocationService({ baseUrl: BASE_URL, fetch });

    expect(await service.findPlaceName(0, 0)).toBeNull();
    expect(await service.findPlaceName(0, 0)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("returns null when the place has no province and no district", async () => {
    const { fetch } = createMockFetch(() => jsonResponse({ address: { country: "Thailand" } }));
    const service = createLocationService({ baseUrl: BASE_URL, fetch });

    expect(await service.findPlaceName(10, 100)).toBeNull();
  });

  it("does not cache a failure, so the next call tries again", async () => {
    let shouldFail = true;
    const { fetch, calls } = createMockFetch(() =>
      shouldFail ? jsonResponse({}, 500) : jsonResponse(PATHUM_WAN_ANSWER),
    );
    const service = createLocationService({ baseUrl: BASE_URL, fetch });

    await expect(service.findPlaceName(13.7466, 100.5347)).rejects.toBeInstanceOf(ApiError);
    shouldFail = false;

    expect(await service.findPlaceName(13.7466, 100.5347)).toBe("Pathum Wan, Bangkok");
    expect(calls).toHaveLength(2);
  });

  it("sends requests to Nominatim through the limiter, one second apart", async () => {
    const requestedWaits: number[] = [];
    const { fetch, calls } = createMockFetch(() => jsonResponse(PATHUM_WAN_ANSWER));
    // The clock stands still, so the waits show the slots: now, +1000 ms and +2000 ms.
    const limiter = createRateLimiter({
      minIntervalMs: 1000,
      maxWaitMs: 5000,
      now: () => 0,
      sleep: async (ms) => {
        requestedWaits.push(ms);
      },
    });
    const service = createLocationService({ baseUrl: BASE_URL, fetch, limiter });

    await Promise.all([
      service.findPlaceName(1, 1),
      service.findPlaceName(2, 2),
      service.findPlaceName(3, 3),
    ]);

    expect(calls).toHaveLength(3);
    expect(requestedWaits).toEqual([1000, 2000]);
  });

  it("answers GEOCODER_UNAVAILABLE when the queue is too long", async () => {
    const { fetch, calls } = createMockFetch(() => jsonResponse(PATHUM_WAN_ANSWER));
    const limiter = createRateLimiter({
      minIntervalMs: 1000,
      maxWaitMs: 1000,
      now: () => 0,
      sleep: async () => undefined,
    });
    const service = createLocationService({ baseUrl: BASE_URL, fetch, limiter });

    const results = await Promise.allSettled([
      service.findPlaceName(1, 1),
      service.findPlaceName(2, 2),
      service.findPlaceName(3, 3),
    ]);

    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled", "rejected"]);
    const rejection = results[2] as PromiseRejectedResult;
    expect(rejection.reason).toBeInstanceOf(ApiError);
    expect((rejection.reason as ApiError).code).toBe("GEOCODER_UNAVAILABLE");
    expect(calls).toHaveLength(2);
  });
});
