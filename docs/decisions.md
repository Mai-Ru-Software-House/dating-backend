# Decisions

What the team has decided about the backend, and what is still open. Check this page before making a design choice. If a task needs an open question answered, ask the owner instead of guessing. Last cleaned on 9 October 2026, after Chuan's Profile Service (PR #5).

## Decided

| Topic | Decision | Who, when |
| --- | --- | --- |
| Process | Scrum, 8 weeks. One repository each for infra, backend, frontend and the Match Engine. This repo holds `docs/api-contract.md` as the API source of truth | Team |
| Stack | Elysia on Bun (TypeScript), PostgreSQL 18 with Prisma 7.10.0 (pinned: the npm `latest` tag is a release candidate), FastAPI for the engine, RustFS for photos, Nominatim for place names | Team, Chuan |
| Platform | Mobile app (React Native) with a server backend. Real login with a password (Argon2id), not a "type a username" switch | Team |
| API style | `/api/v1/...`, plural nouns, camelCase JSON, one error shape `{ error: { code, message, field? } }`, UTC ISO 8601 times ending in Z, IDs are UUID version 7 strings | Standards |
| Sessions | Access token: JWT (HS256, `JWT_SECRET`), 15 minutes by default, checked by signature only. Refresh token: random, 30 days by default, stored only as a SHA-256 hash, rotated on every use. Both lifetimes are settings. An expired access token answers `401 UNAUTHENTICATED`, which the app refreshes on. Logout cancels the refresh token. Trade off: after logout the access token works until it expires | Vic, Chuan (8 Oct) |
| Rules from the functional test plan | A1 username 4 to 20 letters, digits and underscore, stored in lowercase. A2 password at least 8 characters with a letter and a digit. A3 minimum age 18. A5 profile photo png, jpg, jpeg or webp, at most 1 MB; a photo that is not 1:1 is center-cropped to a square (10 Oct, Tae). A6 message 1 to 1000 characters. A7 note 1 to 500 characters. A8 if the place lookup fails, the profile is still saved with no place name | Team (6 Oct) |
| Messaging | Text only: no chat photos and no message delete. Send message is JSON only. Opening a conversation marks its messages as read. `PATCH /conversations/{userId}` takes `{ "isRead": true }` | Team (6 Oct) |
| Photos | Profile photos only. The backend stores and serves them (no presigned URLs). The photo functions are code inside this repo (`src/services/photo/`), written by Tae. The API sends `photoUrl`, the path `/api/v1/photos/{photoId}` | Tae (4 Oct), Vic (9 Oct) |
| Photo upload flow | Follows the app (Tee): the photo is uploaded first with `POST /photo-uploads` (no session, kept one hour, answer `uploadId`, `expiresAt`, `deleteToken`), can be removed with `DELETE /photo-uploads/{uploadId}` and the header `X-Delete-Token`, and the sign up is JSON with `photoUploadId`. A later change uses `PUT /users/me/photo`. This replaces the one request sign up that Tae chose on 4 Oct | Vic, Tee, Tae (9 Oct) |
| Bio and interests | Dropped. The profile has no bio and no interests | Team (9 Oct) |
| Match search | The engine's search stays one way, so the backend keeps its pre-filter (the candidate must accept the user). A pool of 2000 candidates is fine for the engine (about 30 ms) | Vic (9 Oct), from the engine repo |
| Place names | Built from Nominatim by one builder in the Location Service, stored with the profile at sign up (never looked up when reading). Format "province, district" in English, for example "Bangkok, Pathum Wan". The district is the value whose name says "District" (or starts with Khet or Amphoe), never a subdistrict. Cached 24 hours by coordinates rounded to 3 decimals, at most 1 request per second to Nominatim | Vic (8 Oct) |
| Matching data flow | The backend **pushes** the user and the candidates to the engine in each request and follows the engine's own packets. The engine never reads our database. No internal server, no `X-Internal-Key` | Vic (8 Oct) |
| Matching rules | The mutual rule (test plan A11) is applied to recommendations and to search, so an empty search returns the same people as the recommendations. The engine score (0 to 100, one decimal) is rounded to a whole number. Distance is whole km, at least 1. Paging uses `offset`, `offset + limit` is at most 200 | Vic (8 Oct) |
| Engine failure | Any engine problem is `500 MATCH_ENGINE_UNAVAILABLE`. A user with nobody to show gets an empty list and the engine is not called | Vic (8 Oct) |
| Favorites and notes | A favorite is private and safe to add twice. Favorites come first in the chat list. Notes are private to their author; the paths `/users/{userId}/notes` are aliases of `/notes` (used by the test plan) | Vic (8 Oct) |
| Note edit and delete | `PATCH` and `DELETE /notes/{noteId}` are built, because the app has the edit and delete screens. Only the author can use them. A note that does not exist, is not yours, or has a bad ID is one answer, `404 NOTE_NOT_FOUND`. A note has `updatedAt`, `null` until it is edited. The text limit stays 500 characters (the app and test plan A7; the database column allows 2000) | Vic (9 Oct) |
| Database | Chuan's schema (PR #3). IDs made by the database with `uuidv7()`. The database has no CHECK rules, so the services check every rule. The generated Prisma client is committed in `src/generated` | Chuan |
| Images | The backend image is tagged with the commit hash. Only `main` moves `:dev`. The container applies migrations when it starts (to be agreed with Chuan and Tae, see Open) | Vic (8 Oct) |
| Server | The server refuses a request body over 2 MiB (413, before any route), stops cleanly on `SIGTERM` and `SIGINT` (finishes requests, closes the database, exits 0), and CORS allows only the origins in `CORS_ORIGINS` | Vic (9 Oct) |
| File storage | Tae sets up RustFS: the bucket, its access keys and the upload clean up. The backend only needs `RUSTFS_ENDPOINT`, `RUSTFS_ACCESS_KEY`, `RUSTFS_SECRET_KEY` and `RUSTFS_BUCKET` | Tae (9 Oct) |
| Docs | The docs in `docs/` are public (the repos are public): no secrets, no personal paths, first names only. Notes that only live on one machine are in `local-docs/` (git ignored) | Vic (9 Oct) |
| Gender values | Four values: `female`, `male`, `non_binary`, `prefer_not_to_say`. Migration 2 replaced `other` with `prefer_not_to_say`, as the app has it | Chuan (9 Oct) |
| Photo key | `users.photo_key` is `profile-photos/<photoId>.<extension>`, `photoId` is a UUID and the extension is png, jpg, jpeg or webp (a stored photo is always `jpg`). The column has a unique index, so `GET /photos/{photoId}` finds one user | Chuan, Tae (9 Oct) |
| Photo crop and resize | A photo that is not 1:1 is center-cropped to a square; the stored photo is a JPEG of at most 1024 pixels per side (a smaller photo is not enlarged). The 1 MB limit is checked on the uploaded file, before any processing | Tae (10 Oct) |
| Temporary photo uploads | No table: the object `uploads/<uploadId>.jpg` lives in RustFS for one hour, the `deleteToken` is the HMAC of the `uploadId` with `JWT_SECRET`, and a sweep in the backend (every 5 minutes) deletes the uploads that expire unused. A `photo_uploads` table is the alternative, not chosen | Tae, Chuan (10 Oct) |
| Profile Service | Sign up, username check, own profile and candidate profile are built (Chuan). Every rule is checked in the service (`src/services/profile/profileRules.ts`) and a broken rule names its field. The username cannot be changed. `PATCH /users/me` takes any of `displayName`, `dateOfBirth`, `gender`, `location` and `preferences`; there is no password change in v1. A new location gets a new place name. The candidate profile shows `matchScore` (0 when the two users do not fit both ways), `lookingFor` and `isFavorite` | Chuan (9 Oct) |
| Repositories | Vic wrote the Prisma repositories for auth, messaging, favorites, notes, the user reader and the match profile reader, and Chuan merged them (PR #4). Chuan wrote the profile and photo repositories (PR #5). One behaviour test suite runs on the in-memory and the Prisma versions | Vic, Chuan (9 Oct) |

## Open

| Question | Owner | Proposal |
| --- | --- | --- |
| Migrations: automatic when the container starts, or by hand only | Chuan, Tae | Automatic on start in dev; by hand in production |

| Nginx: `client_max_body_size` (default 1 MB refuses a sign up with a 1 MB photo), HTTPS in production | Tae | `client_max_body_size 2m;` in both files. Branch `feat/api-env-and-body-limit` in `dating-infra` has it, with the backend environment variables, for Tae to review |
| Engine docs and CI: its `BACKEND_REQUIREMENTS.md` has an empty list in section 3 and mentions Swipes, Blocks and bios; its CI moves `:dev` from `feat/**` branches | Tae | Only recorded in `docs/match-engine.md`, "Answers from the engine". No action needed from us |
| Real time messages (WebSocket) | Vic | Later. The Messaging Service already has a notifier hook that does nothing |
| Per client request limits (`X-Real-IP`), a request id in logs, graceful shutdown | Vic | Stretch goals after the required features |

## History (replaced decisions)

- No resize in v1, and a photo that is not 1:1 rejected (A5, 6 Oct): replaced on 10 Oct by the center-crop to 1:1 and the JPEG re-encode of at most 1024 px (Tae).
- Gender `other` (first migration): replaced by `prefer_not_to_say` (9 Oct, migration 2), the app's value.
- Match Engine pulls its data through an internal server on port 3001 with `X-Internal-Key` (5 Oct): replaced by push (8 Oct).
- Place name "district, province" (5 Oct): replaced by "province, district" (8 Oct), as in the test plan and the app.
- Photo by `photoId` that the app builds into a path (5 Oct): replaced by `photoUrl` (9 Oct).
- Expired access token with its own code `TOKEN_EXPIRED` (5 Oct): replaced by `UNAUTHENTICATED` (8 Oct), the code the app refreshes on.
- Temporary photo upload removed on 4 Oct (Tae) and a one request sign up with a multipart body (9 Oct): replaced on 9 Oct by the app's two step flow (Tee).
- Chat photos, message delete and `lastReadMessageId` in mark as read: removed on 6 Oct (test plan).
- Search checks only the searcher's criteria (5 Oct): replaced by the mutual rule (8 Oct, test FM12).
- Session in a cookie or a single token: replaced by the two token design.
