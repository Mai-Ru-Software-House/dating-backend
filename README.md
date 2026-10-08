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
| Auth      | `POST /sessions`, `POST /sessions/refresh`, `DELETE /sessions/current`                                                                                                      | built, to review |
| Profile   | `GET /usernames/{username}`, `POST /users`, `GET` and `PATCH /users/me`, `GET /users/{userId}`                                                                              | not built        |
| Photos    | `POST /photo-uploads`, `DELETE /photo-uploads/{uploadId}`, `PUT /users/me/photo`, `GET /photos/{photoId}`                                                                   | not built        |
| Location  | `GET /places`                                                                                                                                                               | built            |
| Matching  | `GET /recommendations`, `GET /candidates`                                                                                                                                   | built            |
| Messaging | `GET /conversations`, `GET` and `POST /conversations/{userId}/messages`, `PATCH /conversations/{userId}`, `POST /messages/{messageId}/replies`, `GET /messages?unread=true` | built            |
| Favorites | `GET /favorites`, `PUT` and `DELETE /favorites/{userId}`                                                                                                                    | built            |
| Notes     | `GET` and `POST /notes`, `GET /notes/people`, `GET` and `POST /users/{userId}/notes`                                                                                        | built            |

Messaging, favorites and notes read and write PostgreSQL through repositories that Vic wrote as a proposal for the Data Access Layer ([docs/data-access.md](docs/data-access.md)). The server stops cleanly on `SIGTERM` and refuses a request body over 2 MiB.

## Folders

- `src/index.ts` starts the server. `src/app.ts` builds the app (`createApp`) without listening, so tests can call it.
- `src/config/` environment variables, checked at start up. `src/plugins/` error format, CORS, OpenAPI, session check.
- `src/services/<name>/` one folder per service (auth, location, messaging, favoritesNotes, match, photo).
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
