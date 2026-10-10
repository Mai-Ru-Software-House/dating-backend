# REST API Contract

Owner: Vic. Base path: `/api/v1`. Bodies are JSON (camelCase) except `POST /photo-uploads` and `PUT /users/me/photo`, which are `multipart/form-data` (one part named `photo`). Timestamps are UTC ISO 8601 and end in Z. IDs are opaque strings (UUID version 7 in the database); the app never parses them.

This file is checked against the other repos: the app (`dating-frontend`, Tee), the Match Engine (`dating-match-engine`, Tae), the infra repo (`dating-infra`, Tae) and the database schema (`prisma/schema.prisma`, Chuan). Last check: 9 October 2026. The live version of this contract for the built routes is `GET /openapi` on a running server. What the app must change is listed in `docs/app-changes.md`; what the database layer must provide is in `docs/data-access.md`.

## Endpoint status

- **built**: the route exists in this repo, has tests and works on PostgreSQL.
- **not built**: agreed on paper only. The owner writes it.

| Endpoint | Owner | Status | Needed by |
| -------- | ----- | ------ | --------- |
| `GET /health` | Vic | built | Infra health check |
| `GET /places` | Vic | built | Create Profile, Edit Profile |
| `POST /sessions` | Chuan | built | Login |
| `POST /sessions/refresh` | Chuan | built | Login (keeps the user logged in) |
| `DELETE /sessions/current` | Chuan | built | Logout |
| `GET /usernames/{username}` | Chuan | built | Create Profile |
| `POST /users` | Chuan | built | Create Profile |
| `GET /users/me` | Chuan | built | App start up, Edit Profile |
| `PATCH /users/me` | Chuan | built | Edit Profile |
| `GET /users/{userId}` | Chuan | built | Find Matches (candidate profile) |
| `POST /photo-uploads` | Tae | built | Create Profile (the photo step) |
| `DELETE /photo-uploads/{uploadId}` | Tae | built | Create Profile (the user picks another photo) |
| `PUT /users/me/photo` | Tae | built | Edit Profile |
| `GET /photos/{photoId}` | Tae | built | every screen that shows a photo |
| `GET /recommendations` | Vic and Tae | built (reads profiles from PostgreSQL) | Find Matches |
| `GET /candidates` | Vic and Tae | built (reads profiles from PostgreSQL) | Find Matches (search) |
| `GET /conversations`, `GET /conversations/{userId}/messages`, `POST /conversations/{userId}/messages`, `PATCH /conversations/{userId}`, `POST /messages/{messageId}/replies`, `GET /messages?unread=true` | Vic | built | Chat list, conversation, send, reply, unread list |
| `GET /favorites`, `PUT /favorites/{userId}`, `DELETE /favorites/{userId}` | Vic | built | Add Favorite |
| `GET /notes`, `POST /notes`, `GET /notes/people`, `PATCH /notes/{noteId}`, `DELETE /notes/{noteId}`, `GET /users/{userId}/notes`, `POST /users/{userId}/notes` | Vic | built | Record, view, edit and delete notes (the `/users/{userId}/notes` paths are the ones in the functional test plan) |
| `POST /internal/v1/recommendations`, `POST /internal/v1/candidates/search` (Match Engine) | Tae (engine), Vic (caller) | built (caller), follows the engine | Match Service |

The photo routes are built (Tae): the temporary upload lives in RustFS under `uploads/<uploadId>.jpg` for one hour, the delete token is an HMAC of the upload ID with the JWT secret, and a sweep in the server deletes the uploads that expire unused. A missing, unknown, expired or already used upload still answers `400` with `field` `photoUploadId` at sign up.

## Shared rules

- **Tokens.** Login (`POST /sessions`) and sign up (`POST /users`) return an `accessToken` (a JWT, 15 minutes by default) and a `refreshToken` (random, 30 days by default, stored only as a hash). Both lifetimes are settings (`ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_DAYS`). The app sends `Authorization: Bearer <accessToken>`. When a request answers `401 UNAUTHENTICATED`, the app calls `POST /sessions/refresh` once and repeats the request; if the refresh fails, the app goes to Landing. An expired access token has no code of its own.
- **No session needed:** health check, username check, create profile, login, token refresh (it uses the refresh token instead) and place lookup. Every other endpoint without a valid session answers `401 UNAUTHENTICATED`.
- **Error shape:** `{ "error": { "code": "SOME_CODE", "message": "Human readable text." } }`. Validation errors add `"field"`: the dotted path from the root of the body (`username`, `location.lat`, `preferences.minAge`), a list named as a whole (`preferences.targetGenders`), or the query parameter name as sent (`maxDistanceKm`).
- **Validation.** The app does only basic checks. The backend enforces every rule and answers with a field error.
- **Status codes:** 400 invalid input, 401 not logged in, 403 not allowed, 404 not found, 409 conflict, 500 server error. Never 200 with an error body.
- `me` in a path means the logged in user.
- **Lists** are always wrapped in an object (`{ "messages": [], "hasMore": false }`).
- **Paging:** message lists take `limit` and `before` and return `hasMore`. Recommendations take `limit` and `offset`. Chat list, favorites and notes are not paged.
- **Photos.** A user card carries `photoUrl`, the path `/api/v1/photos/{photoId}`. The app adds the session header when it loads it. At sign up the photo is uploaded first (`POST /photo-uploads`) and the sign up carries its `photoUploadId` (the flow of the app, agreed with Tee on 9 October).
- **Privacy.** A response never contains a password hash, or another user's date of birth, exact location, favorites or notes. Other users are shown with `age`, `placeName` and `distanceKm` only.
- **Rules from the functional test plan (A1 to A8):** username 4 to 20 letters, digits and underscore, stored in lowercase, so "Alice" and "alice" are one name; password at least 8 characters with a letter and a digit, hashed with Argon2id; minimum age 18; profile photo png, jpg, jpeg or webp, at most 1 MB; a photo that is not 1:1 is center-cropped to a square; message 1 to 1000 characters; note 1 to 500 characters (after trimming, counted as Unicode characters); if the place lookup fails, the profile is still saved with no place name.

### Error codes

| Code | Status | When |
| ---- | ------ | ---- |
| `INVALID_INPUT` | 400 | Bad or missing data, with `field` when known |
| `UNAUTHENTICATED` | 401 | Not logged in, the token is not valid or expired, or the refresh failed |
| `INVALID_CREDENTIALS` | 401 | Unknown username or wrong password at login (the same answer for both) |
| `NOT_FOUND` | 404 | The path does not exist |
| `USER_NOT_FOUND` | 404 | The user in the path or body does not exist |
| `NOTE_NOT_FOUND` | 404 | The note does not exist, is not mine, or the ID is not a note ID (the same answer for all three) |
| `MESSAGE_NOT_FOUND` | 404 | The message does not exist, or the logged in user is not its sender or receiver |
| `PLACE_NOT_FOUND` | 404 | Nominatim has no place for that point |
| `PHOTO_NOT_FOUND` | 404 | The photo does not exist |
| `UPLOAD_NOT_FOUND` | 404 | The temporary photo upload does not exist, has expired, or the delete token is wrong |
| `USERNAME_TAKEN` | 409 | The username is taken |
| `GEOCODER_UNAVAILABLE` | 500 | Nominatim failed or did not answer in time |
| `MATCH_ENGINE_UNAVAILABLE` | 500 | The Match Engine failed or did not answer in time |
| `INTERNAL_ERROR` | 500 | Any other server error. The message is always generic |

## Shared models

### UserSummary

Another user as shown in lists.

| Field | Type | Notes |
| ----- | ---- | ----- |
| `userId` | string | |
| `displayName` | string | Not unique |
| `photoUrl` | string | Path of the profile photo, for example `/api/v1/photos/pho_b2` |

```json
{ "userId": "usr_b2", "displayName": "Ploy", "photoUrl": "/api/v1/photos/pho_b2" }
```

### CandidateCard

A user shown in Find Matches. The fields of `UserSummary`, plus:

| Field | Type | Notes |
| ----- | ---- | ----- |
| `username` | string | The unique username (shown in the match list, test FM01) |
| `age` | integer | In whole years, computed from the date of birth in UTC. The date of birth is never sent |
| `gender` | string | A gender code: `female`, `male`, `non_binary` or `prefer_not_to_say` |
| `placeName` | string or null | "province, district" in English, for example "Bangkok, Pathum Wan". Only the province if no district is known, null if neither |
| `distanceKm` | integer | Whole km, never below 1, so an exact location cannot be worked out |
| `matchScore` | integer | 0 to 100. Only in recommendations and the candidate profile |

### Message

| Field | Type | Notes |
| ----- | ---- | ----- |
| `messageId`, `senderId`, `receiverId` | string | |
| `text` | string | 1 to 1000 characters after trimming. Messages are text only |
| `sentAt` | string | Set by the server, UTC ISO 8601 ending in Z |
| `isRead` | boolean | True when the receiver has read it |
| `replyTo` | object or null | `{ messageId, senderId, text }` of the message this one answers |

### OwnProfile

The logged in user's own profile. Only its owner receives it, so it holds the exact location and the date of birth.

| Field | Type | Notes |
| ----- | ---- | ----- |
| `userId`, `username`, `displayName` | string | `username` cannot be changed |
| `dateOfBirth` | string | `YYYY-MM-DD`. The age is never stored |
| `gender` | string | A gender code |
| `location` | object | `{ lat, lon }` |
| `placeName` | string or null | Same rule as in `CandidateCard` |
| `photoUrl` | string | Path of the profile photo |
| `preferences` | object | `{ minAge, maxAge, targetGenders, radiusKm }` |

```json
{
  "userId": "0194a1b2-7c3d-7e4f-8a90-b1c2d3e4f5a6",
  "username": "mai_ru01",
  "displayName": "Mai",
  "dateOfBirth": "2004-05-17",
  "gender": "female",
  "location": { "lat": 13.7563, "lon": 100.5018 },
  "placeName": "Bangkok, Pathum Wan",
  "photoUrl": "/api/v1/photos/0194a1b2-8d11-7a22-9b33-c4d5e6f7a8b9",
  "preferences": { "minAge": 20, "maxAge": 28, "targetGenders": ["male"], "radiusKm": 25 }
}
```

## Per endpoint details

Every endpoint that needs a login can also answer `401 UNAUTHENTICATED`, and every endpoint can answer `500 INTERNAL_ERROR`; these two are not repeated below.

### GET /health

Status: built (Vic).

Supports: server monitoring and the infra health check (no requirement names it). Session: **none**.

Request: no parameters.

Response `200`:

```json
{ "status": "ok", "timestamp": "2026-10-03T12:00:00.000Z" }
```

Errors: only the shared 500.

Notes: `timestamp` is set by the server, UTC ISO 8601.

### POST /sessions

Status: built (Chuan). Session: **none**.

Body: `{ "username": "mai_ru01", "password": "********" }`. Both are required. The username is read in any letter case.

Response `201`: `{ "accessToken": "eyJhbGciOi...", "refreshToken": "r_8c1f2e..." }`

| Status | Code | When |
| ------ | ---- | ---- |
| 400 | `INVALID_INPUT` | `username` or `password` is missing or empty (`field`) |
| 401 | `INVALID_CREDENTIALS` | Unknown username or wrong password. The answer is the same for both, and an unknown username takes as long as a wrong password |

Notes: the access token is a JWT signed with `JWT_SECRET` and is checked by signature only. After logout the access token still works until it expires (at most 15 minutes by default); this is the price of not looking up the database on every request. Switch User means log out, then log in again.

### POST /sessions/refresh

Status: built (Chuan). Session: **none** (the refresh token is the proof).

Body: `{ "refreshToken": "r_8c1f2e..." }` (required). Response `200`: a new `{ accessToken, refreshToken }`. The refresh token is rotated: the old one stops working, and two requests with the same token cannot both succeed.

| Status | Code | When |
| ------ | ---- | ---- |
| 400 | `INVALID_INPUT` | `refreshToken` is missing (`field`) |
| 401 | `UNAUTHENTICATED` | The refresh token is unknown, expired, already used or cancelled. The app goes to Landing |

### DELETE /sessions/current

Status: built (Chuan). Session: **required**.

Body (optional): `{ "refreshToken": "r_8c1f2e..." }`. With a body, that refresh token is cancelled (the app sends it). Without a body, every refresh token of the user is cancelled. A token that belongs to someone else is ignored. Response `204`, no body. The access token still works until it expires.

### GET /usernames/{username}

Status: built (Chuan). Session: **none**.

Response `200`: `{ "isAvailable": true }`. A name that is taken is not an error: `isAvailable` is false. `400 INVALID_INPUT` (`field` `username`) when the format is wrong (not 4 to 20 letters, digits and underscore). The check is case insensitive. The same check runs at `POST /users`, which answers `409 USERNAME_TAKEN` if someone took the name in between.

### POST /users

Status: built (Chuan, with the Location Service by Vic). The photo part waits for Tae: until his upload store exists, the server answers `400` with `field` `photoUploadId`. Session: **none**.

Body: JSON. The photo was uploaded before with `POST /photo-uploads`; the body carries its `photoUploadId`.

| Field | Type | Rules |
| ----- | ---- | ----- |
| `username` | string | 4 to 20 letters, digits and underscore. Unique, case insensitive. Cannot be changed later |
| `password` | string | At least 8 characters with a letter and a digit. At most 1000 characters (the limit of login). One value; the app checks the confirmation |
| `displayName` | string | Spaces at both ends are removed. 1 to 50 characters. Not unique |
| `dateOfBirth` | string | `YYYY-MM-DD`, a real date, not in the future, age at least 18 (counted from the UTC date), year 1900 or later |
| `gender` | string | A gender code: `female`, `male`, `non_binary` or `prefer_not_to_say` |
| `location` | object | `{ lat, lon }`, `lat` -90 to 90, `lon` -180 to 180 |
| `photoUploadId` | string | Required. The `uploadId` of a photo uploaded less than an hour ago and not used yet |
| `preferences.minAge` | integer | Whole number from 18 to 120, not above `maxAge` |
| `preferences.maxAge` | integer | Whole number from 18 to 120 |
| `preferences.targetGenders` | list of strings | One or more gender codes. A repeated code counts once. Stored sorted A to Z |
| `preferences.radiusKm` | integer | Whole km from 1 to 20000 |

Response `201`: `{ "accessToken", "refreshToken", "profile": <OwnProfile> }`.

| Status | Code | When |
| ------ | ---- | ---- |
| 400 | `INVALID_INPUT` | A rule fails. `field` names the invalid field. A missing, unknown, expired or already used upload is `field` `photoUploadId` |
| 409 | `USERNAME_TAKEN` | The username is taken. With two sign ups at once for one name, one gets `201`, the other `409`, and only one row exists |

Notes: the server builds `placeName` with the Location Service once and stores it with the profile. If the lookup fails, or the point has no name, the profile is still saved with `placeName` null. The password is stored as an Argon2id hash. The date of birth is stored, never the age. The upload becomes the profile photo (it gets its final object key `profile-photos/<photoId>.<extension>`) in the same step that saves the user; if saving fails, the upload stays usable until it expires.

### GET /users/me

Status: built (Chuan). Session: **required**. Response `200`: the `OwnProfile`. `401 UNAUTHENTICATED` also when the user no longer exists. The app calls it at start up: `200` goes to Home, `401` goes to Landing.

### PATCH /users/me

Status: built (Chuan). Session: **required**.

Body: any of `displayName`, `dateOfBirth`, `gender`, `location` and `preferences` (sent whole). Each has the rules of `POST /users`. `username` cannot be changed and sending it is a `400`. The photo has its own endpoint. Response `200`: the updated `OwnProfile`. A new `location` gives a new `placeName`; if the lookup fails the old name is cleared.

### GET /users/{userId}

Status: built (Chuan). Session: **required**.

Response `200`: a `CandidateCard` (with `matchScore`), plus:

| Field | Type | Notes |
| ----- | ---- | ----- |
| `lookingFor` | object | The user's own preferences: `{ targetGenders, minAge, maxAge, radiusKm }` |
| `isFavorite` | boolean | For the Add Favorite button (from the Favorites service) |

`matchScore` here comes from one engine request with only this user in the pool. It is `0`, without calling the engine, when the two users do not fit each other both ways (age, gender and distance), or when the user looks at their own profile. `distanceKm` is measured from the logged in user's saved location. The response never has a date of birth, an exact location, favorites or notes. `404 USER_NOT_FOUND` for an unknown ID, or an ID that is not a UUID.

### POST /photo-uploads

Status: not built (Tae). Session: **none** (the user has no account yet during Create Profile).

Body: `multipart/form-data`, one file part named `photo`. Rules: png, jpg, jpeg or webp, at most 1 MB. A photo that is not 1:1 is center-cropped to a square, and the photo that is stored is a JPEG of at most 1024 pixels per side. `400 INVALID_INPUT` with `field` `photo` and a message that names the failed rule (formats, size, missing). Nothing is stored when a rule fails.

Response `201`:

```json
{ "uploadId": "0194a1b2-8d11-7a22-9b33-c4d5e6f7a8b9", "expiresAt": "2026-10-09T09:30:00.000Z", "deleteToken": "6f1c..." }
```

Notes: the photo is kept in RustFS as a JPEG under a temporary key (`uploads/<uploadId>.jpg`) for one hour (`expiresAt`). `deleteToken` proves who may delete it, so the delete needs no session. An upload that is never used is removed after it expires. Because this route needs no session, it is limited per client address (`X-Real-IP`).

### DELETE /photo-uploads/{uploadId}

Status: not built (Tae). Session: **none**. The header `X-Delete-Token` carries the `deleteToken` (as the app sends it). Response `204`. `404 UPLOAD_NOT_FOUND` for an unknown or expired upload or a wrong token (the same answer for all three, so nothing is revealed). The app calls it when the user picks another photo.

### PUT /users/me/photo

Status: not built (Tae). Chuan's database function that swaps the photo key is built. Session: **required**.

Body: `multipart/form-data`, one file part named `photo`, with the same rules as `POST /photo-uploads`. Response `200`: `{ "photoUrl": "/api/v1/photos/{photoId}" }`. The new photo replaces the old one, and the old object is deleted from RustFS only after the new one is saved. The object key is `profile-photos/<photoId>.jpg`.

### GET /photos/{photoId}

Status: not built (Tae). Session: **required**. Any logged in user can see any profile photo (there are no chat photos).

Response `200`: the image bytes with the stored `Content-Type`, `Cache-Control: private` and `X-Content-Type-Options: nosniff`. `404 PHOTO_NOT_FOUND` for an unknown ID.

### GET /places

Supports: Create Profile (Ext E, "location recognised"), Edit Profile. Session: **none** (the user has no account yet during Create Profile).

Query:

| Name  | Type   | Rules       |
| ----- | ------ | ----------- |
| `lat` | number | -90 to 90   |
| `lon` | number | -180 to 180 |

Response `200`:

```json
{ "placeName": "Pathum Wan, Bangkok" }
```

Errors:

| Status | Code                   | When                                            |
| ------ | ---------------------- | ----------------------------------------------- |
| 400    | `INVALID_INPUT`        | `lat` or `lon` missing or out of range (`field`) |
| 404    | `PLACE_NOT_FOUND`      | No place at that point                          |
| 500    | `GEOCODER_UNAVAILABLE` | Nominatim failed or the wait was too long       |

Notes: results are cached by coordinates rounded to 3 decimal places (about 100 m). Calls to Nominatim are queued to at most 1 per second. The name is province and district level, never a street address. It is built as "province, district" in English (Vic, 8 Oct, following the functional test plan CP02 and the app). The district is the Nominatim value whose name says "District" (or starts with "Khet" or "Amphoe"), read from `county`, `suburb`, `city_district` or `district`; a subdistrict (tambon, khwaeng) is never used. The province comes from `state`, `province` or, for Bangkok, `city`. (The Location Service asks Nominatim for English names, and the cache key includes the language). If Nominatim gives no district, only the province is returned. The Profile Service uses the same builder when it stores the name with a profile, so the two never differ.

### GET /recommendations

Supports: Find Matches (select from recommended matches). The app loads more only when the user scrolls to the end of the list.

Query:

| Name    | Type    | Rules                   |
| ------- | ------- | ----------------------- |
| `limit`  | integer | 1 to 50, default 10     |
| `offset` | integer | 0 or more, default 0. The number of cards the app already has |

Response `200`, sorted by `matchScore`, highest first:

```json
{
  "recommendations": [
    {
      "userId": "usr_b2",
      "username": "ploy_01",
      "displayName": "Ploy",
      "photoUrl": "/api/v1/photos/pho_b2",
      "age": 23,
      "gender": "female",
      "placeName": "Pathum Wan, Bangkok",
      "distanceKm": 3,
      "matchScore": 87
    }
  ],
  "hasMore": true
}
```

Errors:

| Status | Code                       | When                                      |
| ------ | -------------------------- | ----------------------------------------- |
| 400    | `INVALID_INPUT`            | `limit` or `offset` out of range (`field`) |
| 500    | `MATCH_ENGINE_UNAVAILABLE` | The Match Engine failed or timed out      |

Notes (Vic, 8 Oct, built in `src/services/match/`): the Match Service reads the profiles, keeps the candidates whose own preferences accept the user, pushes them to the engine's `POST /internal/v1/recommendations` and builds the cards. Each card also has `username` (functional test plan FM01). The engine score (0 to 100, one decimal) is rounded to a whole number for `matchScore`. `distanceKm` is computed by the backend, rounded to whole km, at least 1. The user never appears in their own list. A user with nobody to show gets `200` with an empty list (the engine is not called). Date of birth and exact location are never sent to the app, and the engine gets only age, gender and coordinates.

Paging (Vic, 8 Oct): the backend asks the engine for `offset + limit + 1` results and returns only the slice, plus `hasMore`. `offset + limit` is at most 200. Trade off: the engine computes the list again for every page, so the order can shift a little between pages if profiles change in between. The values in the app's limit selector are Tee's choice; the server accepts any whole number from 1 to 50.


### GET /candidates

Supports: Find Matches (search by specification). Every criterion is optional. A missing criterion uses the value from the user's own preferences, and a missing search point uses the user's own location.

Query:

| Name            | Type            | Rules                                                                                             |
| --------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| `minAge`        | integer         | At least 18, not above `maxAge`                                        |
| `maxAge`        | integer         | Not below `minAge`                                                                                |
| `targetGenders` | list of strings | Repeat the parameter: `targetGenders=male&targetGenders=female`. Values from the gender list      |
| `maxDistanceKm` | number          | Greater than 0                                                                                    |
| `lat`, `lon`    | number          | Search point. Send both or neither                                                                |
| `limit`         | integer         | 1 to 50, default 20                                                                               |

Response `200`, sorted by `distanceKm`, nearest first. Cards have no `matchScore`. `distanceKm` is measured from the search point.

```json
{
  "candidates": [
    {
      "userId": "usr_c3",
      "username": "arm_bkk",
      "displayName": "Arm",
      "photoUrl": "/api/v1/photos/pho_c3",
      "age": 25,
      "gender": "male",
      "placeName": "Bang Rak, Bangkok",
      "distanceKm": 2
    }
  ]
}
```

Errors:

| Status | Code                       | When                                                                                |
| ------ | -------------------------- | ----------------------------------------------------------------------------------- |
| 400    | `INVALID_INPUT`            | A value breaks its rule, `minAge` above `maxAge`, or only one of `lat` / `lon` given (`field`) |
| 500    | `MATCH_ENGINE_UNAVAILABLE` | The Match Engine failed or timed out                                                |

Notes (Vic, 8 Oct, built): search uses the searcher's criteria **and** the mutual rule: only users whose own preferences accept the searcher are returned (functional test plan FM12, an empty search returns bob and chai and not gun). The cards have `username` and no `matchScore`. Rules: `minAge` at least 18 (`The minimum age is 18.`, `field` `minAge`); `minAge` not above `maxAge` (the message names the age range); `maxDistanceKm` a number above 0 (`field` `maxDistanceKm`); `lat` and `lon` both or neither; `limit` 1 to 50, default 20. A missing criterion uses the user's own preference, a missing point uses the user's own location. The gender list is not checked against a fixed list yet (open: `other` or `prefer_not_to_say`), so an unknown gender returns no one.

### GET /conversations

Supports: View Chat List (Must Have), Add Favorite (favorites are pinned on top).

Request: no parameters.

Response `200`. Favorites first, then by `lastMessage.sentAt`, newest first. Only users with at least one message in either direction.

```json
{
  "conversations": [
    {
      "user": { "userId": "usr_b2", "displayName": "Ploy", "photoUrl": "/api/v1/photos/pho_b2" },
      "isFavorite": true,
      "lastMessage": {
        "messageId": "msg_42",
        "senderId": "usr_a1",
        "text": "Sure, Saturday works for me.",
        "sentAt": "2026-10-03T14:05:00.000Z"
      },
      "unreadCount": 0
    }
  ]
}
```

Errors: only the shared 401 and 500.

Notes: `unreadCount` counts messages from that user to me that are not read. Two rows with the same last message time are ordered by the larger `messageId` first, so the order is always the same (proposed, see [Message order and ties](decisions.md)). Every time ends in Z (UTC).

### GET /conversations/{userId}/messages

Supports: View Conversation.

Path: `userId`, the other user.

Query:

| Name     | Type    | Rules                                                     |
| -------- | ------- | --------------------------------------------------------- |
| `before` | string  | Optional. A `messageId` from this conversation            |
| `after`  | string  | Optional. A `messageId` from this conversation. Only messages newer than it are returned, so the app can poll. The answer holds the `limit` messages just after `after`, still newest first. `hasMore: true` means even newer messages exist, so the app asks again with the newest ID it now has. This way polling never skips a message (Vic, 6 Oct) |
| `limit`  | integer | 1 to 100, default 30                                      |

Response `200`: a list of `Message`, newest first (sorted by time). **Opening a conversation marks as read every message from that user to me**, not only the messages on this page, the same as `PATCH /conversations/{userId}` (functional test plan CH05, 6 Oct). This happens after all checks pass, so a request that answers an error marks nothing, and the answer already shows those messages as read. Only messages between me and that user are returned, so another user who opens the same ID sees none of them and marks none as read (CH09).

```json
{
  "messages": [
    {
      "messageId": "msg_42",
      "senderId": "usr_a1",
      "receiverId": "usr_b2",
      "text": "Sure, Saturday works for me.",
      "sentAt": "2026-10-03T14:05:00.000Z",
      "isRead": true,
      "replyTo": { "messageId": "msg_40", "senderId": "usr_b2", "text": "Coffee this weekend?" }
    }
  ],
  "hasMore": true
}
```

Errors:

| Status | Code             | When                                                                                     |
| ------ | ---------------- | ---------------------------------------------------------------------------------------- |
| 400    | `INVALID_INPUT`  | `limit` out of range, `before` or `after` is not a message in this conversation, both `before` and `after` are sent (`field: "after"`), or `userId` is me |
| 404    | `USER_NOT_FOUND` | No user with that ID (functional test plan CH08)                                         |

Notes: a user with no messages yet gives `200` with an empty list. Messages are ordered by `sentAt`, then by `messageId`, so messages sent in the same millisecond keep a fixed order and paging never skips or repeats one (proposed, see [Message order and ties](decisions.md)).

`before` and `after` together answer `400 INVALID_INPUT` with `field: "after"`. The app needs only one at a time.

### POST /conversations/{userId}/messages

Supports: Send Message (from the candidate profile or the conversation).

Path: `userId`, the receiver.

Body: JSON only (`Content-Type: application/json`). A multipart body answers `400 INVALID_INPUT`. Messages are text only. There are no chat photos (functional test plan, 6 Oct).

| Field              | Type   | Rules                                                                                                                              |
| ------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `text`             | string | Required. 1 to 1000 characters after trimming spaces, counted as Unicode characters (code points). One emoji counts as 1, and a Thai vowel or tone mark counts as a character |
| `replyToMessageId` | string | Optional. The message this one answers. It must be a message between me and `userId`                                              |

Example request:

```
POST /api/v1/conversations/usr_b2/messages
Authorization: Bearer 9f2c1d7a4b...
Content-Type: application/json

{ "text": "Sure, Saturday works for me.", "replyToMessageId": "msg_40" }
```

Response `201`: the new `Message`. The server sets `sentAt` (UTC, ends in Z). `replyTo` shows which message it answers, or is null when no `replyToMessageId` was sent.

```json
{
  "messageId": "msg_43",
  "senderId": "usr_a1",
  "receiverId": "usr_b2",
  "text": "Sure, Saturday works for me.",
  "sentAt": "2026-10-03T14:10:00.000Z",
  "isRead": false,
  "replyTo": { "messageId": "msg_40", "senderId": "usr_b2", "text": "Coffee this weekend?" }
}
```

Errors:

| Status | Code                | When                                                                                                                                                      |
| ------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `INVALID_INPUT`     | `text` missing, empty after trimming or too long (`field: "text"`). `replyToMessageId` is not a string, or is a message of another conversation of mine (`field: "replyToMessageId"`). `userId` is me (`field: "userId"`). The body is multipart |
| 404    | `USER_NOT_FOUND`    | No user with that ID                                                                                                                                      |
| 404    | `MESSAGE_NOT_FOUND` | `replyToMessageId` does not exist, or I am not its sender or receiver (so IDs do not leak)                                                                |

### POST /messages/{messageId}/replies

Supports: Reply to Message. This is the reply route that needs no receiver typed (functional test plan MS09).

Path: `messageId`, the message being replied to. The receiver is the other person in that message: its sender if I received it, its receiver if I sent it.

Body: JSON only, `{ "text": "..." }`, 1 to 1000 characters after trimming spaces.

Response `201`: the new `Message`, with `replyTo` filled in. It is stored and returned with the message it answers.

```json
{
  "messageId": "msg_44",
  "senderId": "usr_a1",
  "receiverId": "usr_b2",
  "text": "Sure, Saturday works for me.",
  "sentAt": "2026-10-03T14:12:00.000Z",
  "isRead": false,
  "replyTo": { "messageId": "msg_40", "senderId": "usr_b2", "text": "Coffee this weekend?" }
}
```

Errors:

| Status | Code                | When                                                                      |
| ------ | ------------------- | ------------------------------------------------------------------------- |
| 400    | `INVALID_INPUT`     | `text` empty or too long, or the body is multipart                        |
| 404    | `MESSAGE_NOT_FOUND` | No such message, or I am not its sender or receiver (so IDs do not leak) |

Notes: there is no route to delete a message and no chat photo (functional test plan, 6 Oct).

### GET /messages?unread=true

Supports: Login / Switch User (after login the home page shows unread messages with the sender and the time sent).

Query:

| Name     | Type    | Rules                                                  |
| -------- | ------- | ------------------------------------------------------ |
| `unread` | boolean | Required, must be `true`. Other filters may come later |
| `before` | string  | Optional. A `messageId` from an earlier page           |
| `limit`  | integer | 1 to 100, default 50                                   |

Response `200`: unread messages sent to me, newest first. Reading this list does not mark messages as read. Opening the conversation or `PATCH /conversations/{userId}` does. `before` must be a message sent to me, otherwise `400 INVALID_INPUT` with `field: "before"`.

```json
{
  "messages": [
    {
      "messageId": "msg_45",
      "sender": { "userId": "usr_c3", "displayName": "Arm", "photoUrl": "/api/v1/photos/pho_c3" },
      "text": "Hello! I liked your profile.",
      "sentAt": "2026-10-03T09:30:00.000Z"
    }
  ],
  "hasMore": false
}
```

Errors:

| Status | Code            | When                                             |
| ------ | --------------- | ------------------------------------------------ |
| 400    | `INVALID_INPUT` | `unread` missing or not `true`, or bad `limit` / `before` |

### PATCH /conversations/{userId}

Supports: View Conversation. Mark as read without opening the conversation (functional test plan CH07). It keeps the chat list unread count and the home page list correct.

Path: `userId`, the other user.

Body (JSON only):

```json
{ "isRead": true }
```

Only `true` is accepted. Every message from that user to me becomes read, including messages that arrived while the screen was open. It does the same as opening the conversation with `GET /conversations/{userId}/messages`. Safe to repeat: a message that is already read keeps its first read time. Messages I sent and messages of other conversations are not changed.

Response `200`: `unreadCount` is how many messages from that user are still unread after the call.

```json
{ "userId": "usr_b2", "unreadCount": 0 }
```

Errors:

| Status | Code             | When                                                                                  |
| ------ | ---------------- | ------------------------------------------------------------------------------------- |
| 400    | `INVALID_INPUT`  | `isRead` is missing or is not `true` (`field: "isRead"`), the body is multipart, or `userId` is me (`field: "userId"`) |
| 404    | `USER_NOT_FOUND` | No user with that ID                                                                  |

Notes: this replaces the old body `{ "lastReadMessageId" }` (functional test plan, 6 Oct). A message that arrives while the screen is open can now be marked as read before the user sees it.

### GET /favorites

Supports: Add Favorite.

Request: no parameters.

Response `200`, newest first:

```json
{
  "favorites": [
    {
      "user": { "userId": "usr_b2", "displayName": "Ploy", "photoUrl": "/api/v1/photos/pho_b2" },
      "createdAt": "2026-10-02T08:00:00.000Z"
    }
  ]
}
```

Errors: only the shared 401 and 500.

### PUT /favorites/{userId}

Supports: Add Favorite (from the candidate profile or the chat list). The favorite user's conversation is pinned to the top of the chat list.

Path: `userId`, the user to add. No body.

Response `200`. Safe to repeat: a second call keeps the first `createdAt`.

```json
{ "userId": "usr_b2", "createdAt": "2026-10-02T08:00:00.000Z" }
```

Errors:

| Status | Code             | When                      |
| ------ | ---------------- | ------------------------- |
| 400    | `INVALID_INPUT`  | `userId` is me            |
| 404    | `USER_NOT_FOUND` | No user with that ID      |

Notes: favorites are private. The other user never sees that they were added.

### DELETE /favorites/{userId}

Supports: Add Favorite (unpin).

Path: `userId`. No body.

Response `204`, no body. Also `204` when the user was not a favorite.

Errors: only the shared 401 and 500 (plus 400 for a badly formed `userId`).

### GET /notes?aboutUserId=

Supports: View Notes.

Query:

| Name          | Type   | Rules    |
| ------------- | ------ | -------- |
| `aboutUserId` | string | Required |

Response `200`: notes I wrote about that user, newest first (by `createdAt`, an edit does not change the order). Nobody else can read them. `updatedAt` is `null` until the note is edited, then the UTC time of the last edit.

```json
{
  "notes": [
    {
      "noteId": "not_7",
      "aboutUserId": "usr_b2",
      "text": "Coffee at Siam on Saturday 4 Oct, 2 pm.",
      "createdAt": "2026-10-03T14:20:00.000Z",
      "updatedAt": null
    }
  ]
}
```

Errors:

| Status | Code             | When                   |
| ------ | ---------------- | ---------------------- |
| 400    | `INVALID_INPUT`  | `aboutUserId` missing  |
| 404    | `USER_NOT_FOUND` | No user with that ID   |

### POST /notes

Supports: Record Small Notes.

Body:

```json
{ "aboutUserId": "usr_b2", "text": "Coffee at Siam on Saturday 4 Oct, 2 pm." }
```

| Field         | Type   | Rules                                      |
| ------------- | ------ | ------------------------------------------ |
| `aboutUserId` | string | An existing user, not me                   |
| `text`        | string | 1 to 500 characters after trimming spaces  |

Response `201`: the new note, same shape as one item of `GET /notes`. The server sets `createdAt`.

Errors:

| Status | Code             | When                                          |
| ------ | ---------------- | --------------------------------------------- |
| 400    | `INVALID_INPUT`  | `text` empty or too long, or `aboutUserId` is me |
| 404    | `USER_NOT_FOUND` | No user with that ID                          |

Notes: built (Vic, 8 Oct): the same two routes also exist as `GET /users/{userId}/notes` and `POST /users/{userId}/notes` (body `{ "text" }`), because the functional test plan uses these paths (NT07: an unknown user answers `404 USER_NOT_FOUND`; NT08: the logged in user only ever sees their own notes about that user). `GET /notes/people` answers `{ "people": [{ "user": UserSummary, "noteCount": 2, "lastNote": { "noteId", "text", "createdAt", "updatedAt" } }] }`, the person with the newest note first.

### PATCH /notes/{noteId}

Supports: Edit a note (the Notes screen in the app).

Status: built (Vic, 9 Oct). Session: **required**.

Body (JSON only): `{ "text": "Coffee at Siam on Saturday 4 Oct, 3 pm." }`. The text has the same rule as `POST /notes`: 1 to 500 characters after trimming spaces. Only the text can change; the note stays about the same person.

Response `200`: the changed note, the same shape as one item of `GET /notes`, with `updatedAt` set by the server.

Errors:

| Status | Code             | When                                                                               |
| ------ | ---------------- | ---------------------------------------------------------------------------------- |
| 400    | `INVALID_INPUT`  | `text` empty or too long (`field` `text`)                                          |
| 404    | `NOTE_NOT_FOUND` | The note does not exist, is not mine, or the ID is not valid (the same answer, so nothing about other people's notes is revealed) |

### DELETE /notes/{noteId}

Supports: Delete a note (the Notes screen in the app, after the "Delete this note?" question).

Status: built (Vic, 9 Oct). Session: **required**.

Response `204`, no body. The note is gone for good, and its ID is not used again.

Errors: `404 NOTE_NOT_FOUND` when the note does not exist, is not mine, or the ID is not valid. A second delete of the same note is therefore a `404`.

## Internal: Backend to Match Engine (Vic & Tae)

**Updated 8 Oct 2026 (Vic).** This section now follows the engine as Tae built it (repository `dating-match-engine`, `main` of 7 Oct, files `app/models/request.py`, `response.py`, `profile.py`). The backend **pushes** the candidates in the request, so the engine never reads our database and never calls the backend. The older design with an internal server on port 3001 and an `X-Internal-Key` header is **dropped** (see the next section).

The base URL is `MATCH_ENGINE_URL` (infra sets `http://match-engine:8000`). The wait limit is `MATCH_ENGINE_TIMEOUT_MS` (default 5000). The code is in `src/services/match/engineClient.ts`; it is the only file that knows these packets.

| Method | Path | Used for |
| ------ | ---- | -------- |
| POST | `/internal/v1/recommendations` | `GET /recommendations` (ranked, mutual) |
| POST | `/internal/v1/candidates/search` | `GET /candidates` (filter by specification) |
| GET | `/health` | Health check, answer `{ "status": "ok", "service": "dating-match-engine" }` |

The engine also has `GET /internal/v1/recommendations?userId=` (pull mode) and `GET /`. The backend does not use them.

### POST /internal/v1/recommendations

Request (camelCase). `user` must have `targetPreference`. A candidate may also have it, and then the engine checks the rule both ways.

```json
{
  "userId": "0194a1b2-...",
  "limit": 11,
  "user": {
    "userId": "0194a1b2-...",
    "age": 27,
    "gender": "female",
    "latitude": 13.7466,
    "longitude": 100.5393,
    "targetPreference": { "ageMin": 24, "ageMax": 32, "gender": ["male"], "radiusKm": 50 }
  },
  "candidates": [
    {
      "userId": "0194a1b3-...",
      "age": 28,
      "gender": "male",
      "latitude": 13.7279,
      "longitude": 100.5241,
      "targetPreference": { "ageMin": 22, "ageMax": 30, "gender": ["female"], "radiusKm": 30 }
    }
  ]
}
```

Response `200` (the engine also repeats each name in snake_case, which we ignore):

```json
{ "candidates": [{ "userId": "0194a1b3-...", "matchScore": 99.0, "distanceKm": 3.06 }] }
```

`matchScore` is 0 to 100 with one decimal. The backend rounds it to a whole number for the app. It also accepts a `results` list with `score` from 0 to 1 (the format Vic and Tae discussed on 7 Oct) and turns it into 0 to 100.

### POST /internal/v1/candidates/search

```json
{
  "ageMin": 25,
  "ageMax": 26,
  "gender": ["male"],
  "radiusKm": 20,
  "location": { "lat": 13.7466, "lng": 100.5393 },
  "limit": 20,
  "candidates": [{ "userId": "0194a1b3-...", "age": 25, "gender": "male", "latitude": 13.8621, "longitude": 100.5144 }]
}
```

Response `200`, nearest first: `{ "candidates": [{ "userId": "0194a1b3-...", "distanceKm": 13.4 }] }`. The engine's search is one way (it only checks these values). The backend makes it mutual before sending (see "Rules the backend applies").

### Rules the backend applies

- **Pool:** every user with a location and preferences, except the user, at most 2000 profiles. The backend keeps only the candidates whose own preferences accept the user (age, gender and distance, test plan A11). For recommendations the engine checks the user's side again.
- **Search:** the same pool, so a search with empty fields returns the same people as the recommendations (test FM12: bob and chai, not gun). A search point other than the user's own changes only the distance and the radius check of the search, not the candidate's own radius.
- **Paging:** the backend asks for `offset + limit + 1` results (at most 200) and keeps the slice. The extra result tells `hasMore`.
- **Privacy:** the engine gets `age` (whole years, computed in UTC), `gender` and exact coordinates, but never the date of birth, name, username or photo. Cards are built by the backend from its own data.
- **Gender values:** plain strings compared for equality, so the codes from the `genders` table pass through (`female`, `male`, `non_binary`, `prefer_not_to_say`).

### Errors

The engine answers errors as `{ "error": { "code", "message" } }` with 400, 404 or 502. For the app every failure (network error, no answer in `MATCH_ENGINE_TIMEOUT_MS`, status outside 2xx, an answer of the wrong shape) is `500 MATCH_ENGINE_UNAVAILABLE`. A user with nobody to show gets `200` with an empty list and the engine is not called.

## Internal routes of the backend (dropped)

The routes `GET /internal/v1/match-profiles/{userId}` and `GET /internal/v1/match-profiles`, the internal server (`INTERNAL_PORT`) and the `X-Internal-Key` header (`INTERNAL_API_KEY`) are **not built and no longer planned** (Vic, 8 Oct). The backend pushes the user and the candidates to the engine in each request, as the engine supports (`docs/BACKEND_REQUIREMENTS.md` of the engine, "Push flow"). This removes a second port, a shared secret and two routes that would have exposed private data. The engine's own pull mode (`/internal/v1/matching-pool`, `/internal/v1/candidates`) is not served either; its `BACKEND_URL` setting is unused.

## Change log

- 10 October 2026 (Tae): the photo routes are built on RustFS (temporary uploads under `uploads/` with HMAC delete tokens and a one-hour expiry, the sweep that deletes the unused ones, the photo change with the old object deleted after the key swap, and photo serving). Sign up now finishes end to end on a running server.
- 10 October 2026 (Tae): a profile photo that is not 1:1 is center-cropped to a square instead of being rejected, and the stored photo is a JPEG of at most 1024 pixels per side (replaces the A5 square rejection and the no-resize decision of 6 October).
- 9 October 2026 (Vic): `PATCH /notes/{noteId}` and `DELETE /notes/{noteId}` are built, because the app has the edit and the delete screens. Notes (and `lastNote` in `GET /notes/people`) have a new field `updatedAt`, `null` until the note is edited. New error code `NOTE_NOT_FOUND`. The text limit stays 500 characters (the app's own rule and test plan A7, not the 2000 of the database column).
- 9 October 2026 (Vic, after Chuan's pull requests 4 and 5): Auth, sign up, the own profile, the candidate profile and the username check are built. Migration 2 replaced the gender `other` with `prefer_not_to_say` and made `users.photo_key` unique. The rules of `POST /users` and `PATCH /users/me` now state the limits the code enforces (name 1 to 50 characters, password up to 1000, ages 18 to 120, radius 1 to 20000 whole km). Statuses "to review" are gone. The photo routes are still Tae's and not built, so sign up cannot finish on a running server yet.
- 9 October 2026 (Vic, second pass after talking to Tae and Tee): the photo flow follows the app (`POST /photo-uploads`, `DELETE /photo-uploads/{uploadId}`, `photoUploadId` in the JSON sign up, `PUT /users/me/photo`); `bio` and `interests` are dropped (team decision); search stays one way in the engine, so the backend keeps its mutual pre-filter.
- 9 October 2026 (Vic): checked against the app, the engine, the infra repo and the schema. Photos are sent as `photoUrl` (a path), as the app expects. `TOKEN_EXPIRED` is removed: an expired access token answers `UNAUTHENTICATED`. `DELETE /sessions/current` takes an optional `{ refreshToken }`. The rules of the functional test plan (A1 to A8) are written in as decided. Statuses now say built or not built. Auth, places, messaging, favorites, notes and match are built; profile and photos are not.
- 8 October 2026 (Vic): Match Service built. The engine packets follow the engine as built (`candidates`, `matchScore`, `distanceKm`). Cards have `username`. Search is mutual. `GET /notes/people` and `/users/{userId}/notes` added. The internal server is dropped.
- Earlier history (3 to 7 October) is kept in the maintainers' own notes. The app-facing changes are in `docs/app-changes.md`.
