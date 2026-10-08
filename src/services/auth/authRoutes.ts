/*
 * Auth routes: POST /api/v1/sessions (login), POST /api/v1/sessions/refresh and
 * DELETE /api/v1/sessions/current (logout). Bodies are JSON only. Login and refresh need no
 * session; logout needs the access token. Handlers only check types with `t` and call the
 * Auth Service.
 */
import { Elysia, t } from "elysia";

import { requireSession } from "../../plugins/session";
import type { AuthService } from "./authService";

const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;
const JSON_ONLY = "json";
const TAGS = ["Auth"];
const MAX_USERNAME_LENGTH = 100;
/** Longest password login reads. Sign up uses the same limit, so every new password can log in. */
export const MAX_PASSWORD_LENGTH = 1000;
const MAX_TOKEN_LENGTH = 500;

const tokenPairSchema = t.Object({ accessToken: t.String(), refreshToken: t.String() });

/**
 * Build the Elysia plugin with the Auth routes.
 * @param service - the Auth Service
 * @returns an Elysia plugin to register with `.use()`
 * @throws ApiError (inside the routes) 401 INVALID_CREDENTIALS at login, 401 UNAUTHENTICATED
 *   for a bad refresh token or a missing access token at logout
 */
export function authRoutes(service: AuthService) {
  return new Elysia({ name: "auth-routes", prefix: "/api/v1" })
    .post(
      "/sessions",
      async ({ body, status }) =>
        status(HTTP_CREATED, await service.login(body.username, body.password)),
      {
        parse: JSON_ONLY,
        body: t.Object({
          username: t.String({ minLength: 1, maxLength: MAX_USERNAME_LENGTH }),
          password: t.String({ minLength: 1, maxLength: MAX_PASSWORD_LENGTH }),
        }),
        response: { [HTTP_CREATED]: tokenPairSchema },
        detail: { summary: "Log in with username and password", tags: TAGS },
      },
    )
    .post("/sessions/refresh", ({ body }) => service.refresh(body.refreshToken), {
      parse: JSON_ONLY,
      body: t.Object({ refreshToken: t.String({ minLength: 1, maxLength: MAX_TOKEN_LENGTH }) }),
      response: { 200: tokenPairSchema },
      detail: { summary: "Swap a refresh token for a new token pair", tags: TAGS },
    })
    .use(requireSession(service.validateSession))
    .delete(
      "/sessions/current",
      async ({ session, body, status }) => {
        await service.logout(session.userId, body?.refreshToken);
        return status(HTTP_NO_CONTENT);
      },
      {
        parse: JSON_ONLY,
        body: t.Optional(
          t.Object({ refreshToken: t.Optional(t.String({ maxLength: MAX_TOKEN_LENGTH })) }),
        ),
        detail: {
          summary: "Log out and cancel the refresh token",
          description:
            "Send the refresh token in the body to cancel that one. Without a body, every refresh token of the user is cancelled.",
          tags: TAGS,
        },
      },
    );
}
