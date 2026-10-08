/*
 * Route tests for the Profile endpoints through the whole app: status codes, the error shape
 * with `field`, which routes need a session, and that /users/me is not read as a user ID.
 */
import { describe, expect, it } from "bun:test";

import { createApp } from "../../src/app";
import type { SessionValidator } from "../../src/services/auth/sessionValidator";
import type { SignUpInput } from "../../src/services/profile/profileTypes";
import { ALICE, BOB } from "../match/fixtures";
import { testConfig, UNKNOWN_USER_ID } from "../messaging/fixtures";
import { createTestProfiles, mintSignUp } from "./fixtures";

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;

async function setup() {
  const { service, auth } = await createTestProfiles();
  const tokens: Record<string, string> = { "alice-token": ALICE.userId };
  // alice logs in with a test token; a new user signs up and uses the real access token.
  const validator: SessionValidator = async (token) => {
    const userId = tokens[token];
    return userId === undefined ? auth.service.validateSession(token) : { userId };
  };
  const app = createApp(testConfig, { profileService: service, sessionValidator: validator });

  async function call(method: string, path: string, token?: string, body?: unknown) {
    const headers: Record<string, string> = {};
    if (token !== undefined) {
      headers.authorization = `Bearer ${token}`;
    }
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    const response = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const text = await response.text();
    return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
  }
  return { call };
}

describe("GET /usernames/{username}", () => {
  it("needs no session and answers isAvailable", async () => {
    const { call } = await setup();
    expect(await call("GET", "/api/v1/usernames/mint_01")).toEqual({
      status: HTTP_OK,
      body: { isAvailable: true },
    });
    expect((await call("GET", "/api/v1/usernames/Alice")).body).toEqual({ isAvailable: false });
  });

  it("answers 400 INVALID_INPUT with field username for a bad format", async () => {
    const { call } = await setup();
    const response = await call("GET", "/api/v1/usernames/abc");
    expect(response.status).toBe(HTTP_BAD_REQUEST);
    expect(response.body.error).toMatchObject({ code: "INVALID_INPUT", field: "username" });
  });
});

describe("POST /users", () => {
  it("CP01: needs no session, answers 201 with tokens, and GET /users/me works with them", async () => {
    const { call } = await setup();
    const created = await call("POST", "/api/v1/users", undefined, mintSignUp());
    expect(created.status).toBe(HTTP_CREATED);
    expect(typeof created.body.accessToken).toBe("string");
    expect(typeof created.body.refreshToken).toBe("string");
    expect(created.body.profile).toMatchObject({ username: "mint_01", displayName: "Mint" });

    const me = await call("GET", "/api/v1/users/me", created.body.accessToken);
    expect(me).toEqual({ status: HTTP_OK, body: created.body.profile });
  });

  it("CP04: answers 409 USERNAME_TAKEN for a taken username", async () => {
    const { call } = await setup();
    const response = await call(
      "POST",
      "/api/v1/users",
      undefined,
      mintSignUp({ username: "alice" }),
    );
    expect(response.status).toBe(HTTP_CONFLICT);
    expect(response.body.error.code).toBe("USERNAME_TAKEN");
  });

  it("names a nested field with a dot", async () => {
    const { call } = await setup();
    const body = mintSignUp({ preferences: { ...mintSignUp().preferences, minAge: 17 } });
    const response = await call("POST", "/api/v1/users", undefined, body);
    expect(response.status).toBe(HTTP_BAD_REQUEST);
    expect(response.body.error).toMatchObject({
      code: "INVALID_INPUT",
      field: "preferences.minAge",
    });
  });

  it("CP22: answers 400 photoUploadId when the photo upload is missing", async () => {
    const { call } = await setup();
    const withoutPhoto: Partial<SignUpInput> = mintSignUp();
    delete withoutPhoto.photoUploadId;
    const response = await call("POST", "/api/v1/users", undefined, withoutPhoto);
    expect(response.status).toBe(HTTP_BAD_REQUEST);
    expect(response.body.error).toMatchObject({ code: "INVALID_INPUT", field: "photoUploadId" });
  });
});

describe("GET and PATCH /users/me", () => {
  it("answer 401 without a token", async () => {
    const { call } = await setup();
    expect((await call("GET", "/api/v1/users/me")).status).toBe(HTTP_UNAUTHORIZED);
    expect((await call("PATCH", "/api/v1/users/me", undefined, {})).status).toBe(HTTP_UNAUTHORIZED);
  });

  it("GET gives the own profile, not a user called me", async () => {
    const { call } = await setup();
    const response = await call("GET", "/api/v1/users/me", "alice-token");
    expect(response.status).toBe(HTTP_OK);
    expect(response.body).toMatchObject({ userId: ALICE.userId, dateOfBirth: "1999-03-10" });
  });

  it("PATCH changes the display name", async () => {
    const { call } = await setup();
    const response = await call("PATCH", "/api/v1/users/me", "alice-token", {
      displayName: "Ali",
    });
    expect(response.status).toBe(HTTP_OK);
    expect(response.body.displayName).toBe("Ali");
  });

  it("PATCH answers 400 with field username when the username is sent", async () => {
    const { call } = await setup();
    const response = await call("PATCH", "/api/v1/users/me", "alice-token", {
      username: "alice_2",
    });
    expect(response.status).toBe(HTTP_BAD_REQUEST);
    expect(response.body.error).toMatchObject({ code: "INVALID_INPUT", field: "username" });
  });
});

describe("GET /users/{userId}", () => {
  it("answers 401 without a token", async () => {
    const { call } = await setup();
    expect((await call("GET", `/api/v1/users/${BOB.userId}`)).status).toBe(HTTP_UNAUTHORIZED);
  });

  it("shows another user's card with match score and no private data", async () => {
    const { call } = await setup();
    const response = await call("GET", `/api/v1/users/${BOB.userId}`, "alice-token");
    expect(response.status).toBe(HTTP_OK);
    expect(response.body).toMatchObject({ userId: BOB.userId, age: 28, isFavorite: false });
    expect(typeof response.body.matchScore).toBe("number");
    expect(response.body.dateOfBirth).toBeUndefined();
    expect(response.body.location).toBeUndefined();
  });

  it("answers 404 USER_NOT_FOUND for an unknown user", async () => {
    const { call } = await setup();
    const response = await call("GET", `/api/v1/users/${UNKNOWN_USER_ID}`, "alice-token");
    expect(response.status).toBe(HTTP_NOT_FOUND);
    expect(response.body.error.code).toBe("USER_NOT_FOUND");
  });
});
