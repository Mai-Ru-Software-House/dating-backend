/*
 * Favorites & Notes routes: GET /favorites, PUT and DELETE /favorites/{userId}, and the notes
 * routes GET and POST /notes, GET /notes/people, plus GET and POST /users/{userId}/notes (the
 * paths the functional test plan uses, NT07 and NT08). Every route needs a logged in user.
 * Handlers only check types with `t` and call the Favorites & Notes Service, which checks the
 * rules.
 */
import { Elysia, t } from "elysia";

import { requireSession } from "../../plugins/session";
import type { SessionValidator } from "../auth/sessionValidator";
import type { FavoritesNotesService } from "./favoritesNotesService";

const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;
const JSON_ONLY = "json";
const FAVORITES_TAGS = ["Favorites"];
const NOTES_TAGS = ["Notes"];

const userSummarySchema = t.Object({
  userId: t.String(),
  displayName: t.String(),
  photoId: t.String(),
});

const noteSchema = t.Object({
  noteId: t.String(),
  aboutUserId: t.String(),
  text: t.String(),
  createdAt: t.String({ description: "UTC ISO 8601 ending in Z, set by the server" }),
});

const userIdParams = t.Object({ userId: t.String() });
const noteTextBody = t.Object({
  text: t.String({ description: "1 to 500 characters after trimming" }),
});

/**
 * Build the Elysia plugin with the Favorites and Notes routes.
 * @param service - the Favorites & Notes Service
 * @param validateSession - Auth Service function that checks the access token
 * @returns an Elysia plugin to register with `.use()`
 * @throws ApiError (inside the routes) 401 without a valid token, and every error of the
 *   Favorites & Notes Service
 */
export function favoritesNotesRoutes(
  service: FavoritesNotesService,
  validateSession: SessionValidator,
) {
  return new Elysia({ name: "favorites-notes-routes", prefix: "/api/v1" })
    .use(requireSession(validateSession))
    .get("/favorites", ({ session }) => service.listFavorites(session.userId), {
      response: {
        200: t.Object({
          favorites: t.Array(t.Object({ user: userSummarySchema, createdAt: t.String() })),
        }),
      },
      detail: { summary: "My favorites, newest first", tags: FAVORITES_TAGS },
    })
    .put(
      "/favorites/:userId",
      ({ session, params }) => service.addFavorite(session.userId, params.userId),
      {
        params: userIdParams,
        response: { 200: t.Object({ userId: t.String(), createdAt: t.String() }) },
        detail: { summary: "Add a favorite (safe to repeat)", tags: FAVORITES_TAGS },
      },
    )
    .delete(
      "/favorites/:userId",
      async ({ session, params, status }) => {
        await service.removeFavorite(session.userId, params.userId);
        return status(HTTP_NO_CONTENT);
      },
      {
        params: userIdParams,
        detail: {
          summary: "Remove a favorite (also 204 when it was not one)",
          tags: FAVORITES_TAGS,
        },
      },
    )
    .get("/notes", ({ session, query }) => service.listNotes(session.userId, query.aboutUserId), {
      query: t.Object({ aboutUserId: t.String({ minLength: 1 }) }),
      response: { 200: t.Object({ notes: t.Array(noteSchema) }) },
      detail: { summary: "My notes about one user, newest first", tags: NOTES_TAGS },
    })
    .post(
      "/notes",
      async ({ session, body, status }) =>
        status(HTTP_CREATED, await service.createNote(session.userId, body.aboutUserId, body.text)),
      {
        parse: JSON_ONLY,
        body: t.Object({
          aboutUserId: t.String({ minLength: 1 }),
          text: t.String({ description: "1 to 500 characters after trimming" }),
        }),
        response: { [HTTP_CREATED]: noteSchema },
        detail: { summary: "Record a private note about a user", tags: NOTES_TAGS },
      },
    )
    .get("/notes/people", ({ session }) => service.listNotePeople(session.userId), {
      response: {
        200: t.Object({
          people: t.Array(
            t.Object({
              user: userSummarySchema,
              noteCount: t.Integer(),
              lastNote: t.Object({ noteId: t.String(), text: t.String(), createdAt: t.String() }),
            }),
          ),
        }),
      },
      detail: { summary: "People I wrote notes about, newest note first", tags: NOTES_TAGS },
    })
    .get(
      "/users/:userId/notes",
      ({ session, params }) => service.listNotes(session.userId, params.userId),
      {
        params: userIdParams,
        response: { 200: t.Object({ notes: t.Array(noteSchema) }) },
        detail: {
          summary: "Same as GET /notes?aboutUserId= (path used by the test plan)",
          tags: NOTES_TAGS,
        },
      },
    )
    .post(
      "/users/:userId/notes",
      async ({ session, params, body, status }) =>
        status(HTTP_CREATED, await service.createNote(session.userId, params.userId, body.text)),
      {
        params: userIdParams,
        parse: JSON_ONLY,
        body: noteTextBody,
        response: { [HTTP_CREATED]: noteSchema },
        detail: {
          summary: "Same as POST /notes (path used by the test plan)",
          tags: NOTES_TAGS,
        },
      },
    );
}
