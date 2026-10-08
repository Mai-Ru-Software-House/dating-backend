/*
 * Tests for the token service: access token life, tampering and refresh token hashing.
 */
import { describe, expect, it } from "bun:test";
import { SignJWT } from "jose";

import { createTokenService } from "../../src/services/auth/tokens";
import { createFixedClock } from "../messaging/fixtures";
import { ACCESS_TTL_SECONDS, TEST_JWT_SECRET } from "./fixtures";

const MS_PER_SECOND = 1000;

function setup() {
  const clock = createFixedClock();
  const tokens = createTokenService({
    secret: TEST_JWT_SECRET,
    accessTtlSeconds: ACCESS_TTL_SECONDS,
    now: clock.now,
  });
  return { clock, tokens };
}

describe("access tokens", () => {
  it("round trips the user ID", async () => {
    const { tokens } = setup();
    const token = await tokens.signAccessToken("usr_alice");
    expect(await tokens.verifyAccessToken(token)).toBe("usr_alice");
  });

  it("is valid until the end of its life and not after (functional test LG09)", async () => {
    const { clock, tokens } = setup();
    const token = await tokens.signAccessToken("usr_alice");
    clock.advance((ACCESS_TTL_SECONDS - 1) * MS_PER_SECOND);
    expect(await tokens.verifyAccessToken(token)).toBe("usr_alice");
    clock.advance(2 * MS_PER_SECOND);
    expect(await tokens.verifyAccessToken(token)).toBeNull();
  });

  it("rejects a token signed with another secret", async () => {
    const { clock, tokens } = setup();
    const other = createTokenService({
      secret: "another-secret",
      accessTtlSeconds: ACCESS_TTL_SECONDS,
      now: clock.now,
    });
    expect(await tokens.verifyAccessToken(await other.signAccessToken("usr_alice"))).toBeNull();
  });

  it("rejects a token whose payload was changed", async () => {
    const { tokens } = setup();
    const token = await tokens.signAccessToken("usr_alice");
    const [header, , signature] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ sub: "usr_bob", exp: 9999999999 })).toString(
      "base64url",
    );
    expect(await tokens.verifyAccessToken(`${header}.${forgedPayload}.${signature}`)).toBeNull();
  });

  it("rejects an unsigned token and text that is not a token", async () => {
    const { tokens } = setup();
    const unsigned = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(
      '{"sub":"usr_alice"}',
    ).toString("base64url")}.`;
    expect(await tokens.verifyAccessToken(unsigned)).toBeNull();
    expect(await tokens.verifyAccessToken("fake-token")).toBeNull();
    expect(await tokens.verifyAccessToken("")).toBeNull();
  });

  it("rejects a token signed with another algorithm", async () => {
    const { tokens } = setup();
    const key = new TextEncoder().encode(TEST_JWT_SECRET);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS512" })
      .setSubject("usr_alice")
      .setExpirationTime("1h")
      .sign(key);
    expect(await tokens.verifyAccessToken(token)).toBeNull();
  });

  it("rejects a token without a subject", async () => {
    const { tokens } = setup();
    const key = new TextEncoder().encode(TEST_JWT_SECRET);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(key);
    expect(await tokens.verifyAccessToken(token)).toBeNull();
  });
});

describe("refresh tokens", () => {
  it("are random and long", () => {
    const { tokens } = setup();
    const first = tokens.createRefreshToken();
    expect(first).not.toBe(tokens.createRefreshToken());
    expect(first.length).toBeGreaterThan(40);
  });

  it("are stored as a SHA-256 hex hash that does not contain the token", () => {
    const { tokens } = setup();
    const token = tokens.createRefreshToken();
    const hash = tokens.hashRefreshToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(tokens.hashRefreshToken(token));
    expect(hash).not.toContain(token);
  });
});
