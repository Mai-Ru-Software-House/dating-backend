/*
 * Place name builder: turns the address fields from Nominatim into "province, district"
 * (for example "Bangkok, Pathum Wan"). This is the only builder, so the Location Service and
 * the Profile Service never produce different names for the same point. Built for Thai
 * addresses first.
 *
 * What Nominatim really sends for Thailand (checked on 8 Oct 2026, English names):
 * - Bangkok: `city` is "Bangkok", the district (khet) is in `suburb` ("Pathum Wan District"),
 *   the subdistrict (khwaeng) is in `quarter`, and there is no `state`.
 * - Other provinces: `province` ("Chiang Mai Province"), the district (amphoe) is in `county`
 *   ("Mueang Chiang Mai District"), and `city_district` can hold a *subdistrict* (tambon).
 * So the district is chosen by what its name says ("... District", "Khet ...", "Amphoe ...")
 * and a subdistrict is never used.
 */

/** Address fields Nominatim returns. Only the ones the builder reads are listed. */
export type NominatimAddress = Record<string, string | undefined>;

// Field order matters: the first one with a value wins. Bangkok can arrive as `city`.
const PROVINCE_FIELDS = ["state", "province", "region", "city"] as const;
// Fields that can hold the district, checked first for a name that says "district".
const DISTRICT_FIELDS = ["county", "suburb", "city_district", "district"] as const;
// Used only when no field says "district" (older answers, other countries).
const FALLBACK_DISTRICT_FIELDS = ["county", "city_district", "district", "suburb"] as const;

// The name says it is a district: "Mueang Chiang Mai District", "Khet Bang Khen", "Amphoe ...".
// "Subdistrict" does not match, because there is no word boundary inside it.
const DISTRICT_NAME_PATTERN = /(?:^(?:khet|amphoe|amphur)\s+|^(?:เขต|อำเภอ)|\bdistrict$)/i;
// The name says it is a subdistrict (tambon, khwaeng), which is too small to show.
const SUBDISTRICT_NAME_PATTERN =
  /(?:\bsub-?district$|^(?:tambon|khwaeng|kwaeng)\s+|^(?:แขวง|ตำบล))/i;

// Official prefixes and suffixes that Nominatim sometimes keeps in the name.
const ADMIN_PREFIX_PATTERN =
  /^(?:(?:chang\s?wat|province|khet|amphoe|amphur|district)\s+|(?:จังหวัด|เขต|อำเภอ)\s*)/i;
const ADMIN_SUFFIX_PATTERN = /\s+(?:province|district)$/i;

function cleanName(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const cleaned = value
    .trim()
    .replace(ADMIN_PREFIX_PATTERN, "")
    .replace(ADMIN_SUFFIX_PATTERN, "")
    .trim();
  return cleaned === "" ? null : cleaned;
}

function pickProvince(address: NominatimAddress): string | null {
  for (const field of PROVINCE_FIELDS) {
    const name = cleanName(address[field]);
    if (name !== null) {
      return name;
    }
  }
  return null;
}

function listUsableValues(address: NominatimAddress, fields: readonly string[]): string[] {
  const values: string[] = [];
  for (const field of fields) {
    const value = address[field]?.trim();
    if (value !== undefined && value !== "" && !SUBDISTRICT_NAME_PATTERN.test(value)) {
      values.push(value);
    }
  }
  return values;
}

function pickDistrict(address: NominatimAddress): string | null {
  const nameSaysDistrict = listUsableValues(address, DISTRICT_FIELDS).find((value) =>
    DISTRICT_NAME_PATTERN.test(value),
  );
  const chosen = nameSaysDistrict ?? listUsableValues(address, FALLBACK_DISTRICT_FIELDS)[0];
  return cleanName(chosen);
}

/**
 * Build the place name shown to users: "province, district", in the language of the address.
 * @param address - the `address` object from a Nominatim reverse geocoding answer
 * @returns "province, district"; only the province when no district is known; null if neither
 */
export function buildPlaceName(address: NominatimAddress): string | null {
  const province = pickProvince(address);
  const district = pickDistrict(address);

  if (province === null) {
    return district;
  }
  // Bangkok can be both the province and the city, so do not print "Bangkok, Bangkok".
  if (district === null || district.toLowerCase() === province.toLowerCase()) {
    return province;
  }
  return `${province}, ${district}`;
}
