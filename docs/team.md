# Team and ownership

Team: Mai Ru (project SEN-201, Online Dating System). Source: the Mai Ru work assignments (1 October 2026), updated on 9 October 2026.

| Member | Main area |
| ------ | --------- |
| Tae | Match Engine, infrastructure, photo functions in the backend |
| Tee | Frontend (mobile app) |
| Vic | Backend (main): server framework, REST API layer, Location, Messaging, Favorites and Notes, Match Service |
| Chuan | Backend and database: Auth, Profile, Data Access Layer, PostgreSQL |

## Component owners

| Component | Owner |
| --------- | ----- |
| Mobile app (all pages) | Tee |
| Web server framework (Elysia setup, config, CORS, session check) | Vic |
| REST API layer and the API contract | Vic |
| Auth Service (login, refresh, logout, password hashing) | Chuan (first version written by Vic, to review) |
| Profile Service | Chuan |
| Photo functions (module `src/services/photo/`, not a separate service) | Tae |
| Match Service (calls the engine, builds the cards) | Vic and Tae |
| Match profile reader (Prisma) | Chuan (first version written by Vic, to review) |
| Location Service (Nominatim) | Vic |
| Messaging Service | Vic |
| Favorites and Notes Service | Vic |
| Data Access Layer (Prisma repositories) | Chuan |
| Database (PostgreSQL, schema, migrations, seed) | Chuan |
| Match Engine (FastAPI) | Tae |
| File storage (RustFS) and infrastructure (Docker Compose, Nginx) | Tae |

## Working agreements

- Every pull request is reviewed by one other member, preferably the owner of the component it calls.
- Do not edit another member's service unless the task clearly asks for it. If a change is needed there, explain it and ask first.
- Shared contracts (`docs/api-contract.md`, the Match Engine packets) change only by team agreement. Say who needs to be told: Tee for the API, Tae for the engine and infra, Chuan for the database.
- All code follows `docs/MaiRu_CodingStandards.md`.
