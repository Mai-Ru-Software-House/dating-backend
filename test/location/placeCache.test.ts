/*
 * Tests for the place cache: key rounding, expiry, size limit and storing "no place".
 */
import { describe, expect, it } from "bun:test";

import {
  buildCacheKey,
  createPlaceCache,
  roundCoordinate,
} from "../../src/services/location/placeCache";

function createCache(maxEntries = 10, ttlMs = 1000) {
  let current = 0;
  const cache = createPlaceCache({ maxEntries, ttlMs, now: () => current });
  return {
    cache,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("buildCacheKey", () => {
  it("rounds to 3 decimal places", () => {
    expect(buildCacheKey(13.75631, 100.50184, "en")).toBe(buildCacheKey(13.7563, 100.5018, "en"));
    expect(buildCacheKey(13.7563, 100.5018, "en")).not.toBe(buildCacheKey(13.7573, 100.5018, "en"));
  });

  it("treats -0 and 0 as the same value", () => {
    expect(roundCoordinate(-0.0001)).toBe(0);
    expect(buildCacheKey(-0.0001, 0, "en")).toBe(buildCacheKey(0, 0.0001, "en"));
  });

  it("includes the language", () => {
    expect(buildCacheKey(1, 2, "en")).not.toBe(buildCacheKey(1, 2, "th"));
  });
});

describe("createPlaceCache", () => {
  it("returns a stored name", () => {
    const { cache } = createCache();
    cache.set("a", "Bangkok, Pathum Wan");
    expect(cache.get("a")).toBe("Bangkok, Pathum Wan");
  });

  it("returns undefined for a missing key", () => {
    const { cache } = createCache();
    expect(cache.get("missing")).toBeUndefined();
  });

  it("stores null as a real result", () => {
    const { cache } = createCache();
    cache.set("sea", null);
    expect(cache.get("sea")).toBeNull();
  });

  it("forgets entries after the time to live", () => {
    const { cache, advance } = createCache(10, 1000);
    cache.set("a", "Bangkok");
    advance(999);
    expect(cache.get("a")).toBe("Bangkok");
    advance(1);
    expect(cache.get("a")).toBeUndefined();
  });

  it("drops the oldest entry when full", () => {
    const { cache } = createCache(2);
    cache.set("a", "A");
    cache.set("b", "B");
    cache.set("c", "C");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("B");
    expect(cache.get("c")).toBe("C");
  });

  it("does not drop another entry when an existing key is replaced", () => {
    const { cache } = createCache(2);
    cache.set("a", "A");
    cache.set("b", "B");
    cache.set("b", "B2");
    expect(cache.get("a")).toBe("A");
    expect(cache.get("b")).toBe("B2");
  });
});
