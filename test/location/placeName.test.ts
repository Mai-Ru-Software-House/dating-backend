/*
 * Tests for buildPlaceName: "province, district" from Nominatim address fields.
 */
import { describe, expect, it } from "bun:test";

import { buildPlaceName } from "../../src/services/location/placeName";

describe("buildPlaceName", () => {
  it("builds province then district", () => {
    expect(buildPlaceName({ state: "Bangkok", city_district: "Lat Krabang" })).toBe(
      "Bangkok, Lat Krabang",
    );
  });

  it("uses the county as district in other provinces", () => {
    expect(buildPlaceName({ state: "Chiang Mai", county: "Mueang Chiang Mai" })).toBe(
      "Chiang Mai, Mueang Chiang Mai",
    );
  });

  it("reads Bangkok from city when there is no state", () => {
    expect(buildPlaceName({ city: "Bangkok", city_district: "Pathum Wan" })).toBe(
      "Bangkok, Pathum Wan",
    );
  });

  it("returns only the province when no district is known", () => {
    expect(buildPlaceName({ state: "Phuket", road: "Some road" })).toBe("Phuket");
  });

  it("returns null when neither is known", () => {
    expect(buildPlaceName({ country: "Thailand", road: "Some road" })).toBeNull();
    expect(buildPlaceName({})).toBeNull();
  });

  it("removes English administrative prefixes and suffixes", () => {
    expect(buildPlaceName({ state: "Changwat Nonthaburi", county: "Amphoe Bang Bua Thong" })).toBe(
      "Nonthaburi, Bang Bua Thong",
    );
    expect(buildPlaceName({ state: "Chang Wat Rayong", city_district: "Khet Bang Khen" })).toBe(
      "Rayong, Bang Khen",
    );
    expect(buildPlaceName({ state: "Krabi Province", county: "Mueang Krabi District" })).toBe(
      "Krabi, Mueang Krabi",
    );
  });

  it("ignores blank values", () => {
    expect(buildPlaceName({ state: "  ", city: "Bangkok", city_district: "" })).toBe("Bangkok");
  });

  it("does not repeat the province as the district", () => {
    expect(buildPlaceName({ state: "Bangkok", city_district: "Bangkok" })).toBe("Bangkok");
  });

  it("does not use street level fields", () => {
    expect(buildPlaceName({ state: "Bangkok", road: "Rama I Road", house_number: "999" })).toBe(
      "Bangkok",
    );
  });
});
