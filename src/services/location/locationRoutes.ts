/*
 * Location routes: GET /api/v1/places gives the place name ("province, district") for a point.
 * It needs no session, because Create Profile uses it before the account exists.
 */
import { Elysia, t } from "elysia";

import { ApiError, ERROR_CODES } from "../../plugins/errors";
import type { LocationService } from "./locationService";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const MIN_LATITUDE = -90;
const MAX_LATITUDE = 90;
const MIN_LONGITUDE = -180;
const MAX_LONGITUDE = 180;

/**
 * Check a coordinate is inside its range. The range is checked here and not in the schema
 * because Elysia drops the field name from range errors, and the contract wants `field`.
 * @param field - query parameter name, sent back in the error
 * @param value - the number the app sent
 * @param min - smallest allowed value
 * @param max - largest allowed value
 * @throws ApiError 400 INVALID_INPUT with `field` when the value is outside the range
 */
function assertInRange(field: string, value: number, min: number, max: number): void {
  // Written so that NaN also fails.
  if (!(value >= min && value <= max)) {
    throw new ApiError(
      HTTP_BAD_REQUEST,
      ERROR_CODES.invalidInput,
      `${field} must be a number from ${min} to ${max}.`,
      field,
    );
  }
}

/**
 * Build the Elysia plugin with the place lookup route.
 * @param service - the Location Service that finds the place name
 * @returns an Elysia plugin to register with `.use()`
 * @throws ApiError 400 INVALID_INPUT (inside the route) when `lat` or `lon` is out of range
 * @throws ApiError 404 PLACE_NOT_FOUND (inside the route) when there is no place or no name
 */
export function locationRoutes(service: LocationService) {
  return new Elysia({ name: "location-routes", prefix: "/api/v1" }).get(
    "/places",
    async ({ query }) => {
      assertInRange("lat", query.lat, MIN_LATITUDE, MAX_LATITUDE);
      assertInRange("lon", query.lon, MIN_LONGITUDE, MAX_LONGITUDE);

      const placeName = await service.findPlaceName(query.lat, query.lon);
      if (placeName === null) {
        throw new ApiError(
          HTTP_NOT_FOUND,
          ERROR_CODES.placeNotFound,
          "No place was found for that location.",
        );
      }
      return { placeName };
    },
    {
      query: t.Object({
        lat: t.Numeric({ description: "Latitude in degrees, -90 to 90" }),
        lon: t.Numeric({ description: "Longitude in degrees, -180 to 180" }),
      }),
      response: { 200: t.Object({ placeName: t.String() }) },
      detail: { summary: "Get the place name for a point", tags: ["Location"] },
    },
  );
}
