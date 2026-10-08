/*
 * Tests for CORS: the app origins in CORS_ORIGINS may call the API from a browser or web
 * view, every other origin gets no permission header, and the preflight answer allows the
 * methods the API uses and the headers the app sends.
 */
import { describe, expect, it } from "bun:test";

import { createApp } from "../src/app";
import { loadConfig } from "../src/config/env";

const ALLOWED_ORIGIN = "http://localhost:8081";
const OTHER_ALLOWED_ORIGIN = "http://localhost:19006";
const STRANGER_ORIGIN = "https://evil.example.com";

const config = loadConfig({
  NODE_ENV: "test",
  PORT: "3000",
  CORS_ORIGINS: `${ALLOWED_ORIGIN}, ${OTHER_ALLOWED_ORIGIN}`,
  JWT_SECRET: "test-secret",
  DATABASE_URL: "postgres://user:pass@localhost:5432/test",
  RUSTFS_ENDPOINT: "http://localhost:9000",
  RUSTFS_ACCESS_KEY: "test",
  RUSTFS_SECRET_KEY: "test",
  RUSTFS_BUCKET: "test",
  MATCH_ENGINE_URL: "http://localhost:8000",
  NOMINATIM_URL: "http://localhost:8080",
});

function preflight(origin: string, method: string, headers = "authorization, content-type") {
  return createApp(config).handle(
    new Request("http://localhost/api/v1/sessions", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": headers,
      },
    }),
  );
}

describe("CORS", () => {
  it("answers the preflight of an allowed origin with that origin", async () => {
    for (const origin of [ALLOWED_ORIGIN, OTHER_ALLOWED_ORIGIN]) {
      const response = await preflight(origin, "POST");
      expect(response.status).toBeLessThan(300);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    }
  });

  it("allows every method the API uses and the headers the app sends", async () => {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      const response = await preflight(ALLOWED_ORIGIN, method);
      const allowed = response.headers.get("access-control-allow-methods") ?? "";
      expect(allowed).toContain(method);
    }
    const response = await preflight(ALLOWED_ORIGIN, "POST", "authorization, content-type");
    const allowedHeaders = (
      response.headers.get("access-control-allow-headers") ?? ""
    ).toLowerCase();
    expect(allowedHeaders).toContain("authorization");
    expect(allowedHeaders).toContain("content-type");
  });

  it("gives an origin that is not in the list no permission", async () => {
    const response = await preflight(STRANGER_ORIGIN, "POST");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("adds the allowed origin to a normal answer too", async () => {
    const response = await createApp(config).handle(
      new Request("http://localhost/api/v1/health", { headers: { Origin: ALLOWED_ORIGIN } }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
  });

  it("adds no permission to a normal answer for another origin", async () => {
    const response = await createApp(config).handle(
      new Request("http://localhost/api/v1/health", { headers: { Origin: STRANGER_ORIGIN } }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});
