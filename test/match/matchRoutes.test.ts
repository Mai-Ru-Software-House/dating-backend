/*
 * Route tests for recommendations and search through the whole app: status codes, the error
 * shape, query parsing (including a repeated `targetGenders`) and the functional test plan
 * cases that are about the HTTP answer (FM13 to FM15, FM17).
 */
import { describe, expect, it } from "bun:test";

import { createApp } from "../../src/app";
import type { SessionValidator } from "../../src/services/auth/sessionValidator";
import { testConfig } from "../messaging/fixtures";
import { ALICE, JOE, createTestMatchService } from "./fixtures";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_INTERNAL_ERROR = 500;

const TOKENS: Record<string, string> = { "alice-token": ALICE.userId, "joe-token": JOE.userId };
const fakeValidator: SessionValidator = async (token) => {
  const userId = TOKENS[token];
  return userId === undefined ? null : { userId };
};

function setup() {
  const { service, engine } = createTestMatchService();
  const app = createApp(testConfig, { matchService: service, sessionValidator: fakeValidator });

  async function get(path: string, token?: string) {
    const headers: Record<string, string> = {};
    if (token !== undefined) {
      headers.authorization = `Bearer ${token}`;
    }
    const response = await app.handle(new Request(`http://localhost${path}`, { headers }));
    return { status: response.status, body: await response.json() };
  }
  return { get, engine };
}

describe("GET /api/v1/recommendations", () => {
  it("answers 401 without a token", async () => {
    const { get } = setup();
    expect((await get("/api/v1/recommendations")).status).toBe(HTTP_UNAUTHORIZED);
  });

  it("FM01: returns bob and chai as cards, with username and score", async () => {
    const { get } = setup();
    const { status, body } = await get("/api/v1/recommendations", "alice-token");
    expect(status).toBe(HTTP_OK);
    expect(body.hasMore).toBe(false);
    expect(body.recommendations.map((card: { username: string }) => card.username)).toEqual([
      "bob",
      "chai",
    ]);
    expect(Object.keys(body.recommendations[0]).sort()).toEqual([
      "age",
      "displayName",
      "distanceKm",
      "gender",
      "matchScore",
      "photoId",
      "placeName",
      "userId",
      "username",
    ]);
  });

  it("FM09: never sends a date of birth or an exact location", async () => {
    const { get } = setup();
    const { body } = await get("/api/v1/recommendations", "alice-token");
    const text = JSON.stringify(body);
    expect(text).not.toContain("dateOfBirth");
    expect(text).not.toContain("latitude");
    expect(text).not.toContain("longitude");
    expect(text).not.toContain("1998-05-20");
    expect(text).not.toContain("13.7279");
  });

  it("FM16: gives joe an empty list with status 200", async () => {
    const { get } = setup();
    const { status, body } = await get("/api/v1/recommendations", "joe-token");
    expect(status).toBe(HTTP_OK);
    expect(body).toEqual({ recommendations: [], hasMore: false });
  });

  it("passes limit and offset on, and answers 400 with the field when they are bad", async () => {
    const { get, engine } = setup();
    expect((await get("/api/v1/recommendations?limit=1&offset=0", "alice-token")).status).toBe(
      HTTP_OK,
    );
    expect(engine.calls[0]!.body.limit).toBe(2);

    const tooBig = await get("/api/v1/recommendations?limit=51", "alice-token");
    expect(tooBig.status).toBe(HTTP_BAD_REQUEST);
    expect(tooBig.body.error).toMatchObject({ code: "INVALID_INPUT", field: "limit" });

    const text = await get("/api/v1/recommendations?limit=many", "alice-token");
    expect(text.status).toBe(HTTP_BAD_REQUEST);
    expect(text.body.error).toMatchObject({ code: "INVALID_INPUT", field: "limit" });
  });

  it("FM17: answers 500 MATCH_ENGINE_UNAVAILABLE in the error shape when the engine is down", async () => {
    const { get, engine } = setup();
    engine.state.isDown = true;
    const { status, body } = await get("/api/v1/recommendations", "alice-token");
    expect(status).toBe(HTTP_INTERNAL_ERROR);
    expect(body).toEqual({
      error: {
        code: "MATCH_ENGINE_UNAVAILABLE",
        message: "The match service is not available right now. Please try again.",
      },
    });
  });
});

describe("GET /api/v1/candidates", () => {
  it("answers 401 without a token", async () => {
    const { get } = setup();
    expect((await get("/api/v1/candidates")).status).toBe(HTTP_UNAUTHORIZED);
  });

  it("FM12: an empty search returns bob and chai, nearest first, without a score", async () => {
    const { get } = setup();
    const { status, body } = await get("/api/v1/candidates", "alice-token");
    expect(status).toBe(HTTP_OK);
    expect(body.candidates.map((card: { username: string }) => card.username)).toEqual([
      "bob",
      "chai",
    ]);
    expect(body.candidates[0]).not.toHaveProperty("matchScore");
  });

  it("FM11: age 25 to 26, male, 20 km returns only chai (a single targetGenders)", async () => {
    const { get } = setup();
    const { body } = await get(
      "/api/v1/candidates?minAge=25&maxAge=26&targetGenders=male&maxDistanceKm=20",
      "alice-token",
    );
    expect(body.candidates.map((card: { username: string }) => card.username)).toEqual(["chai"]);
  });

  it("reads a repeated targetGenders parameter as a list", async () => {
    const { get, engine } = setup();
    const { status } = await get(
      "/api/v1/candidates?targetGenders=male&targetGenders=non_binary",
      "alice-token",
    );
    expect(status).toBe(HTTP_OK);
    expect(engine.calls[0]!.body.gender).toEqual(["male", "non_binary"]);
  });

  it("FM13: min age above max age answers 400 with the age range in the message", async () => {
    const { get } = setup();
    const { status, body } = await get("/api/v1/candidates?minAge=30&maxAge=25", "alice-token");
    expect(status).toBe(HTTP_BAD_REQUEST);
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.error.message).toContain("age range");
    expect(body.error.field).toBe("minAge");
  });

  it("FM14: a distance that is not a number answers 400 and names maxDistanceKm", async () => {
    const { get } = setup();
    const { status, body } = await get("/api/v1/candidates?maxDistanceKm=ten", "alice-token");
    expect(status).toBe(HTTP_BAD_REQUEST);
    expect(body.error).toMatchObject({ code: "INVALID_INPUT", field: "maxDistanceKm" });
  });

  it("FM15: an age below 18 answers 400 with the minimum age in the message", async () => {
    const { get } = setup();
    const { status, body } = await get("/api/v1/candidates?minAge=15&maxAge=30", "alice-token");
    expect(status).toBe(HTTP_BAD_REQUEST);
    expect(body.error).toMatchObject({
      code: "INVALID_INPUT",
      message: "The minimum age is 18.",
      field: "minAge",
    });
  });

  it("answers 400 when only one of lat and lon is sent", async () => {
    const { get } = setup();
    const { status, body } = await get("/api/v1/candidates?lat=13.7", "alice-token");
    expect(status).toBe(HTTP_BAD_REQUEST);
    expect(body.error).toMatchObject({ code: "INVALID_INPUT", field: "lon" });
  });

  it("FM17: answers 500 MATCH_ENGINE_UNAVAILABLE when the engine is down", async () => {
    const { get, engine } = setup();
    engine.state.isDown = true;
    const { status, body } = await get("/api/v1/candidates", "alice-token");
    expect(status).toBe(HTTP_INTERNAL_ERROR);
    expect(body.error.code).toBe("MATCH_ENGINE_UNAVAILABLE");
  });
});
