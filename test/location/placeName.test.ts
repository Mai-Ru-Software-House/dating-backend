/*
 * Tests for buildPlaceName: "province, district" from Nominatim address fields.
 */
import { describe, expect, it } from "bun:test";

import { buildPlaceName } from "../../src/services/location/placeName";

// Real answers from nominatim.openstreetmap.org (English, zoom 12, 8 Oct 2026), shortened.
const SIAM_BANGKOK = {
  quarter: "Pathum Wan Subdistrict",
  suburb: "Pathum Wan District",
  city: "Bangkok",
  postcode: "10330",
  country: "Thailand",
};
const CHIANG_MAI = {
  suburb: "แขวงศรีวิชัย",
  city_district: "Suthep Subdistrict",
  city: "Chiang Mai City Municipality",
  municipality: "Fa Ham",
  county: "Mueang Chiang Mai District",
  province: "Chiang Mai Province",
  country: "Thailand",
};
const NONTHABURI = {
  city_district: "Bang Kraso Subdistrict",
  city: "Nonthaburi City Municipality",
  county: "Mueang Nonthaburi District",
  province: "Nonthaburi Province",
  postcode: "11000",
};
const PHUKET_CITY = {
  city: "Phuket City Municipality",
  county: "Mueang Phuket District",
  province: "Phuket Province",
};

describe("buildPlaceName with real Thai answers", () => {
  it("reads the Bangkok district from suburb and the province from city (CP02)", () => {
    expect(buildPlaceName(SIAM_BANGKOK)).toBe("Bangkok, Pathum Wan");
  });

  it("uses the county as the district and never the subdistrict (Chiang Mai)", () => {
    expect(buildPlaceName(CHIANG_MAI)).toBe("Chiang Mai, Mueang Chiang Mai");
  });

  it("does not show a subdistrict from city_district (Nonthaburi)", () => {
    expect(buildPlaceName(NONTHABURI)).toBe("Nonthaburi, Mueang Nonthaburi");
  });

  it("works when only the county and the province are there (Phuket City)", () => {
    expect(buildPlaceName(PHUKET_CITY)).toBe("Phuket, Mueang Phuket");
  });
});

describe("buildPlaceName subdistricts and Thai names", () => {
  it("never uses a subdistrict, even when it is the only candidate", () => {
    expect(
      buildPlaceName({ province: "Chiang Mai Province", city_district: "Suthep Subdistrict" }),
    ).toBe("Chiang Mai");
    expect(buildPlaceName({ state: "Bangkok", suburb: "Khwaeng Pathum Wan" })).toBe("Bangkok");
    expect(buildPlaceName({ state: "Bangkok", suburb: "แขวงปทุมวัน" })).toBe("Bangkok");
  });

  it("prefers a field that says district over an earlier plain name", () => {
    expect(
      buildPlaceName({
        province: "Phuket Province",
        city_district: "Old Town",
        county: "Mueang Phuket District",
      }),
    ).toBe("Phuket, Mueang Phuket");
  });

  it("falls back to a plain name when no field says district", () => {
    expect(buildPlaceName({ state: "Bangkok", suburb: "Ari" })).toBe("Bangkok, Ari");
  });

  it("reads Thai script names with their prefixes removed", () => {
    expect(buildPlaceName({ province: "จังหวัดเชียงใหม่", county: "อำเภอเมืองเชียงใหม่" })).toBe(
      "เชียงใหม่, เมืองเชียงใหม่",
    );
    expect(buildPlaceName({ city: "กรุงเทพมหานคร", suburb: "เขตปทุมวัน" })).toBe(
      "กรุงเทพมหานคร, ปทุมวัน",
    );
  });
});

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
