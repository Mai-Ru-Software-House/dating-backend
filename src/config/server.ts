/*
 * Settings of the HTTP server itself (not read from the environment): the largest request body
 * the server accepts. A profile photo is at most 5 MB, and the multipart overhead is small, so
 * 6 MiB is enough for every request of the app. Bun refuses a larger body before any route
 * runs, so that answer (413) is not in the team error shape. Nginx has the same limit
 * (`client_max_body_size 6m`, see docs/infra.md).
 */

/** The largest request body in bytes: 6 MiB. */
export const MAX_REQUEST_BODY_BYTES = 6_291_456;
