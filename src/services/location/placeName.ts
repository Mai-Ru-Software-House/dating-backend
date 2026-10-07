/*
 * Place name builder: turns the address fields from Nominatim into "province, district"
 * (for example "Bangkok, Min Buri"). This is the only builder, so the Location Service and
 * the Profile Service never produce different names for the same point. Built for Thai
 * addresses first.
 */

/** Address fields Nominatim returns. Only the ones the builder reads are listed. */
export type NominatimAddress = Record<string, string | undefined>;

// Field order matters: the first one with a value wins. Bangkok can arrive as `city`.
const PROVINCE_FIELDS = ["state", "province", "region", "city"] as const;
const DISTRICT_FIELDS = ["city_district", "county", "district"] as const;

// Official English prefixes that Nominatim sometimes keeps in the name.
const ADMIN_PREFIX_PATTERN = /^(?:chang\s?wat|province|khet|amphoe|amphur|district)\s+/i;
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

function pickName(address: NominatimAddress, fields: readonly string[]): string | null {
  for (const field of fields) {
    const name = cleanName(address[field]);
    if (name !== null) {
      return name;
    }
  }
  return null;
}

/**
 * Build the place name shown to users: "province, district", in the language of the address.
 * @param address - the `address` object from a Nominatim reverse geocoding answer
 * @returns "province, district"; only the province when no district is known; null if neither
 */
export function buildPlaceName(address: NominatimAddress): string | null {
  const province = pickName(address, PROVINCE_FIELDS);
  const district = pickName(address, DISTRICT_FIELDS);

  if (province === null) {
    return district;
  }
  // Bangkok can be both the province and the city, so do not print "Bangkok, Bangkok".
  if (district === null || district.toLowerCase() === province.toLowerCase()) {
    return province;
  }
  return `${province}, ${district}`;
}
