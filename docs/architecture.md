# Architecture

A one page overview of the Mai Ru system. The deployment details are in the infra repo (`dating-infra`, Tae); the API is in `docs/api-contract.md`; the engine is in `docs/match-engine.md`. Checked on 9 October 2026.

## Components

```text
Mobile app (React Native, Tee)
        |  HTTP + JSON   (Nginx in front)
        v
Backend: Elysia on Bun, port 3000 (this repo)
   |                |                  |                       |
   | SQL (Prisma)   | S3 API           | HTTP + JSON (push)    | HTTP (cached, 1 request per second)
   v                v                  v                       v
PostgreSQL 18    RustFS (photos)   Match Engine (FastAPI)   Nominatim (OpenStreetMap)
```

| Component | Role | Owner | State |
| --------- | ---- | ----- | ----- |
| Backend, web server framework and REST API layer | App setup, config, CORS, error format, session check, route registration | Vic | built |
| Auth Service | Login, refresh, logout, Argon2id passwords, JWT access tokens | Chuan | built, to review |
| Profile Service | Sign up, own profile, candidate profile | Chuan | not built |
| Photo functions | Upload, validate, store in RustFS, serve profile photos | Tae | not built |
| Location Service | Place name from coordinates (Nominatim), distance in km | Vic | built |
| Messaging Service | Send, reply, chat list (favorites first), unread list | Vic | built |
| Favorites and Notes Service | Pin users, private notes | Vic | built |
| Match Service | Calls the engine, applies the mutual rule, builds the cards | Vic and Tae | built |
| Data Access Layer | Prisma repositories, the only code that talks to PostgreSQL | Chuan | schema, client and seed built; repositories for auth, messaging, favorites, notes and matching written by Vic as a proposal, profile and photos still to write |
| Match Engine | Scores and ranks candidates, filters a search. No database | Tae | built |

## Rules of the design

- The backend is the only component that talks to PostgreSQL. Services never write SQL; they use repositories.
- The Match Engine is compute only. The backend pushes the user and the candidates in each request, and the engine answers with scores. There is no internal server and no shared key.
- Photo bytes live in RustFS. The database stores only the object key of the profile photo.
- Sessions are token based (JWT access token plus a rotating refresh token), so the backend can run as several copies.
- Times are created on the server and stored in UTC. The app gets ISO 8601 strings ending in Z.

## The four journeys

- **Create profile:** the app first uploads the photo (`POST /photo-uploads`, kept one hour). Then it sends the profile as JSON with the `photoUploadId`. The backend checks the rules, looks up the place name (a failure only leaves it empty), hashes the password, saves the user in one transaction with the photo and returns tokens and the profile.
- **Log in:** username and password give a token pair. Each request carries the access token; on a `401` the app refreshes once.
- **Find matches:** the backend reads the profiles, keeps the candidates who fit both ways, sends them to the engine, and returns cards with `matchScore` (recommendations) or by distance (search).
- **Chat:** messages are text only. The chat list puts favorites first. Opening a conversation marks its messages as read.

## Deployment

Docker Compose, from the infra repo: Nginx in front of the `api`, `match-engine`, `postgres` and `rustfs` containers on a private network. Dev also runs Watchtower, which pulls a new `:dev` image when one is pushed. Details and the environment variables the backend needs: `docs/infra.md`.
