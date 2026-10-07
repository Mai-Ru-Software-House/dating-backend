/*
 * Tests for GET /api/v1/places through the real app, with a fake fetch behind the Location
 * Service: success, input checks, not found, geocoder failure, and no session needed.
 */
import { describe, expect, it } from "bun:test";

import { createApp } from "../../src/app";
import { loadConfig } from "../../src/config/env";
import { createLocationService } from "../../src/services/location/locationService";
import { createMockFetch, jsonResponse } from "./mockFetch";

const testConfig = loadConfig({
  NODE_ENV: "test",
  PORT: "3000",
  CORS_ORIGINS: "http://localhost:8081",
  SESSION_SECRET: "test-secret",
  DATABASE_URL: "postgres://user:pass@localhost:5432/test",
  RUSTFS_ENDPOINT: "http://localhost:9000",
  RUSTFS_ACCESS_KEY: "test",
  RUSTFS_SECRET_KEY: "test",
  RUSTFS_BUCKET: "test",
  MATCH_ENGINE_URL: "http://localhost:8000",
  NOMINATIM_URL: "http://nominatim.test",
});

interface ErrorBody {
  error: { code: string; message: string; field?: string };
}

function createTestApp(handler: Parameters<typeof createMockFetch>[0]) {
  const { fetch, calls } = createMockFetch(handler);
  const locationService = createLocationService({ baseUrl: "http://nominatim.test", fetch });
  return { app: createApp(testConfig, { locationService }), calls };
}

async function getPlaces(app: ReturnType<typeof createApp>, query: string) {
  const response = await app.handle(new Request(`http://localhost/api/v1/places${query}`));
  return { status: response.status, body: await response.json() };
}

describe("GET /api/v1/places", () => {
  it("returns the place name without a session", async () => {
    const { app } = createTestApp(() =>
      jsonResponse({ address: { state: "Bangkok", city_district: "Pathum Wan" } }),
    );

    const { status, body } = await getPlaces(app, "?lat=13.7466&lon=100.5347");

    expect(status).toBe(200);
    expect(body).toEqual({ placeName: "Bangkok, Pathum Wan" });
  });

  it("returns 400 INVALID_INPUT with the field for bad lat or lon", async () => {
    const { app, calls } = createTestApp(() => jsonResponse({}));
    const cases: [string, string][] = [
      ["?lon=100", "lat"],
      ["?lat=13", "lon"],
      ["?lat=abc&lon=100", "lat"],
      ["?lat=13&lon=abc", "lon"],
      ["?lat=&lon=100", "lat"],
      ["?lat=90.1&lon=100", "lat"],
      ["?lat=-90.1&lon=100", "lat"],
      ["?lat=13&lon=180.1", "lon"],
      ["?lat=13&lon=-180.1", "lon"],
      ["?lat=NaN&lon=100", "lat"],
    ];

    for (const [query, field] of cases) {
      const { status, body } = await getPlaces(app, query);
      const error = (body as ErrorBody).error;

      expect(status).toBe(400);
      expect(error.code).toBe("INVALID_INPUT");
      expect(error.field).toBe(field);
    }
    expect(calls).toHaveLength(0);
  });

  it("accepts the edge values of the range", async () => {
    const { app } = createTestApp(() => jsonResponse({ address: { state: "Somewhere" } }));

    expect((await getPlaces(app, "?lat=90&lon=180")).status).toBe(200);
    expect((await getPlaces(app, "?lat=-90&lon=-180")).status).toBe(200);
  });

  it("returns 404 PLACE_NOT_FOUND when Nominatim has no place", async () => {
    const { app } = createTestApp(() => jsonResponse({ error: "Unable to geocode" }));

    const { status, body } = await getPlaces(app, "?lat=0&lon=0");

    expect(status).toBe(404);
    expect(Object.keys(body as object)).toEqual(["error"]);
    expect((body as ErrorBody).error.code).toBe("PLACE_NOT_FOUND");
  });

  it("returns 404 PLACE_NOT_FOUND when the place has no province and no district", async () => {
    const { app } = createTestApp(() => jsonResponse({ address: { country: "Thailand" } }));

    const { status, body } = await getPlaces(app, "?lat=10&lon=100");

    expect(status).toBe(404);
    expect((body as ErrorBody).error.code).toBe("PLACE_NOT_FOUND");
  });

  it("returns 500 GEOCODER_UNAVAILABLE when Nominatim fails", async () => {
    const { app } = createTestApp(() => jsonResponse({}, 503));

    const { status, body } = await getPlaces(app, "?lat=13&lon=100");

    expect(status).toBe(500);
    expect(Object.keys((body as ErrorBody).error).sort()).toEqual(["code", "message"]);
    expect((body as ErrorBody).error.code).toBe("GEOCODER_UNAVAILABLE");
  });
});
