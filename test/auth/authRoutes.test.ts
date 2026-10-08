/*
 * Route tests for login, refresh and logout through the whole app, including the 401 rules of
 * the functional test plan (LG05, LG10, LG11).
 */
import { describe, expect, it } from "bun:test";

import { createApp } from "../../src/app";
import { testConfig } from "../messaging/fixtures";
import { createTestAuth } from "./fixtures";

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;

async function setup() {
  const { service } = await createTestAuth();
  const app = createApp(testConfig, { authService: service });

  function request(method: string, path: string, body?: unknown, token?: string) {
    const headers: Record<string, string> = {};
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (token !== undefined) {
      headers.authorization = `Bearer ${token}`;
    }
    return app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  }

  async function login(username = "alice", password = "Alice2026") {
    const response = await request("POST", "/api/v1/sessions", { username, password });
    return { response, body: (await response.json()) as Record<string, unknown> };
  }

  return { request, login };
}

describe("POST /api/v1/sessions", () => {
  it("returns 201 with both tokens", async () => {
    const { login } = await setup();
    const { response, body } = await login();
    expect(response.status).toBe(HTTP_CREATED);
    expect(Object.keys(body).sort()).toEqual(["accessToken", "refreshToken"]);
  });

  it("returns the same 401 INVALID_CREDENTIALS for a wrong password and an unknown user", async () => {
    const { login } = await setup();
    const wrongPassword = await login("alice", "WrongPass1");
    const unknownUser = await login("nobody", "Alice2026");
    expect(wrongPassword.response.status).toBe(HTTP_UNAUTHORIZED);
    expect(wrongPassword.body).toEqual({
      error: { code: "INVALID_CREDENTIALS", message: "The username or password is not correct." },
    });
    expect(unknownUser.response.status).toBe(HTTP_UNAUTHORIZED);
    expect(unknownUser.body).toEqual(wrongPassword.body);
  });

  it("returns 400 INVALID_INPUT with the field when a value is missing or empty", async () => {
    const { request } = await setup();
    const missing = await request("POST", "/api/v1/sessions", { username: "alice" });
    expect(missing.status).toBe(HTTP_BAD_REQUEST);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe(
      "INVALID_INPUT",
    );
    const empty = await request("POST", "/api/v1/sessions", { username: "", password: "x" });
    expect(empty.status).toBe(HTTP_BAD_REQUEST);
    expect(((await empty.json()) as { error: { field?: string } }).error.field).toBe("username");
  });
});

describe("protected routes", () => {
  it("answer 401 UNAUTHENTICATED without a token (LG11)", async () => {
    const { request } = await setup();
    const response = await request("GET", "/api/v1/conversations");
    expect(response.status).toBe(HTTP_UNAUTHORIZED);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "UNAUTHENTICATED",
    );
  });

  it("answer 401 UNAUTHENTICATED for a fake token", async () => {
    const { request } = await setup();
    const response = await request("GET", "/api/v1/conversations", undefined, "fake-token");
    expect(response.status).toBe(HTTP_UNAUTHORIZED);
  });

  it("accept the access token from login", async () => {
    const { request, login } = await setup();
    const { body } = await login();
    const response = await request(
      "GET",
      "/api/v1/conversations",
      undefined,
      body.accessToken as string,
    );
    expect(response.status).toBe(HTTP_OK);
  });
});

describe("POST /api/v1/sessions/refresh", () => {
  it("returns a new pair and rejects the old refresh token", async () => {
    const { request, login } = await setup();
    const { body } = await login();
    const first = await request("POST", "/api/v1/sessions/refresh", {
      refreshToken: body.refreshToken,
    });
    expect(first.status).toBe(HTTP_OK);
    const second = await request("POST", "/api/v1/sessions/refresh", {
      refreshToken: body.refreshToken,
    });
    expect(second.status).toBe(HTTP_UNAUTHORIZED);
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe(
      "UNAUTHENTICATED",
    );
  });

  it("returns 400 when the refresh token is missing", async () => {
    const { request } = await setup();
    const response = await request("POST", "/api/v1/sessions/refresh", {});
    expect(response.status).toBe(HTTP_BAD_REQUEST);
  });
});

describe("DELETE /api/v1/sessions/current", () => {
  it("returns 204 and the refresh token stops working (LG10)", async () => {
    const { request, login } = await setup();
    const { body } = await login();
    const logout = await request(
      "DELETE",
      "/api/v1/sessions/current",
      { refreshToken: body.refreshToken },
      body.accessToken as string,
    );
    expect(logout.status).toBe(HTTP_NO_CONTENT);
    const refresh = await request("POST", "/api/v1/sessions/refresh", {
      refreshToken: body.refreshToken,
    });
    expect(refresh.status).toBe(HTTP_UNAUTHORIZED);
  });

  it("works without a body and cancels every refresh token", async () => {
    const { request, login } = await setup();
    const { body } = await login();
    const logout = await request(
      "DELETE",
      "/api/v1/sessions/current",
      undefined,
      body.accessToken as string,
    );
    expect(logout.status).toBe(HTTP_NO_CONTENT);
    const refresh = await request("POST", "/api/v1/sessions/refresh", {
      refreshToken: body.refreshToken,
    });
    expect(refresh.status).toBe(HTTP_UNAUTHORIZED);
  });

  it("returns 401 without an access token", async () => {
    const { request } = await setup();
    const response = await request("DELETE", "/api/v1/sessions/current");
    expect(response.status).toBe(HTTP_UNAUTHORIZED);
  });
});
