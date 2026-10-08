/*
 * Token helpers for the Auth Service. The access token is a short lived JWT (HS256) that the
 * backend checks by signature only. The refresh token is a random string; the database stores
 * only its SHA-256 hash, so a leaked database cannot be used to log in.
 */
import { createHash, randomBytes } from "node:crypto";

import { jwtVerify, SignJWT } from "jose";

const REFRESH_TOKEN_PREFIX = "r_";
const REFRESH_TOKEN_BYTES = 32;
const MS_PER_SECOND = 1000;
const JWT_ALGORITHM = "HS256";

/** Settings for the token service. `now` is replaceable so tests can control the time. */
export interface TokenServiceOptions {
  /** Secret used to sign access tokens (JWT_SECRET). */
  secret: string;
  /** How long an access token is valid, in seconds. */
  accessTtlSeconds: number;
  now?: () => Date;
}

/** Creates and checks access and refresh tokens. */
export interface TokenService {
  /**
   * @param userId - the user the token is for
   * @returns a signed JWT that expires after the access token life
   */
  signAccessToken(userId: string): Promise<string>;

  /**
   * @param token - an access token from a request
   * @returns the user ID inside the token, or null if the token is malformed, tampered with or
   *   expired
   */
  verifyAccessToken(token: string): Promise<string | null>;

  /** @returns a new random refresh token */
  createRefreshToken(): string;

  /**
   * @param token - a refresh token
   * @returns its SHA-256 hash as hex, the form the database stores
   */
  hashRefreshToken(token: string): string;
}

/**
 * Create the token service.
 * @param options - signing secret, access token life and optional clock
 * @returns the token service
 */
export function createTokenService(options: TokenServiceOptions): TokenService {
  const key = new TextEncoder().encode(options.secret);
  const now = options.now ?? (() => new Date());

  return {
    async signAccessToken(userId) {
      const issuedAt = Math.floor(now().getTime() / MS_PER_SECOND);
      return new SignJWT({})
        .setProtectedHeader({ alg: JWT_ALGORITHM })
        .setSubject(userId)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + options.accessTtlSeconds)
        .sign(key);
    },

    async verifyAccessToken(token) {
      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: [JWT_ALGORITHM],
          currentDate: now(),
        });
        return typeof payload.sub === "string" && payload.sub !== "" ? payload.sub : null;
      } catch {
        return null;
      }
    },

    createRefreshToken() {
      return REFRESH_TOKEN_PREFIX + randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
    },

    hashRefreshToken(token) {
      return createHash("sha256").update(token).digest("hex");
    },
  };
}
