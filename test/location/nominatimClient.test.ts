/*
 * Tests for the Nominatim client with a fake fetch: request shape, User-Agent, and every
 * failure turning into GEOCODER_UNAVAILABLE.
 */
import { describe, expect, it } from "bun:test";

import { ApiError } from "../../src/plugins/errors";
import { createNominatimClient } from "../../src/services/location/nominatimClient";
import { createMockFetch, jsonResponse } from "./mockFetch";

const BASE_URL = "http://nominatim.test";
const BANGKOK_ANSWER = {
  display_name: "Lat Krabang, Bangkok, Thailand",
  address: { city_district: "Lat Krabang", state: "Bangkok", country: "Thailand" },
};

async function catchError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

function expectGeocoderUnavailable(error: unknown): void {
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(500);
  expect((error as ApiError).code).toBe("GEOCODER_UNAVAILABLE");
}

describe("createNominatimClient", () => {
  it("asks the reverse endpoint with the point, English names and address details", async () => {
    const { fetch, calls } = createMockFetch(() => jsonResponse(BANGKOK_ANSWER));
    const client = createNominatimClient({ baseUrl: BASE_URL, fetch });

    const address = await client.reverseGeocode(13.7244, 100.7296);

    expect(address).toEqual(BANGKOK_ANSWER.address);
    const url = calls[0]!.url;
    expect(url.origin + url.pathname).toBe("http://nominatim.test/reverse");
    expect(url.searchParams.get("lat")).toBe("13.7244");
    expect(url.searchParams.get("lon")).toBe("100.7296");
    expect(url.searchParams.get("format")).toBe("jsonv2");
    expect(url.searchParams.get("addressdetails")).toBe("1");
    expect(url.searchParams.get("accept-language")).toBe("en");
  });

  it("sends a User-Agent that is not empty", async () => {
    const { fetch, calls } = createMockFetch(() => jsonResponse(BANGKOK_ANSWER));
    const client = createNominatimClient({ baseUrl: BASE_URL, fetch });

    await client.reverseGeocode(13.7, 100.5);

    const userAgent = calls[0]!.headers.get("user-agent");
    expect(userAgent).toBeTruthy();
    expect(userAgent).toContain("MaiRu");
  });

  it("handles a base URL with a trailing slash or a path", async () => {
    const { fetch, calls } = createMockFetch(() => jsonResponse(BANGKOK_ANSWER));

    await createNominatimClient({ baseUrl: `${BASE_URL}/`, fetch }).reverseGeocode(1, 2);
    await createNominatimClient({ baseUrl: `${BASE_URL}/geo/`, fetch }).reverseGeocode(1, 2);

    expect(calls[0]!.url.pathname).toBe("/reverse");
    expect(calls[1]!.url.pathname).toBe("/geo/reverse");
  });

  it("returns null when Nominatim finds no place", async () => {
    const { fetch } = createMockFetch(() => jsonResponse({ error: "Unable to geocode" }));
    const client = createNominatimClient({ baseUrl: BASE_URL, fetch });

    expect(await client.reverseGeocode(0, 0)).toBeNull();
  });

  it("returns null when the answer has no address", async () => {
    const { fetch } = createMockFetch(() => jsonResponse({ display_name: "Somewhere" }));
    const client = createNominatimClient({ baseUrl: BASE_URL, fetch });

    expect(await client.reverseGeocode(0, 0)).toBeNull();
  });

  it("throws GEOCODER_UNAVAILABLE for a 429 or a 500 answer", async () => {
    for (const status of [429, 500]) {
      const { fetch } = createMockFetch(() => jsonResponse({}, status));
      const client = createNominatimClient({ baseUrl: BASE_URL, fetch });

      expectGeocoderUnavailable(await catchError(client.reverseGeocode(1, 2)));
    }
  });

  it("throws GEOCODER_UNAVAILABLE when the network fails", async () => {
    const { fetch } = createMockFetch(() => {
      throw new TypeError("fetch failed");
    });
    const client = createNominatimClient({ baseUrl: BASE_URL, fetch });

    expectGeocoderUnavailable(await catchError(client.reverseGeocode(1, 2)));
  });

  it("throws GEOCODER_UNAVAILABLE when the request times out", async () => {
    const { fetch } = createMockFetch(() => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    const client = createNominatimClient({ baseUrl: BASE_URL, fetch });

    expectGeocoderUnavailable(await catchError(client.reverseGeocode(1, 2)));
  });

  it("throws GEOCODER_UNAVAILABLE when the answer is not JSON", async () => {
    const { fetch } = createMockFetch(() => new Response("<html>oops</html>", { status: 200 }));
    const client = createNominatimClient({ baseUrl: BASE_URL, fetch });

    expectGeocoderUnavailable(await catchError(client.reverseGeocode(1, 2)));
  });

  it("throws GEOCODER_UNAVAILABLE when the answer is JSON of the wrong shape", async () => {
    const { fetch } = createMockFetch(() => jsonResponse(["not", "an", "object"]));
    const client = createNominatimClient({ baseUrl: BASE_URL, fetch });

    expectGeocoderUnavailable(await catchError(client.reverseGeocode(1, 2)));
  });
});
