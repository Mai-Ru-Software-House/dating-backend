/*
 * Profile routes (Chuan): GET /api/v1/usernames/{username} and POST /api/v1/users need no
 * session (the user has no account yet); GET and PATCH /api/v1/users/me and
 * GET /api/v1/users/{userId} need the access token. Bodies are JSON only. Handlers only check
 * types with `t` and call the Profile Service, which checks the rules and names the field.
 */
import { Elysia, t } from "elysia";

import { requireSession } from "../../plugins/session";
import type { SessionValidator } from "../auth/sessionValidator";
import type { ProfileService } from "./profileService";

const HTTP_CREATED = 201;
const JSON_ONLY = "json";
const TAGS = ["Profile"];

const locationSchema = t.Object({
  lat: t.Number({ description: "-90 to 90" }),
  lon: t.Number({ description: "-180 to 180" }),
});

const preferencesSchema = t.Object({
  minAge: t.Number({ description: "Whole number, at least 18, not above maxAge" }),
  maxAge: t.Number({ description: "Whole number, at most 120" }),
  targetGenders: t.Array(t.String(), { description: "One or more gender codes" }),
  radiusKm: t.Number({ description: "Whole km, 1 to 20000" }),
});

const ownProfileSchema = t.Object({
  userId: t.String(),
  username: t.String(),
  displayName: t.String(),
  dateOfBirth: t.String({ description: "YYYY-MM-DD" }),
  gender: t.String(),
  location: locationSchema,
  placeName: t.Nullable(t.String({ description: '"province, district" in English' })),
  photoUrl: t.String({ description: "Path of the profile photo, /api/v1/photos/{photoId}" }),
  preferences: preferencesSchema,
});

const publicProfileSchema = t.Object({
  userId: t.String(),
  username: t.String(),
  displayName: t.String(),
  photoUrl: t.String(),
  age: t.Integer(),
  gender: t.String(),
  placeName: t.Nullable(t.String()),
  distanceKm: t.Integer({ description: "Whole km from my saved location, at least 1" }),
  matchScore: t.Integer({ description: "0 to 100; 0 when we do not fit each other both ways" }),
  lookingFor: preferencesSchema,
  isFavorite: t.Boolean(),
});

/**
 * Build the Elysia plugin with the Profile routes.
 * @param service - the Profile Service
 * @param validateSession - Auth Service function that checks the access token
 * @returns an Elysia plugin to register with `.use()`
 * @throws ApiError (inside the routes) 400 for a broken rule, 401 without a valid token on the
 *   protected routes, 404 USER_NOT_FOUND, 409 USERNAME_TAKEN
 */
export function profileRoutes(service: ProfileService, validateSession: SessionValidator) {
  return new Elysia({ name: "profile-routes", prefix: "/api/v1" })
    .get("/usernames/:username", ({ params }) => service.checkUsername(params.username), {
      params: t.Object({ username: t.String() }),
      response: { 200: t.Object({ isAvailable: t.Boolean() }) },
      detail: { summary: "Is this username still free? (case insensitive)", tags: TAGS },
    })
    .post("/users", async ({ body, status }) => status(HTTP_CREATED, await service.signUp(body)), {
      parse: JSON_ONLY,
      body: t.Object({
        username: t.String(),
        password: t.String(),
        displayName: t.String(),
        dateOfBirth: t.String({ description: "YYYY-MM-DD, at least 18 years ago" }),
        gender: t.String(),
        location: locationSchema,
        photoUploadId: t.String({ description: "The uploadId from POST /photo-uploads" }),
        preferences: preferencesSchema,
      }),
      response: {
        [HTTP_CREATED]: t.Object({
          accessToken: t.String(),
          refreshToken: t.String(),
          profile: ownProfileSchema,
        }),
      },
      detail: { summary: "Create a profile (sign up) and log in", tags: TAGS },
    })
    .use(requireSession(validateSession))
    .get("/users/me", ({ session }) => service.getOwnProfile(session.userId), {
      response: { 200: ownProfileSchema },
      detail: { summary: "My own profile", tags: TAGS },
    })
    .patch("/users/me", ({ session, body }) => service.updateOwnProfile(session.userId, body), {
      parse: JSON_ONLY,
      body: t.Object({
        displayName: t.Optional(t.String()),
        dateOfBirth: t.Optional(t.String()),
        gender: t.Optional(t.String()),
        location: t.Optional(locationSchema),
        preferences: t.Optional(preferencesSchema),
        username: t.Optional(t.Unknown({ description: "Cannot be changed: sending it is a 400" })),
      }),
      response: { 200: ownProfileSchema },
      detail: {
        summary: "Edit my profile",
        description:
          "Send any of displayName, dateOfBirth, gender, location and preferences (whole). The photo has its own endpoint.",
        tags: TAGS,
      },
    })
    .get(
      "/users/:userId",
      ({ session, params }) => service.getPublicProfile(session.userId, params.userId),
      {
        params: t.Object({ userId: t.String() }),
        response: { 200: publicProfileSchema },
        detail: { summary: "Another user's profile, with match score", tags: TAGS },
      },
    );
}
