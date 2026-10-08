/*
 * Match routes: GET /api/v1/recommendations and GET /api/v1/candidates (docs/api-contract.md,
 * Matching section). Both need a logged in user. Handlers only check types with `t` and call
 * the Match Service, which checks the rules.
 */
import { Elysia, t } from "elysia";

import { requireSession } from "../../plugins/session";
import type { SessionValidator } from "../auth/sessionValidator";
import type { MatchService } from "./matchService";

const TAGS = ["Matching"];

const cardSchema = t.Object({
  userId: t.String(),
  username: t.String(),
  displayName: t.String(),
  photoUrl: t.String({
    description: "Path of the profile photo, for example /api/v1/photos/pho_b2",
  }),
  age: t.Integer(),
  gender: t.String(),
  placeName: t.Nullable(t.String()),
  distanceKm: t.Integer({ description: "Whole km, at least 1" }),
  matchScore: t.Optional(t.Integer({ description: "0 to 100, recommendations only" })),
});

function toList(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return (Array.isArray(value) ? value : [value]).filter((item) => item !== "");
}

/**
 * Build the Elysia plugin with the Match routes.
 * @param service - the Match Service
 * @param validateSession - Auth Service function that checks the access token
 * @returns an Elysia plugin to register with `.use()`
 * @throws ApiError (inside the routes) 401 without a valid token, 400 for a bad value, 500
 *   MATCH_ENGINE_UNAVAILABLE when the engine fails
 */
export function matchRoutes(service: MatchService, validateSession: SessionValidator) {
  return new Elysia({ name: "match-routes", prefix: "/api/v1" })
    .use(requireSession(validateSession))
    .get(
      "/recommendations",
      ({ session, query }) => service.getRecommendations(session.userId, query),
      {
        query: t.Object({
          limit: t.Optional(t.Numeric({ description: "Page size, 1 to 50, default 10" })),
          offset: t.Optional(t.Numeric({ description: "Cards the app already has, default 0" })),
        }),
        response: {
          200: t.Object({ recommendations: t.Array(cardSchema), hasMore: t.Boolean() }),
        },
        detail: { summary: "Recommended matches who fit both ways, best first", tags: TAGS },
      },
    )
    .get(
      "/candidates",
      ({ session, query }) =>
        service.searchCandidates(session.userId, {
          ...query,
          targetGenders: toList(query.targetGenders),
        }),
      {
        query: t.Object({
          minAge: t.Optional(t.Numeric()),
          maxAge: t.Optional(t.Numeric()),
          targetGenders: t.Optional(t.Union([t.String(), t.Array(t.String())])),
          maxDistanceKm: t.Optional(t.Numeric()),
          lat: t.Optional(t.Numeric()),
          lon: t.Optional(t.Numeric()),
          limit: t.Optional(t.Numeric({ description: "1 to 50, default 20" })),
        }),
        response: { 200: t.Object({ candidates: t.Array(cardSchema) }) },
        detail: {
          summary: "Search by specification, nearest first. Missing values use my own preferences.",
          tags: TAGS,
        },
      },
    );
}
