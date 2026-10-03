/*
 * Nominatim client: one reverse geocoding request to the OpenStreetMap Nominatim service. The
 * base URL comes from NOMINATIM_URL. Nominatim requires an identifying User-Agent header, and
 * the caller (the Location Service) is responsible for the 1 request per second limit.
 */
import { ApiError, ERROR_CODES } from "../../plugins/errors";
import type { NominatimAddress } from "./placeName";

const HTTP_INTERNAL_ERROR = 500;
const REQUEST_TIMEOUT_MS = 5000;
/** Place names are returned in English, as the API contract describes. */
export const NOMINATIM_LANGUAGE = "en";
const NOMINATIM_USER_AGENT = "MaiRu-Backend/0.1 (SEN-201 student project)";
/** Zoom 12 asks for town / district level, so no street or house data is returned. */
const NOMINATIM_ZOOM = "12";
const GEOCODER_MESSAGE = "The place lookup is not available right now. Please try again.";

/** Looks up the address of a point. Resolves to null when Nominatim knows no place there. */
export interface NominatimClient {
  reverseGeocode(lat: number, lon: number): Promise<NominatimAddress | null>;
}

/** Settings for createNominatimClient. `fetch` can be replaced in tests. */
export interface NominatimClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
}

function geocoderUnavailable(): ApiError {
  return new ApiError(HTTP_INTERNAL_ERROR, ERROR_CODES.geocoderUnavailable, GEOCODER_MESSAGE);
}

function buildReverseUrl(baseUrl: string, lat: number, lon: number): URL {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/reverse`;
  url.search = new URLSearchParams({
    format: "jsonv2",
    lat: String(lat),
    lon: String(lon),
    addressdetails: "1",
    zoom: NOMINATIM_ZOOM,
    "accept-language": NOMINATIM_LANGUAGE,
  }).toString();
  return url;
}

function isAddressObject(value: unknown): value is NominatimAddress {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Turn a Nominatim answer body into an address.
 * @param body - parsed JSON from Nominatim
 * @returns the address, or null when Nominatim says it found no place
 * @throws ApiError 500 GEOCODER_UNAVAILABLE when the body has an unexpected shape
 */
function readAddress(body: unknown): NominatimAddress | null {
  if (!isAddressObject(body)) {
    throw geocoderUnavailable();
  }
  // Open sea and similar points come back as 200 with { "error": "Unable to geocode" }.
  if ("error" in body) {
    return null;
  }
  const address = (body as { address?: unknown }).address;
  return isAddressObject(address) ? address : null;
}

/**
 * Create a Nominatim client.
 * @param options - the Nominatim base URL and an optional fetch function
 * @returns the client
 */
export function createNominatimClient(options: NominatimClientOptions): NominatimClient {
  const fetchFn = options.fetch ?? fetch;

  return {
    /**
     * Ask Nominatim which place a point is in.
     * @param lat - latitude in degrees
     * @param lon - longitude in degrees
     * @returns the address fields, or null when there is no place at that point
     * @throws ApiError 500 GEOCODER_UNAVAILABLE on a network error, timeout, non 2xx status or
     *   an answer that is not valid JSON
     */
    async reverseGeocode(lat, lon) {
      try {
        const response = await fetchFn(buildReverseUrl(options.baseUrl, lat, lon), {
          headers: { "User-Agent": NOMINATIM_USER_AGENT, "Accept-Language": NOMINATIM_LANGUAGE },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
          throw new Error(`Nominatim answered ${response.status}`);
        }
        return readAddress(await response.json());
      } catch (error) {
        if (error instanceof ApiError) {
          throw error;
        }
        console.error("Nominatim request failed:", error);
        throw geocoderUnavailable();
      }
    },
  };
}
