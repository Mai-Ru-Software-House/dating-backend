/*
 * Test for GET /api/v1/health: the route answers 200 with status "ok" and a server
 * timestamp in ISO 8601 UTC.
 */
import { describe, expect, it } from "bun:test";

import { createApp } from "../src/app";
import { loadConfig } from "../src/config/env";

const testConfig = loadConfig({
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

describe("GET /api/v1/health", () => {
  it("returns status ok and an ISO 8601 UTC timestamp", async () => {
    const app = createApp(testConfig);

    const response = await app.handle(new Request("http://localhost/api/v1/health"));
    const body = (await response.json()) as { status: string; timestamp: string };

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });
});
