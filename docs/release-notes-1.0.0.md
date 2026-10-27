# Backend release notes: 1.0.0

Date: 2026-10-27. Image: `ghcr.io/mai-ru-software-house/dating-backend:1.0.0`.

## What is in this release

The first full release of the Mai Ru REST API under `/api/v1`. The full contract is in [api-contract.md](api-contract.md).

- Auth: sign in, refresh and sign out with access and refresh tokens.
- Profile: sign up, read and edit your profile, see a candidate with a match score.
- Photos: upload, crop to a square, store in RustFS, replace the profile photo.
- Location: place names from Nominatim, cached and limited to 1 request per second.
- Matching: recommendations and search, scored by the Match Engine.
- Messaging: conversations, messages, replies and unread messages.
- Favorites and notes: private to their owner.

## How it runs

- The image runs on Bun 1.4.2 with PostgreSQL 18 and Prisma 7.10.0.
- When the container starts, it applies pending migrations (`bun run db:deploy`), then starts the server.
- All settings come from environment variables. The names are in `.env.example`.
- Health check: `GET /api/v1/health`.

## Known limits

- The server is reached over plain HTTP until HTTPS is set up in the infra repo.
- A request body over 6 MiB is refused. A photo can be at most 5 MB.
- Nominatim allows 1 request per second, so a new place name can take a moment.
- The database has two migrations. Rolling back past a migration needs a restored backup.

## How a release is made

1. Change the version in `package.json` and in `src/plugins/openapi.ts`.
2. Merge to `main` and wait for green CI.
3. Push a git tag such as `v1.0.0`. The workflow checks that the tag matches `package.json`, runs the tests, and pushes the image with the tags `1.0.0` and the commit hash.
