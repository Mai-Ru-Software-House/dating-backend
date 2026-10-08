/*
 * Tests for the Match Service on the fake engine, following the functional test plan
 * (FM01 to FM17): recommendations, the mutual rule, search, validation and engine failure.
 */
import { describe, expect, it } from "bun:test";

import { createMatchEngineClient } from "../../src/services/match/engineClient";
import { createInMemoryMatchProfileReader } from "../../src/services/match/inMemoryMatchProfileReader";
import { createMatchService } from "../../src/services/match/matchService";
import { expectApiError } from "../messaging/fixtures";
import { ALICE, BOB, CHAI, JOE, MINT, NOW, TEST_USERS, createTestMatchService } from "./fixtures";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_INTERNAL_ERROR = 500;
const MAX_SCORE = 100;

describe("getRecommendations", () => {
  it("FM01: shows exactly bob and chai for alice, with every field of the row", async () => {
    const { service } = createTestMatchService();
    const { recommendations, hasMore } = await service.getRecommendations(ALICE.userId, {});

    expect(recommendations.map((card) => card.username)).toEqual(["bob", "chai"]);
    expect(hasMore).toBe(false);
    const [bob, chai] = recommendations;
    expect(bob).toMatchObject({
      userId: BOB.userId,
      username: "bob",
      displayName: "Bob",
      photoId: "pho_bob",
      age: 28,
      gender: "male",
      placeName: "Bangkok, Bang Rak",
    });
    expect(Number.isInteger(bob?.distanceKm)).toBe(true);
    expect(bob?.distanceKm).toBeGreaterThanOrEqual(2);
    expect(bob?.distanceKm).toBeLessThanOrEqual(4);
    expect(chai?.distanceKm).toBeGreaterThanOrEqual(12);
    expect(chai?.distanceKm).toBeLessThanOrEqual(14);
    for (const card of recommendations) {
      expect(Number.isInteger(card.matchScore)).toBe(true);
      expect(card.matchScore).toBeGreaterThanOrEqual(0);
      expect(card.matchScore).toBeLessThanOrEqual(MAX_SCORE);
    }
  });

  it("FM02 to FM05: dan, ekk, fah, hana and gun are not in the list", async () => {
    const { service } = createTestMatchService();
    const { recommendations } = await service.getRecommendations(ALICE.userId, {});
    const names = recommendations.map((card) => card.username);
    for (const hidden of ["dan", "ekk", "fah", "hana", "gun"]) {
      expect(names).not.toContain(hidden);
    }
  });

  it("FM06: alice does not see herself", async () => {
    const { service } = createTestMatchService();
    const { recommendations } = await service.getRecommendations(ALICE.userId, {});
    expect(recommendations.map((card) => card.userId)).not.toContain(ALICE.userId);
  });

  it("FM07: scores go from highest to lowest and nobody appears twice", async () => {
    const { service } = createTestMatchService();
    const { recommendations } = await service.getRecommendations(ALICE.userId, {});
    const scores = recommendations.map((card) => card.matchScore ?? 0);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(new Set(recommendations.map((card) => card.userId)).size).toBe(recommendations.length);
    // bob is nearer than chai, so he scores higher.
    expect(recommendations[0]?.username).toBe("bob");
  });

  it("FM08: a new profile shows up for bob at once, 1 km at least", async () => {
    const { service, profiles } = createTestMatchService();
    const before = await service.getRecommendations(BOB.userId, {});
    expect(before.recommendations.map((card) => card.username)).toEqual(["alice", "fah"]);

    profiles.push(MINT);
    const after = await service.getRecommendations(BOB.userId, {});
    const mint = after.recommendations.find((card) => card.username === "mint_01");
    expect(mint).toBeDefined();
    expect(mint?.distanceKm).toBeGreaterThanOrEqual(1);
    expect(mint?.distanceKm).toBeLessThanOrEqual(3);
  });

  it("FM16: joe gets an empty list, and the engine is not asked", async () => {
    const { service, engine } = createTestMatchService();
    const result = await service.getRecommendations(JOE.userId, {});
    expect(result).toEqual({ recommendations: [], hasMore: false });
    expect(engine.calls).toHaveLength(0);
  });

  it("FM17: answers 500 MATCH_ENGINE_UNAVAILABLE when the engine is down", async () => {
    const { service, engine } = createTestMatchService();
    engine.state.isDown = true;
    await expectApiError(
      service.getRecommendations(ALICE.userId, {}),
      HTTP_INTERNAL_ERROR,
      "MATCH_ENGINE_UNAVAILABLE",
    );
  });

  it("FM16 and FM17: a user with nobody to show gets an empty list even when the engine is down", async () => {
    const { service, engine } = createTestMatchService();
    engine.state.isDown = true;
    expect((await service.getRecommendations(JOE.userId, {})).recommendations).toEqual([]);
  });

  it("answers 404 USER_NOT_FOUND for a user without a profile", async () => {
    const { service } = createTestMatchService();
    await expectApiError(service.getRecommendations("99999", {}), HTTP_NOT_FOUND, "USER_NOT_FOUND");
  });
});

describe("what the engine receives", () => {
  it("is one push request with the engine's packet and no private data", async () => {
    const { service, engine } = createTestMatchService();
    await service.getRecommendations(ALICE.userId, { limit: 5 });

    expect(engine.calls).toHaveLength(1);
    const call = engine.calls[0]!;
    expect(call.path).toBe("/internal/v1/recommendations");
    expect(call.body.userId).toBe(ALICE.userId);
    expect(call.body.limit).toBe(6);
    expect(call.body.user).toEqual({
      userId: ALICE.userId,
      age: 27,
      gender: "female",
      latitude: ALICE.latitude,
      longitude: ALICE.longitude,
      targetPreference: { ageMin: 24, ageMax: 32, gender: ["male"], radiusKm: 50 },
    });
    const sent = JSON.stringify(call.body);
    expect(sent).not.toContain("dateOfBirth");
    expect(sent).not.toContain("1999-03-10");
    expect(sent).not.toContain("displayName");
    expect(sent).not.toContain("username");
  });

  it("only holds candidates who want alice, so the pool is small", async () => {
    const { service, engine } = createTestMatchService();
    await service.getRecommendations(ALICE.userId, {});
    const candidates = engine.calls[0]!.body.candidates as { userId: string }[];
    const sent = candidates.map((candidate) => candidate.userId).sort();
    expect(sent).toEqual([BOB.userId, CHAI.userId].sort());
  });
});

describe("paging", () => {
  async function serviceWithManyMen() {
    const men = Array.from({ length: 7 }, (_, index) => ({
      ...BOB,
      userId: `usr_man${index}`,
      username: `man_${index}`,
      displayName: `Man ${index}`,
      photoId: `pho_man${index}`,
      // Each man is a little farther away, so the order is fixed.
      latitude: BOB.latitude + index * 0.01,
    }));
    return createTestMatchService([ALICE, ...men]);
  }

  it("returns the first page with hasMore, asking the engine for one extra", async () => {
    const { service, engine } = await serviceWithManyMen();
    const page = await service.getRecommendations(ALICE.userId, { limit: 3 });
    expect(page.recommendations).toHaveLength(3);
    expect(page.hasMore).toBe(true);
    expect(engine.calls[0]!.body.limit).toBe(4);
  });

  it("returns the next page after the offset, with no repeats", async () => {
    const { service } = await serviceWithManyMen();
    const first = await service.getRecommendations(ALICE.userId, { limit: 3 });
    const second = await service.getRecommendations(ALICE.userId, { limit: 3, offset: 3 });
    const third = await service.getRecommendations(ALICE.userId, { limit: 3, offset: 6 });

    const all = [...first.recommendations, ...second.recommendations, ...third.recommendations];
    expect(all).toHaveLength(7);
    expect(new Set(all.map((card) => card.userId)).size).toBe(7);
    expect(second.hasMore).toBe(true);
    expect(third.hasMore).toBe(false);
  });

  it("returns an empty page past the end", async () => {
    const { service } = await serviceWithManyMen();
    const page = await service.getRecommendations(ALICE.userId, { limit: 3, offset: 30 });
    expect(page).toEqual({ recommendations: [], hasMore: false });
  });

  it("rejects a limit or offset out of range with the field", async () => {
    const { service } = createTestMatchService();
    for (const [query, field] of [
      [{ limit: 0 }, "limit"],
      [{ limit: 51 }, "limit"],
      [{ limit: 2.5 }, "limit"],
      [{ offset: -1 }, "offset"],
      [{ limit: 50, offset: 151 }, "offset"],
    ] as const) {
      await expectApiError(
        service.getRecommendations(ALICE.userId, query),
        HTTP_BAD_REQUEST,
        "INVALID_INPUT",
        field,
      );
    }
  });
});

describe("what the engine sends back", () => {
  function serviceWithAnswer(candidates: unknown[]) {
    return createMatchService({
      profiles: createInMemoryMatchProfileReader(TEST_USERS),
      engine: createMatchEngineClient({
        baseUrl: "http://match-engine.test:8000",
        timeoutMs: 1000,
        fetch: (async () => Response.json({ candidates })) as unknown as typeof fetch,
      }),
      now: () => NOW,
    });
  }

  it("ignores unknown and repeated users, and rounds the score to a whole number", async () => {
    const service = serviceWithAnswer([
      { userId: BOB.userId, matchScore: 86.6, distanceKm: 3 },
      { userId: "usr_unknown", matchScore: 99, distanceKm: 1 },
      { userId: BOB.userId, matchScore: 10, distanceKm: 3 },
      { userId: CHAI.userId, matchScore: 40.4, distanceKm: 13 },
    ]);
    const { recommendations } = await service.getRecommendations(ALICE.userId, {});
    expect(recommendations.map((card) => [card.username, card.matchScore])).toEqual([
      ["bob", 87],
      ["chai", 40],
    ]);
  });

  it("puts the best score first even if the engine answers in another order", async () => {
    const service = serviceWithAnswer([
      { userId: CHAI.userId, matchScore: 40, distanceKm: 13 },
      { userId: BOB.userId, matchScore: 90, distanceKm: 3 },
    ]);
    const { recommendations } = await service.getRecommendations(ALICE.userId, {});
    expect(recommendations.map((card) => card.username)).toEqual(["bob", "chai"]);
  });

  it("shows no one for a search hit that was not in the pool", async () => {
    const service = serviceWithAnswer([{ userId: "usr_unknown", distanceKm: 1 }]);
    expect((await service.searchCandidates(ALICE.userId, {})).candidates).toEqual([]);
  });
});

describe("searchCandidates", () => {
  it("FM11: age 25 to 26, male, 20 km finds only chai", async () => {
    const { service } = createTestMatchService();
    const { candidates } = await service.searchCandidates(ALICE.userId, {
      minAge: 25,
      maxAge: 26,
      targetGenders: ["male"],
      maxDistanceKm: 20,
    });
    expect(candidates.map((card) => card.username)).toEqual(["chai"]);
    expect(candidates[0]).not.toHaveProperty("matchScore");
    expect(Number.isInteger(candidates[0]?.distanceKm)).toBe(true);
  });

  it("FM12: an empty search uses alice's own preferences and finds bob and chai, not gun", async () => {
    const { service } = createTestMatchService();
    const { candidates } = await service.searchCandidates(ALICE.userId, {});
    expect(candidates.map((card) => card.username)).toEqual(["bob", "chai"]);
  });

  it("sends the engine alice's preferences and location when the search is empty", async () => {
    const { service, engine } = createTestMatchService();
    await service.searchCandidates(ALICE.userId, {});
    const body = engine.calls[0]!.body;
    expect(engine.calls[0]!.path).toBe("/internal/v1/candidates/search");
    expect(body).toMatchObject({
      ageMin: 24,
      ageMax: 32,
      gender: ["male"],
      radiusKm: 50,
      location: { lat: ALICE.latitude, lng: ALICE.longitude },
      limit: 20,
    });
  });

  it("sorts the cards nearest first", async () => {
    const { service } = createTestMatchService();
    const { candidates } = await service.searchCandidates(ALICE.userId, { maxDistanceKm: 50 });
    const distances = candidates.map((card) => card.distanceKm);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it("measures the distance from a search point that is not alice's own", async () => {
    const { service } = createTestMatchService();
    // A point next to chai: chai is about 0 km away, so 1 km after rounding.
    const { candidates } = await service.searchCandidates(ALICE.userId, {
      lat: CHAI.latitude,
      lon: CHAI.longitude,
      maxDistanceKm: 5,
      minAge: 24,
      maxAge: 32,
    });
    expect(candidates.map((card) => [card.username, card.distanceKm])).toEqual([["chai", 1]]);
  });

  it("still applies the mutual rule: gun fits alice's search but does not want her", async () => {
    const { service } = createTestMatchService();
    const { candidates } = await service.searchCandidates(ALICE.userId, {
      minAge: 18,
      maxAge: 60,
      targetGenders: ["male"],
      maxDistanceKm: 1000,
    });
    const names = candidates.map((card) => card.username);
    expect(names).not.toContain("gun");
    expect(names).toContain("ekk");
  });

  it("honours the limit", async () => {
    const { service } = createTestMatchService();
    const { candidates } = await service.searchCandidates(ALICE.userId, { limit: 1 });
    expect(candidates).toHaveLength(1);
  });

  it("answers 500 MATCH_ENGINE_UNAVAILABLE when the engine is down", async () => {
    const { service, engine } = createTestMatchService();
    engine.state.isDown = true;
    await expectApiError(
      service.searchCandidates(ALICE.userId, {}),
      HTTP_INTERNAL_ERROR,
      "MATCH_ENGINE_UNAVAILABLE",
    );
  });

  it("FM13: min age above max age answers 400 and names the age range", async () => {
    const { service } = createTestMatchService();
    let message = "";
    try {
      await service.searchCandidates(ALICE.userId, { minAge: 30, maxAge: 25 });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("age range");
    await expectApiError(
      service.searchCandidates(ALICE.userId, { minAge: 30, maxAge: 25 }),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "minAge",
    );
  });

  it("FM15: an age below 18 answers 400 and says the minimum age is 18", async () => {
    const { service } = createTestMatchService();
    let message = "";
    try {
      await service.searchCandidates(ALICE.userId, { minAge: 15, maxAge: 30 });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe("The minimum age is 18.");
    await expectApiError(
      service.searchCandidates(ALICE.userId, { minAge: 17 }),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "minAge",
    );
    expect((await service.searchCandidates(ALICE.userId, { minAge: 18 })).candidates).toBeDefined();
  });

  it("rejects a distance that is not above 0, and a half given point", async () => {
    const { service } = createTestMatchService();
    for (const maxDistanceKm of [0, -5, Number.NaN]) {
      await expectApiError(
        service.searchCandidates(ALICE.userId, { maxDistanceKm }),
        HTTP_BAD_REQUEST,
        "INVALID_INPUT",
        "maxDistanceKm",
      );
    }
    await expectApiError(
      service.searchCandidates(ALICE.userId, { lat: 13.7 }),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "lon",
    );
    await expectApiError(
      service.searchCandidates(ALICE.userId, { lat: 95, lon: 100 }),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "lat",
    );
  });

  it("rejects a limit out of range and an empty gender list", async () => {
    const { service } = createTestMatchService();
    await expectApiError(
      service.searchCandidates(ALICE.userId, { limit: 51 }),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "limit",
    );
    await expectApiError(
      service.searchCandidates(ALICE.userId, { targetGenders: [] }),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "targetGenders",
    );
  });

  it("answers 404 USER_NOT_FOUND for a user without a profile", async () => {
    const { service } = createTestMatchService();
    await expectApiError(service.searchCandidates("99999", {}), HTTP_NOT_FOUND, "USER_NOT_FOUND");
  });
});
