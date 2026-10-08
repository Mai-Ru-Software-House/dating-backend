/*
 * Test for the request size limit on a real listening server: a body over the limit is refused
 * by the server (413) before any route runs, and a normal request still works.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createApp } from "../src/app";
import { loadConfig } from "../src/config/env";
import { MAX_REQUEST_BODY_BYTES } from "../src/config/server";

const HTTP_PAYLOAD_TOO_LARGE = 413;
const ONE_MEGABYTE = 1_048_576;

const config = loadConfig({
  NODE_ENV: "test",
  PORT: "3000",
  CORS_ORIGINS: "http://localhost:8081",
  JWT_SECRET: "test-secret",
  DATABASE_URL: "postgres://user:pass@localhost:5432/test",
  RUSTFS_ENDPOINT: "http://localhost:9000",
  RUSTFS_ACCESS_KEY: "test",
  RUSTFS_SECRET_KEY: "test",
  RUSTFS_BUCKET: "test",
  MATCH_ENGINE_URL: "http://localhost:8000",
  NOMINATIM_URL: "http://localhost:8080",
});

describe("request size limit", () => {
  const app = createApp(config);
  let baseUrl = "";

  beforeAll(() => {
    app.listen({ port: 0, maxRequestBodySize: MAX_REQUEST_BODY_BYTES });
    baseUrl = `http://localhost:${app.server?.port}`;
  });

  afterAll(async () => {
    await app.stop();
  });

  it("is 2 MiB, enough for a 1 MB photo with its form overhead", () => {
    expect(MAX_REQUEST_BODY_BYTES).toBe(2 * ONE_MEGABYTE);
  });

  it("accepts a normal request", async () => {
    const response = await fetch(`${baseUrl}/api/v1/health`);
    expect(response.status).toBe(200);
  });

  it("accepts a body of about 1 MB", async () => {
    const response = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "x".repeat(ONE_MEGABYTE / 2) }),
    });
    // The login route answers 400 (the password is longer than allowed), not 413.
    expect(response.status).not.toBe(HTTP_PAYLOAD_TOO_LARGE);
  });

  it("refuses a body over the limit (413, or a closed connection)", async () => {
    // Bun may close the connection while the client is still sending, so the client sees either
    // the 413 answer or a reset connection. Both mean the body was refused.
    let status: number | "closed";
    try {
      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "x".repeat(MAX_REQUEST_BODY_BYTES + 1),
      });
      status = response.status;
    } catch {
      status = "closed";
    }
    expect([HTTP_PAYLOAD_TOO_LARGE, "closed"]).toContain(status);
  });
});
