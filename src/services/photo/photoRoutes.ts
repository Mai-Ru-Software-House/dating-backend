/*
 * Photo routes (Tae): POST and DELETE /api/v1/photo-uploads need no session (the user has no
 * account yet during Create Profile), PUT /api/v1/users/me/photo and GET /api/v1/photos/{photoId}
 * need the access token. The upload and change routes take a multipart file part named `photo`;
 * the service checks the rules and names the field.
 */
import { Elysia, t } from "elysia";

import { ApiError, ERROR_CODES } from "../../plugins/errors";
import { requireSession } from "../../plugins/session";
import type { SessionValidator } from "../auth/sessionValidator";
import type { PhotoService } from "./photoService";

const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const TAGS = ["Photo"];

const uploadSchema = t.Object({
  uploadId: t.String({ description: "Send it back with the sign up as photoUploadId" }),
  expiresAt: t.String({ description: "UTC ISO 8601, one hour after the upload" }),
  deleteToken: t.String({
    description: "Proves who may delete the upload (header X-Delete-Token)",
  }),
});

/**
 * Build the Elysia plugin with the photo routes.
 * @param service - the Photo Service
 * @param validateSession - Auth Service function that checks the access token
 * @returns an Elysia plugin to register with `.use()`
 * @throws ApiError (inside the routes) 400 for a broken photo rule, 401 without a valid token
 *   on the protected routes, 404 for an unknown upload or photo
 */
export function photoRoutes(service: PhotoService, validateSession: SessionValidator) {
  const missingPhoto = () =>
    new ApiError(
      HTTP_BAD_REQUEST,
      ERROR_CODES.invalidInput,
      "A photo file is missing from the request.",
      "photo",
    );

  return new Elysia({ name: "photo-routes", prefix: "/api/v1" })
    .post(
      "/photo-uploads",
      async ({ body, set }) => {
        set.status = HTTP_CREATED;
        if (body.photo === undefined) {
          throw missingPhoto();
        }
        // The contract answers the expiry as a UTC ISO 8601 string.
        const upload = await service.saveUpload(body.photo);
        return {
          uploadId: upload.uploadId,
          expiresAt: upload.expiresAt.toISOString(),
          deleteToken: upload.deleteToken,
        };
      },
      {
        parse: "multipart/form-data",
        body: t.Object({ photo: t.Optional(t.File()) }),
        response: { [HTTP_CREATED]: uploadSchema },
        detail: {
          summary: "Upload a profile photo before sign up",
          description:
            "Kept one hour under a temporary key. Rules: png, jpg, jpeg or webp, at most 1 MB; a photo that is not 1:1 is center-cropped to a square.",
          tags: TAGS,
        },
      },
    )
    .delete(
      "/photo-uploads/:uploadId",
      async ({ params, headers, set }) => {
        set.status = HTTP_NO_CONTENT;
        await service.deleteUpload(params.uploadId, headers["x-delete-token"]);
      },
      {
        params: t.Object({ uploadId: t.String() }),
        headers: t.Object({ "x-delete-token": t.Optional(t.String()) }),
        response: { [HTTP_NO_CONTENT]: t.Void() },
        detail: {
          summary: "Remove a temporary upload",
          description:
            "The header X-Delete-Token carries the deleteToken. Answers 404 UPLOAD_NOT_FOUND for an unknown or expired upload or a wrong token (the same answer for all three).",
          tags: TAGS,
        },
      },
    )
    .use(requireSession(validateSession))
    .put(
      "/users/me/photo",
      async ({ session, body }) => {
        if (body.photo === undefined) {
          throw missingPhoto();
        }
        return { photoUrl: await service.changePhoto(session.userId, body.photo) };
      },
      {
        parse: "multipart/form-data",
        body: t.Object({ photo: t.Optional(t.File()) }),
        response: { 200: t.Object({ photoUrl: t.String() }) },
        detail: {
          summary: "Change my profile photo",
          description:
            "The new photo replaces the old one; the old object is deleted after the swap.",
          tags: TAGS,
        },
      },
    )
    .get(
      "/photos/:photoId",
      async ({ params }) => {
        const photo = await service.getPhoto(params.photoId);
        // A Buffer satisfies the Response body type (a plain Uint8Array does not).
        return new Response(Buffer.from(photo.bytes), {
          headers: {
            "content-type": photo.contentType,
            "cache-control": "private",
            "x-content-type-options": "nosniff",
          },
        });
      },
      {
        params: t.Object({ photoId: t.String() }),
        response: { 200: t.String({ format: "binary", description: "The image bytes" }) },
        detail: { summary: "The profile photo of a user", tags: TAGS },
      },
    );
}
