# What the app must change

For Tee. Only row 8 needs an app change (and row 7 if the app really needs to edit notes); the other rows are information. The backend follows `docs/api-contract.md`. This page lists where the app (`dating-frontend`, `main` of 9 October 2026) differs from the contract and from the backend as built, so each change is clear. The routes marked "built" can be tried today (`GET /openapi` on a running backend lists them).

## App versus backend

| # | Topic | The app today | The backend | Status |
| - | ----- | ------------- | ----------- | ------ |
| 1 | Photo upload at sign up | Two steps: `POST /photo-uploads`, then `photoUploadId` in the JSON `POST /users`; `DELETE /photo-uploads/{uploadId}` with `X-Delete-Token` | The same. The backend follows the app. Nothing to change | sign up built (Chuan), the upload is not built (Tae) |
| 2 | Change the photo | `PUT /users/me/photo`, answer `{ photoUrl }` | The same | not built (Tae). Chuan's database function for the new photo key is built |
| 3 | Photo field | `photoUrl` (a path) | `photoUrl`, for example `/api/v1/photos/pho_b2`. The same field name, so nothing to change here | built |
| 4 | Logout | `DELETE /sessions/current` with `{ refreshToken }` | The same. Without a body, all refresh tokens of the user are cancelled | built |
| 5 | Expired token | Refreshes on `401 UNAUTHENTICATED` | The same. There is no `TOKEN_EXPIRED` code | built |
| 6 | Cards in Find Matches | `CandidateCard` has no `username` | Every card has `username` (the match list shows it) | built |
| 7 | Notes | `GET /notes?aboutUserId=`, `POST /notes`, `GET /notes/people` | All three exist. `PATCH` and `DELETE /notes/{noteId}` do not (not in the features); tell us if the app really needs them | built |
| 8 | Mark as read | Sends `{ lastReadMessageId }` | `PATCH /conversations/{userId}` takes `{ "isRead": true }` and marks every message from that user as read | built |
| 9 | Search results | Shows what `GET /candidates` returns | Only users who also accept the searcher are returned (an empty search gives the same people as the recommendations) | built |
| 10 | Paging recommendations | `limit` | `limit` and `offset`, `hasMore` in the answer. `offset + limit` is at most 200 | built |
| 11 | Place name | "province, district" | The same, for example "Bangkok, Pathum Wan" | built |
| 12 | Gender values | `female`, `male`, `non_binary`, `prefer_not_to_say` | The database has the same four values since migration 2 (`prefer_not_to_say` replaced `other`). Nothing to change | built |

## Rules the backend checks (the app may show them early)

- Username 4 to 20 letters, digits and underscore (case does not matter). Password at least 8 characters with a letter and a digit.
- Date of birth: a real date, not in the future, age at least 18.
- Photo: png, jpg, jpeg or webp, at most 1 MB, square. Each failed rule has its own message in `error.message`, with `field` `photo`.
- Message 1 to 1000 characters, note 1 to 500 characters, counted after trimming spaces.
- Search: `minAge` at least 18 and not above `maxAge`, `maxDistanceKm` above 0.

## Errors the app should handle

`INVALID_INPUT` (with `field`), `UNAUTHENTICATED` (refresh once, then Landing), `INVALID_CREDENTIALS` (stay on the login form), `USER_NOT_FOUND`, `MESSAGE_NOT_FOUND`, `PHOTO_NOT_FOUND`, `PLACE_NOT_FOUND`, `USERNAME_TAKEN`, `GEOCODER_UNAVAILABLE`, `MATCH_ENGINE_UNAVAILABLE` and `INTERNAL_ERROR`. Codes the app has but the backend does not use: `UPLOAD_NOT_FOUND` (the temporary upload is removed) and `NOTE_NOT_FOUND` (no note edit or delete yet).

## What is saved

Everything the backend has built is saved in PostgreSQL: login tokens, messages, favorites, notes and the match lists (use the seed users, for example `alice` with `Alice2026`). Sign up, the own profile, the candidate profile and the username check are built (Chuan). Sign up cannot finish yet, because it needs the photo upload that Tae builds on RustFS: until then `POST /users` answers `400` with `field` `photoUploadId`. So only the seed users exist.
