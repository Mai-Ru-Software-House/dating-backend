/*
 * Tests for the Match Engine client: the packets it sends, the answers it accepts (the engine's
 * own names, snake_case and the `results` fallback) and every failure turning into
 * MATCH_ENGINE_UNAVAILABLE.
 */
import { describe, expect, it } from "bun:test";

import { ApiError } from "../../src/plugins/errors";
import {
  createMatchEngineClient,
  type EngineProfile,
  type RecommendInput,
  type SearchInput,
} from "../../src/services/match/engineClient";
import { createMockFetch, jsonResponse } from "../location/mockFetch";

const BASE_URL = "http://match-engine.test:8000/";

const USER: EngineProfile = {
  userId: "usr_alice",
  age: 27,
  gender: "female",
  latitude: 13.7466,
  longitude: 100.5393,
  targetPreference: { ageMin: 24, ageMax: 32, gender: ["male"], radiusKm: 50 },
};
const CANDIDATE: EngineProfile = {
  userId: "usr_bob",
  age: 28,
  gender: "male",
  latitude: 13.7279,
  longitude: 100.5241,
  targetPreference: { ageMin: 22, ageMax: 30, gender: ["female"], radiusKm: 30 },
};
const RECOMMEND: RecommendInput = {
  userId: "usr_alice",
  limit: 5,
  user: USER,
  candidates: [CANDIDATE],
};
const SEARCH: SearchInput = {
  ageMin: 25,
  ageMax: 26,
  genders: ["male"],
  radiusKm: 20,
  location: { lat: 13.7466, lng: 100.5393 },
  limit: 20,
  candidates: [CANDIDATE],
};

async function catchError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

function expectUnavailable(error: unknown): void {
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(500);
  expect((error as ApiError).code).toBe("MATCH_ENGINE_UNAVAILABLE");
}

function clientFor(handler: Parameters<typeof createMockFetch>[0], timeoutMs = 1000) {
  const { fetch, calls } = createMockFetch(handler);
  return { client: createMatchEngineClient({ baseUrl: BASE_URL, timeoutMs, fetch }), calls };
}

describe("recommend", () => {
  it("posts the engine's packet to /internal/v1/recommendations", async () => {
    const { client, calls } = clientFor(() => jsonResponse({ candidates: [] }));

    await client.recommend(RECOMMEND);

    const call = calls[0]!;
    expect(call.url.href).toBe("http://match-engine.test:8000/internal/v1/recommendations");
    expect(call.method).toBe("POST");
    expect(call.headers.get("content-type")).toBe("application/json");
    expect(call.body).toEqual({
      userId: "usr_alice",
      limit: 5,
      user: USER,
      candidates: [CANDIDATE],
    });
  });

  it("reads candidates with matchScore from 0 to 100 and distanceKm", async () => {
    const { client } = clientFor(() =>
      jsonResponse({
        candidates: [
          { userId: "usr_bob", matchScore: 94.3, distanceKm: 3.2 },
          { userId: "usr_chai", matchScore: 71, distanceKm: 13.4 },
        ],
      }),
    );

    expect(await client.recommend(RECOMMEND)).toEqual([
      { userId: "usr_bob", score: 94.3, distanceKm: 3.2 },
      { userId: "usr_chai", score: 71, distanceKm: 13.4 },
    ]);
  });

  it("also reads snake_case names", async () => {
    const { client } = clientFor(() =>
      jsonResponse({ candidates: [{ user_id: "usr_bob", match_score: 88, distance_km: 3 }] }),
    );
    expect(await client.recommend(RECOMMEND)).toEqual([
      { userId: "usr_bob", score: 88, distanceKm: 3 },
    ]);
  });

  it("accepts the results list with a score from 0 to 1 and turns it into 0 to 100", async () => {
    const { client } = clientFor(() =>
      jsonResponse({ results: [{ userId: "usr_bob", score: 0.94 }] }),
    );
    const [first] = await client.recommend(RECOMMEND);
    expect(first?.userId).toBe("usr_bob");
    expect(first?.score).toBeCloseTo(94);
    expect(first?.distanceKm).toBeNull();
  });

  it("keeps a score inside 0 to 100", async () => {
    const { client } = clientFor(() =>
      jsonResponse({
        candidates: [
          { userId: "a", matchScore: 140 },
          { userId: "b", matchScore: -3 },
        ],
      }),
    );
    expect((await client.recommend(RECOMMEND)).map((hit) => hit.score)).toEqual([100, 0]);
  });

  it("returns an empty list for an empty answer", async () => {
    const { client } = clientFor(() => jsonResponse({ candidates: [] }));
    expect(await client.recommend(RECOMMEND)).toEqual([]);
  });
});

describe("search", () => {
  it("posts the engine's search packet with `gender` and `location` to /internal/v1/candidates/search", async () => {
    const { client, calls } = clientFor(() => jsonResponse({ candidates: [] }));

    await client.search(SEARCH);

    const call = calls[0]!;
    expect(call.url.pathname).toBe("/internal/v1/candidates/search");
    expect(call.body).toEqual({
      ageMin: 25,
      ageMax: 26,
      gender: ["male"],
      radiusKm: 20,
      location: { lat: 13.7466, lng: 100.5393 },
      limit: 20,
      candidates: [CANDIDATE],
    });
  });

  it("reads userId and distanceKm", async () => {
    const { client } = clientFor(() =>
      jsonResponse({ candidates: [{ userId: "usr_chai", distanceKm: 13.4 }, { user_id: "x" }] }),
    );
    expect(await client.search(SEARCH)).toEqual([
      { userId: "usr_chai", distanceKm: 13.4 },
      { userId: "x", distanceKm: null },
    ]);
  });
});

describe("failures", () => {
  it("turns a status outside 2xx into MATCH_ENGINE_UNAVAILABLE (400, 404, 502, 500)", async () => {
    for (const status of [400, 404, 502, 500]) {
      const { client } = clientFor(() =>
        jsonResponse({ error: { code: "BAD_GATEWAY", message: "x" } }, status),
      );
      expectUnavailable(await catchError(client.recommend(RECOMMEND)));
      expectUnavailable(await catchError(client.search(SEARCH)));
    }
  });

  it("turns a network error into MATCH_ENGINE_UNAVAILABLE (FM17)", async () => {
    const { client } = clientFor(() => {
      throw new TypeError("fetch failed");
    });
    expectUnavailable(await catchError(client.recommend(RECOMMEND)));
  });

  it("turns a timeout into MATCH_ENGINE_UNAVAILABLE", async () => {
    const { client } = clientFor(() => new Promise<Response>(() => {}), 20);
    expectUnavailable(await catchError(client.recommend(RECOMMEND)));
  });

  it("turns an answer that is not JSON into MATCH_ENGINE_UNAVAILABLE", async () => {
    const { client } = clientFor(() => new Response("<html>oops</html>", { status: 200 }));
    expectUnavailable(await catchError(client.recommend(RECOMMEND)));
  });

  it("turns an answer of the wrong shape into MATCH_ENGINE_UNAVAILABLE", async () => {
    for (const body of [
      [],
      { candidates: "none" },
      { candidates: [{ matchScore: 90 }] },
      { candidates: [{ userId: "usr_bob" }] },
      { candidates: [{ userId: "usr_bob", matchScore: "high" }] },
    ]) {
      const { client } = clientFor(() => jsonResponse(body));
      expectUnavailable(await catchError(client.recommend(RECOMMEND)));
    }
    const { client } = clientFor(() => jsonResponse({ candidates: [{ distanceKm: 3 }] }));
    expectUnavailable(await catchError(client.search(SEARCH)));
  });
});
