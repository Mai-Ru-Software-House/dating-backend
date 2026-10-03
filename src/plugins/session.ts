/*
 * Session check: a plugin that protects the routes registered after it. It reads the token
 * from the Authorization header, asks the Auth Service to validate it and adds `session` to
 * the request context. Cookie or bearer token is still an open decision (docs/decisions.md),
 * so this reads "Authorization: Bearer <token>" as a proposal.
 */
import { Elysia } from "elysia";

import type { SessionValidator } from "../services/auth/sessionValidator";
import { ApiError, ERROR_CODES } from "./errors";

const HTTP_UNAUTHORIZED = 401;
const BEARER_PREFIX = "Bearer ";

function readToken(authorization: string | undefined): string | null {
  if (authorization === undefined || !authorization.startsWith(BEARER_PREFIX)) {
    return null;
  }
  const token = authorization.slice(BEARER_PREFIX.length).trim();
  return token === "" ? null : token;
}

/**
 * Build the session check plugin.
 * @param validate - Auth Service function that looks up a session token
 * @returns an Elysia plugin; routes after `.use()` get `session` in their context
 * @throws ApiError 401 UNAUTHENTICATED when the token is missing, unknown or expired
 */
export function requireSession(validate: SessionValidator) {
  return new Elysia({ name: "require-session" }).resolve({ as: "scoped" }, async ({ headers }) => {
    const token = readToken(headers.authorization);
    const session = token === null ? null : await validate(token);
    if (session === null) {
      throw new ApiError(
        HTTP_UNAUTHORIZED,
        ERROR_CODES.unauthenticated,
        "You need to log in to do this.",
      );
    }
    return { session };
  });
}
