# Mai Ru backend

REST API of the Mai Ru online dating system (SEN-201), built with Elysia on Bun (TypeScript). It talks to PostgreSQL (Prisma), RustFS (profile photos), the Match Engine (FastAPI) and Nominatim (place names). The mobile app is in `dating-frontend`, the engine in `dating-match-engine`, and Docker Compose and Nginx in `dating-infra`.

## Quick start

```bash
bun install
cp .env.example .env          # fill the dummy values (the server stops at start up if one is missing)
bun run db:deploy             # create the tables (needs PostgreSQL 18)
bun run db:seed               # test users, messages, a favorite and a note from the functional test plan
bun run dev                   # http://localhost:3000, live API docs at /openapi
bun test                      # unit tests (database tests are skipped without TEST_DATABASE_URL)
```

Database tests need `TEST_DATABASE_URL` and run on Linux or WSL (Bun 1.4.2 on Windows crashes when `bun test` talks to PostgreSQL). Before a pull request: `bunx prettier --write .`, `bunx eslint .`, `bun run typecheck`.

## Endpoints

Base path `/api/v1`. Full contract: [docs/api-contract.md](docs/api-contract.md). "Not built" means agreed on paper and owned by someone else.

| Area      | Endpoints                                                                                                                                                                   | State            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| System    | `GET /health`                                                                                                                                                               | built            |
| Auth      | `POST /sessions`, `POST /sessions/refresh`, `DELETE /sessions/current`                                                                                                      | built            |
| Profile   | `GET /usernames/{username}`, `POST /users`, `GET` and `PATCH /users/me`, `GET /users/{userId}`                                                                              | built (see note) |
| Photos    | `POST /photo-uploads`, `DELETE /photo-uploads/{uploadId}`, `PUT /users/me/photo`, `GET /photos/{photoId}`                                                                   | not built        |
| Location  | `GET /places`                                                                                                                                                               | built            |
| Matching  | `GET /recommendations`, `GET /candidates`                                                                                                                                   | built            |
| Messaging | `GET /conversations`, `GET` and `POST /conversations/{userId}/messages`, `PATCH /conversations/{userId}`, `POST /messages/{messageId}/replies`, `GET /messages?unread=true` | built            |
| Favorites | `GET /favorites`, `PUT` and `DELETE /favorites/{userId}`                                                                                                                    | built            |
| Notes     | `GET` and `POST /notes`, `PATCH` and `DELETE /notes/{noteId}`, `GET /notes/people`, `GET` and `POST /users/{userId}/notes`                                                                                        | built            |

Auth, messaging, favorites and notes read and write PostgreSQL through repositories that Vic wrote and Chuan merged (pull request 4). Chuan wrote the Profile Service and its repositories (pull request 5). The Data Access Layer is described in [docs/data-access.md](docs/data-access.md). The server stops cleanly on `SIGTERM` and refuses a request body over 2 MiB.

**Profile Service (Chuan).** Sign up (`POST /users`) checks every rule from the test plan and names the broken field (for example `preferences.minAge`). It creates the user, the password sign in and the target genders in one transaction, stores the place name as "province, district" (empty when the lookup fails), and returns the same tokens as login. `PATCH /users/me` changes display name, date of birth, gender, location (with a new place name) and preferences. The username cannot be changed. `GET /users/{userId}` shows a candidate with `matchScore` (0 when the two users do not fit each other both ways), `lookingFor` and `isFavorite`. A taken username gives `409 USERNAME_TAKEN`.

**Photos are not finished.** Sign up needs the photo upload that Tae builds on RustFS. Until then the app uses an in-memory version that knows no upload, so `POST /users` answers `400` on `photoUploadId`. Chuan already wrote the database side for Tae: find a photo key by photo ID and replace a user's photo key (`src/services/photo/profilePhotoRepository.ts`). A photo key is `profile-photos/<photoId>.<extension>`, and `users.photo_key` is unique.

The database has two migrations. The second one replaces the gender `other` with `prefer_not_to_say` (the four genders are `female`, `male`, `non_binary` and `prefer_not_to_say`) and adds the unique index on `users.photo_key`. The seed users have fixed photo IDs and "province, district" place names.

## Folders

- `src/index.ts` starts the server. `src/app.ts` builds the app (`createApp`) without listening, so tests can call it.
- `src/config/` environment variables, checked at start up. `src/plugins/` error format, CORS, OpenAPI, session check.
- `src/services/<name>/` one folder per service (auth, profile, location, messaging, favoritesNotes, match, photo).
- `src/data/` Prisma client and repositories. `prisma/` schema, migrations and the seed. `src/generated/` the generated Prisma client (committed).
- `test/` tests. `docs/` the team docs below.

## Docs

| Doc                                                                              | For                                                       |
| -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [docs/api-contract.md](docs/api-contract.md)                                     | The REST API (Tee builds the app from it)                 |
| [docs/app-changes.md](docs/app-changes.md)                                       | What the app must change (Tee)                            |
| [docs/data-access.md](docs/data-access.md)                                       | What the database layer must provide (Chuan)              |
| [docs/match-engine.md](docs/match-engine.md)                                     | How the backend works with the Match Engine (Tae)         |
| [docs/infra.md](docs/infra.md)                                                   | What the backend needs from the infra repo (Tae)          |
| [docs/architecture.md](docs/architecture.md)                                     | One page system overview                                  |
| [docs/decisions.md](docs/decisions.md)                                           | What is decided and what is open                          |
| [docs/team.md](docs/team.md)                                                     | Who owns what                                             |
| [docs/MaiRu_CodingStandards.md](docs/MaiRu_CodingStandards.md)                   | Team coding standards                                     |
| [docs/requirements.md](docs/requirements.md), [docs/use-cases/](docs/use-cases/) | Requirements and use cases from the course brief          |
| [docs/test-plans/](docs/test-plans/)                                             | The functional test plan and the Messaging unit test plan |

## Team

Tae (Match Engine, infrastructure, photos), Tee (app), Vic (backend), Chuan (backend and database). Each service has an owner, see [docs/team.md](docs/team.md). Every pull request is reviewed by one other member.
