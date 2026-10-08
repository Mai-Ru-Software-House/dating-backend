/*
 * Tests for loadConfig: required variables, defaults for the optional ones and number parsing.
 */
import { describe, expect, it } from "bun:test";

import { ConfigError, loadConfig } from "../../src/config/env";

const REQUIRED = {
  CORS_ORIGINS: "http://localhost:8081",
  JWT_SECRET: "test-secret",
  DATABASE_URL: "postgres://mairu:pw@localhost:5432/mairu",
  RUSTFS_ENDPOINT: "http://localhost:9000",
  RUSTFS_ACCESS_KEY: "key",
  RUSTFS_SECRET_KEY: "secret",
  RUSTFS_BUCKET: "photos",
  MATCH_ENGINE_URL: "http://localhost:8000",
  NOMINATIM_URL: "https://nominatim.example.org",
};

describe("loadConfig", () => {
  it("fills in defaults for the optional variables", () => {
    const config = loadConfig(REQUIRED);
    expect(config.accessTokenTtlSeconds).toBe(900);
    expect(config.refreshTokenTtlDays).toBe(30);
    expect(config.argon2MemoryCost).toBe(65536);
    expect(config.argon2TimeCost).toBe(3);
    expect(config.matchEngineTimeoutMs).toBe(5000);
    expect(config.jwtSecret).toBe("test-secret");
  });

  it("reads the optional variables when they are set", () => {
    const config = loadConfig({ ...REQUIRED, ACCESS_TOKEN_TTL_SECONDS: "60" });
    expect(config.accessTokenTtlSeconds).toBe(60);
  });

  it("rejects a missing JWT_SECRET", () => {
    const withoutSecret: Record<string, string | undefined> = { ...REQUIRED };
    delete withoutSecret.JWT_SECRET;
    expect(() => loadConfig(withoutSecret)).toThrow(ConfigError);
  });

  it("rejects an optional variable that is not a positive whole number", () => {
    expect(() => loadConfig({ ...REQUIRED, ACCESS_TOKEN_TTL_SECONDS: "0" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...REQUIRED, ARGON2_TIME_COST: "fast" })).toThrow(ConfigError);
  });
});
