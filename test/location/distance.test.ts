/*
 * Tests for the distance helpers: haversine distance and the whole km rounding rule.
 */
import { describe, expect, it } from "bun:test";

import { distanceKm, roundDistanceKm } from "../../src/services/location/distance";

const BANGKOK = { lat: 13.7563, lon: 100.5018 };

describe("distanceKm", () => {
  it("is 0 for the same point", () => {
    expect(distanceKm(BANGKOK, BANGKOK)).toBe(0);
  });

  it("is about 111.2 km for one degree of latitude", () => {
    const km = distanceKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    expect(km).toBeCloseTo(111.19, 1);
  });

  it("is about 20015 km between opposite points", () => {
    const km = distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 });
    expect(km).toBeCloseTo(20015.09, 0);
  });

  it("gives the same result in both directions", () => {
    const chiangMai = { lat: 18.7883, lon: 98.9853 };
    expect(distanceKm(BANGKOK, chiangMai)).toBeCloseTo(distanceKm(chiangMai, BANGKOK), 9);
  });

  it("measures Bangkok to Chiang Mai as about 580 km", () => {
    const km = distanceKm(BANGKOK, { lat: 18.7883, lon: 98.9853 });
    expect(km).toBeGreaterThan(570);
    expect(km).toBeLessThan(590);
  });

  it("throws RangeError for coordinates that are not valid", () => {
    expect(() => distanceKm({ lat: 91, lon: 0 }, BANGKOK)).toThrow(RangeError);
    expect(() => distanceKm(BANGKOK, { lat: 0, lon: -181 })).toThrow(RangeError);
    expect(() => distanceKm({ lat: Number.NaN, lon: 0 }, BANGKOK)).toThrow(RangeError);
  });
});

describe("roundDistanceKm", () => {
  it("never returns less than 1", () => {
    expect(roundDistanceKm(0)).toBe(1);
    expect(roundDistanceKm(0.4)).toBe(1);
  });

  it("rounds to the nearest whole number", () => {
    expect(roundDistanceKm(1.5)).toBe(2);
    expect(roundDistanceKm(2.4)).toBe(2);
    expect(roundDistanceKm(4.6)).toBe(5);
  });
});
