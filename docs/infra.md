# Infra: what the backend needs

The infra repo (`dating-infra`, owner: Tae) is the **source of truth** for deployment: Docker Compose for dev and prod, Nginx and the environment template. This page only summarises it for backend work and lists what the backend needs from it. If this page and the infra repo disagree, the infra repo wins: fix this page and tell Vic.

Checked against the infra repo on 9 October 2026 (`main`, commit `4a723c3`, with Watchtower for dev).

## Services and ports (from the infra README)

| Service | Image | Port inside Docker | Dev host port | Prod host port | Health check |
| --- | --- | --- | --- | --- | --- |
| `nginx` | `nginx:alpine` | 80, 443 | 80, 443 | 80, 443 | `http://localhost/` |
| `api` (this repo) | `ghcr.io/mai-ru-software-house/dating-backend` | 3000 | 3000 | internal only | `GET /api/v1/health` |
| `match-engine` | `ghcr.io/mai-ru-software-house/dating-match-engine` | 8000 | 8000 | internal only | `GET /health` |
| `postgres` | `postgres:18` | 5432 | 5432 | internal only | database `dating_app`, user `app` |
| `rustfs` | `rustfs/rustfs:latest` | 9000 (console 9001) | 9000, 9001 | internal only | `http://localhost:9000` |
| `watchtower` | `containrrr/watchtower` | none | none | not deployed | dev only: pulls new `:dev` images every 30 s for the services labelled `watchtower.enable` (`api`, `match-engine`) |

Networks: `dating-public` (Nginx only) and `dating-internal` (every service). Services reach each other by their compose name. PostgreSQL 18 is needed for `uuidv7()` in the schema.

## Environment variables

### What infra sets for the `api` service today

`NODE_ENV`, `PORT`, `DATABASE_URL` (`postgresql://app:${POSTGRES_PASSWORD}@postgres:5432/dating_app`), `RUSTFS_ENDPOINT`, `RUSTFS_ACCESS_KEY`, `RUSTFS_SECRET_KEY`, `MATCH_ENGINE_URL` (`http://match-engine:8000`), `ARGON2_MEMORY_COST`, `ARGON2_TIME_COST` and `ARGON2_PARALLELISM`. The backend ignores `ARGON2_PARALLELISM` (`Bun.password` has no such option).

### What the backend needs and infra does not set yet

The `api` container stops at start up without the first four.

| Variable | Needed | Value |
| --- | --- | --- |
| `JWT_SECRET` | required | a long random string (a secret, in the infra `.env`) |
| `CORS_ORIGINS` | required | comma separated list of app origins |
| `RUSTFS_BUCKET` | required | for example `mairu-photos`. Tae creates the bucket and the RustFS set up (9 Oct) |
| `NOMINATIM_URL` | required by the backend, set by the infra compose files with this default, so it is not needed in the infra `.env` | `https://nominatim.openstreetmap.org` |
| `ACCESS_TOKEN_TTL_SECONDS` | optional | default `900` (use `60` on a test server for test LG09) |
| `REFRESH_TOKEN_TTL_DAYS` | optional | default `30` |
| `MATCH_ENGINE_TIMEOUT_MS` | optional | default `5000` |
| `NOMINATIM_EMAIL` | optional | a contact email sent to OpenStreetMap |

Paste-ready block for `docker-compose.dev.yaml` and `docker-compose.prod.yaml`, under `api.environment`:

```yaml
      JWT_SECRET: ${JWT_SECRET}
      CORS_ORIGINS: ${CORS_ORIGINS:-http://localhost:8081,http://localhost:19006}
      RUSTFS_BUCKET: ${RUSTFS_BUCKET:-mairu-photos}
      NOMINATIM_URL: ${NOMINATIM_URL:-https://nominatim.openstreetmap.org}
      ACCESS_TOKEN_TTL_SECONDS: ${ACCESS_TOKEN_TTL_SECONDS:-900}
      REFRESH_TOKEN_TTL_DAYS: ${REFRESH_TOKEN_TTL_DAYS:-30}
      MATCH_ENGINE_TIMEOUT_MS: ${MATCH_ENGINE_TIMEOUT_MS:-5000}
      NOMINATIM_EMAIL: ${NOMINATIM_EMAIL:-}
```

And in the infra `.env.example`: `JWT_SECRET`, `CORS_ORIGINS` and `RUSTFS_BUCKET` with dummy values. The full list of backend variables, with defaults, is `.env.example` in this repo.

### What the Match Engine needs from us

Nothing. The backend pushes the candidates in each request (`docs/match-engine.md`), so the engine's `BACKEND_URL` is not used and there is no internal port or key.

## The backend image

- Image name `ghcr.io/mai-ru-software-house/dating-backend`. Infra picks the tag with `BACKEND_IMAGE` (dev uses `:dev`).
- This repo has a `Dockerfile` and a GitHub Actions workflow. Every push to `main` and `feat/**` builds an image tagged with the commit hash. Only `main` moves `:dev`, so Watchtower never follows a feature branch.
- The server stops cleanly when Docker sends `SIGTERM` (it finishes the requests in progress and closes the database). It refuses a request body over 2 MiB.
- On start the container runs `bun run db:deploy` (applies pending migrations), then the server. The database now has two migrations (the second replaced the gender `other` with `prefer_not_to_say` and made `users.photo_key` unique). The schema owner (Chuan) and Tae should agree whether migrations run automatically like this, or only by hand.
- The generated Prisma client is committed in `src/generated`, so the build runs no `prisma generate`.

## Nginx

- Dev: one rule sends every path to `http://api:3000`. Prod: only `/api/` is proxied, `/internal/` answers 404, and it listens on port 80 (HTTPS is not configured yet).
- Nginx sets `X-Real-IP` and `X-Forwarded-For`. Per client limits should use `X-Real-IP`.
- **Request to Tae:** `client_max_body_size` is not set, so Nginx refuses any request over its default of 1 MB with its own HTML 413. A photo upload of 1 MB plus the multipart overhead is larger than that, and the test plan expects our own message for a photo over 1 MB (CP20). Please set `client_max_body_size 2m;` in both Nginx files.

## Keep in sync

- A new or renamed variable in `src/config/env.ts` means: update `.env.example`, update this page, and tell Tae before merging so the compose files can be updated.
- A new port, path prefix or health path also needs Tae.
