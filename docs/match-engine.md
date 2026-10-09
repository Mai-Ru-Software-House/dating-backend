# Match Engine integration

How the backend works with the Match Engine. The engine is Tae's service (repository `dating-match-engine`). This page is written from the engine's own README, its code (`app/models`, `app/api/internal.py`) and its `docs/BACKEND_REQUIREMENTS.md`, checked on 9 October 2026. If this page and the engine disagree, the engine wins: fix this page and tell Vic. The exact packets are in `docs/api-contract.md`, section "Internal: Backend to Match Engine".

## Roles

| | Backend (this repo) | Match Engine |
| --- | --- | --- |
| Owns | PostgreSQL through Prisma, sessions, profiles, photos, cards for the app | Nothing persistent. It only computes |
| Does | Reads the profiles, keeps the candidates who fit both ways, builds the cards | Checks the mutual rule again, scores each pair, sorts, filters a search |
| Never | Computes the match score | Connects to PostgreSQL, stores users, photos or history |

## Flow (push)

```text
phone --> backend :3000 --(1) read profiles (Prisma)--> PostgreSQL
              |
              +--(2) POST /internal/v1/recommendations  { user, candidates } --> Match Engine :8000
              <--(3) { candidates: [{ userId, matchScore, distanceKm }] }
              |
              +--(4) cards: name, photoUrl, age, gender, placeName, distanceKm, matchScore --> phone
```

The engine also supports a pull mode (it calls the backend for the profiles). The backend does not use it: push needs no second port, no shared key and no internal routes. The engine's `BACKEND_URL` setting is therefore not used.

## What the backend sends

- **Recommendations:** the logged in user (age, gender, coordinates, target preferences) and a pool of candidates in one request, with `limit = offset + limit + 1`.
- **Search:** the criteria (`ageMin`, `ageMax`, `gender`, `radiusKm`, `location`, `limit`) and the pool.
- **Never sent:** date of birth, name, username, photo. Ages are whole years computed in UTC. Gender values are plain strings the engine compares for equality (`female`, `male`, `non_binary`, `prefer_not_to_say`).

## Who does what in the matching rules

| Rule | Where |
| --- | --- |
| Pool: everyone with a location and preferences except the user, at most 2000 profiles | Backend (profile reader) |
| The candidate wants the user: age, gender and distance, using the candidate's own preferences | Backend, before the request (recommendations and search) |
| The user wants the candidate (recommendations) | Engine |
| Search criteria (age, gender, distance from the search point) | Engine |
| Score, ranking and the order of results | Engine |
| Rounding the score to a whole number, whole km distance (at least 1), paging and `hasMore` | Backend |

So a search with empty fields returns the same people as the recommendations (test FM12: bob and chai, not gun).

## The mutual rule and the score (from the engine README)

A pair A and B is eligible when each one fits what the other wants:

1. the gender of B is in the target genders of A, and the other way round;
2. the age of B is inside the age range of A, and the other way round;
3. the distance (great circle, haversine) is within the radius of A and within the radius of B.

The score is 0 to 100. For each direction, `C(A to B) = w_age * S_age + w_distance * S_distance`, with `S_age = exp(-(age(B) - mid_A)^2 / (2 * sigma_A^2))` (mid_A is the middle of A's age range, sigma_A half its width) and `S_distance = exp(-(distance / radius_A)^2)`. The weights are 0.7 and 0.3 by default (`WEIGHT_AGE`, `WEIGHT_DISTANCE`). The mutual score is `100 * sqrt(C(A to B) * C(B to A))`, with one decimal (`SCORE_DECIMALS`). The geometric mean means one side cannot hide a poor fit on the other.

## Settings

| Variable | Where | Meaning |
| --- | --- | --- |
| `MATCH_ENGINE_URL` | backend | Base URL. Infra sets `http://match-engine:8000` |
| `MATCH_ENGINE_TIMEOUT_MS` | backend | How long to wait (default 5000). After that the app gets `500 MATCH_ENGINE_UNAVAILABLE` |
| `WEIGHT_AGE`, `WEIGHT_DISTANCE`, `DEFAULT_AGE_SIGMA`, `SCORE_DECIMALS` | engine | Scoring settings (Tae) |

Health: backend `GET /api/v1/health`, engine `GET /health` (answer `{ "status": "ok", "service": "dating-match-engine" }`).

## Failure

Any problem with the engine (no connection, no answer in time, a status outside 2xx, an answer of the wrong shape) is `500 MATCH_ENGINE_UNAVAILABLE` for the app. A user with nobody to show gets `200` with an empty list and the engine is not called. The client is the only file that knows the engine's packets: `src/services/match/engineClient.ts`. It also accepts snake_case names and a `results` list with `score` from 0 to 1.

## How it is tested

- `bun test test/match`: the service and routes run against a fake engine that rejects any request that is not the engine's packet shape (and any request that carries a private field), on the nine users of the functional test plan.
- On 8 October 2026 the real engine (from a copy, with its own Python environment) was run against the backend and the seeded database: FM01 and FM11 to FM17 behaved as the test plan says.

## Answers from the engine (checked in the engine repo on 9 October 2026)

Tae said the engine is finished, so these were answered from its code and docs, not asked. The engine repo had no new commit after 7 October (`6f84fcc`).

| Question | Answer | Source |
| -------- | ------ | ------ |
| Does search have a mutual option? | **No.** Search in the engine as delivered is one way by design: it only filters by age, gender and distance from the search point. The backend therefore keeps its pre-filter: only candidates whose own preferences accept the user are sent | `matches_search_specification` in `app/services/eligibility.py`; the engine's `docs/BACKEND_REQUIREMENTS.md` section 4.3 ("filters candidates strictly meeting specifications") |
| Is a pool of 2000 candidates fine? | **Yes.** Measured with the real engine code (in process, without the network): a request with 2000 candidates (about 460 KiB) takes about 30 ms for recommendations and about 16 ms for search; 5000 candidates take about 80 ms and 33 ms. The engine sets no limit. The backend still caps the pool at 2000 | Benchmark of 9 October 2026 on a developer laptop |
| Is the engine's requirements doc right about the flow? | It describes **both** flows: pull as the standard flow (section 4.1) and push as the direct payload flow (section 4.2). The backend uses push. The doc also shows Swipes and Blocks in its first diagram and bios in a note, and section 3 ("Backend pre-filtering") ends with an empty list. These are details of Tae's doc; nothing is needed from us | `docs/BACKEND_REQUIREMENTS.md` in the engine repo |
| Keep or remove the pull endpoints and `BACKEND_URL`? | **Kept by the engine.** If a request has no `user` or no `candidates`, the engine asks the backend (`/internal/v1/matching-pool`, `/internal/v1/candidates`). The backend does not serve those routes and always sends the data, so the engine never calls back. Infra still sets `BACKEND_URL` (`http://api:3000`); it stays unused | `app/services/backend_client.py`, `app/config.py`, the infra README |
| Image tags | The engine workflow pushes the tag `:dev` on every push to `main` and to `feat/**` branches, and no commit hash tag. Watchtower follows `:dev`, so the dev server runs whatever branch was pushed last. The backend workflow tags every image with the commit hash and moves `:dev` only from `main`. This is Tae's choice; it is only recorded here | `.github/workflows/package.yml` in the engine repo |

Error answers of the engine, for reference: `400 INVALID_INPUT` (bad body, `age_min` above `age_max`, `radius_km` without a location), `404 NOT_FOUND` (the user is missing in pull mode), `502 BAD_GATEWAY` (the engine could not reach the backend in pull mode). The backend turns every one of them into `500 MATCH_ENGINE_UNAVAILABLE`.
