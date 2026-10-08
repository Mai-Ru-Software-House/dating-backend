/*
 * Shared setup for the Match tests: the nine users of the functional test plan (Test Users sheet,
 * values from prisma/seed.ts), a fixed clock and a fake Match Engine that answers like the real
 * one (dating-match-engine) and rejects requests that do not have the engine's packet shape.
 */
import { distanceKm } from "../../src/services/location/distance";
import { createMatchEngineClient } from "../../src/services/match/engineClient";
import { createInMemoryMatchProfileReader } from "../../src/services/match/inMemoryMatchProfileReader";
import { createMatchService } from "../../src/services/match/matchService";
import type { MatchProfile } from "../../src/services/match/matchTypes";

/** The moment of every test. On this day alice is 27, bob 28, chai 25, dan 41, gun 30. */
export const NOW = new Date("2026-10-08T03:00:00.000Z");

interface UserRow {
  username: string;
  gender: string;
  dateOfBirth: string;
  latitude: number;
  longitude: number;
  placeName: string;
  targets: string[];
  ageMin: number;
  ageMax: number;
  radiusKm: number;
}

function makeProfile(row: UserRow): MatchProfile {
  const displayName = row.username.charAt(0).toUpperCase() + row.username.slice(1);
  return {
    userId: `usr_${row.username}`,
    username: row.username,
    displayName,
    photoId: `pho_${row.username}`,
    gender: row.gender,
    dateOfBirth: new Date(`${row.dateOfBirth}T00:00:00.000Z`),
    latitude: row.latitude,
    longitude: row.longitude,
    placeName: row.placeName,
    preference: {
      ageMin: row.ageMin,
      ageMax: row.ageMax,
      genders: row.targets,
      radiusKm: row.radiusKm,
    },
  };
}

export const ALICE = makeProfile({
  username: "alice",
  gender: "female",
  dateOfBirth: "1999-03-10",
  latitude: 13.7466,
  longitude: 100.5393,
  placeName: "Bangkok, Pathum Wan",
  targets: ["male"],
  ageMin: 24,
  ageMax: 32,
  radiusKm: 50,
});
export const BOB = makeProfile({
  username: "bob",
  gender: "male",
  dateOfBirth: "1998-05-20",
  latitude: 13.7279,
  longitude: 100.5241,
  placeName: "Bangkok, Bang Rak",
  targets: ["female"],
  ageMin: 22,
  ageMax: 30,
  radiusKm: 30,
});
export const CHAI = makeProfile({
  username: "chai",
  gender: "male",
  dateOfBirth: "2001-02-14",
  latitude: 13.8621,
  longitude: 100.5144,
  placeName: "Nonthaburi, Mueang Nonthaburi",
  targets: ["female"],
  ageMin: 22,
  ageMax: 30,
  radiusKm: 20,
});
export const DAN = makeProfile({
  username: "dan",
  gender: "male",
  dateOfBirth: "1985-01-05",
  latitude: 13.7563,
  longitude: 100.5018,
  placeName: "Bangkok",
  targets: ["female"],
  ageMin: 25,
  ageMax: 45,
  radiusKm: 50,
});
export const EKK = makeProfile({
  username: "ekk",
  gender: "male",
  dateOfBirth: "1997-04-01",
  latitude: 18.7883,
  longitude: 98.9853,
  placeName: "Chiang Mai, Mueang Chiang Mai",
  targets: ["female"],
  ageMin: 22,
  ageMax: 35,
  radiusKm: 1000,
});
export const FAH = makeProfile({
  username: "fah",
  gender: "female",
  dateOfBirth: "2000-07-07",
  latitude: 13.765,
  longitude: 100.538,
  placeName: "Bangkok",
  targets: ["male"],
  ageMin: 24,
  ageMax: 35,
  radiusKm: 25,
});
export const GUN = makeProfile({
  username: "gun",
  gender: "male",
  dateOfBirth: "1996-04-22",
  latitude: 13.5991,
  longitude: 100.5998,
  placeName: "Samut Prakan",
  targets: ["female"],
  ageMin: 20,
  ageMax: 26,
  radiusKm: 40,
});
export const HANA = makeProfile({
  username: "hana",
  gender: "female",
  dateOfBirth: "1995-08-30",
  latitude: 13.74,
  longitude: 100.56,
  placeName: "Bangkok",
  targets: ["male"],
  ageMin: 25,
  ageMax: 40,
  radiusKm: 30,
});
export const JOE = makeProfile({
  username: "joe",
  gender: "male",
  dateOfBirth: "1950-06-01",
  latitude: 14.3532,
  longitude: 100.5689,
  placeName: "Ayutthaya",
  targets: ["female"],
  ageMin: 70,
  ageMax: 80,
  radiusKm: 5,
});
/** The new user of test CP01 and FM08: female, 15 Sep 1999, wants male 24 to 32 within 30 km. */
export const MINT = makeProfile({
  username: "mint_01",
  gender: "female",
  dateOfBirth: "1999-09-15",
  latitude: 13.73,
  longitude: 100.53,
  placeName: "Bangkok, Pathum Wan",
  targets: ["male"],
  ageMin: 24,
  ageMax: 32,
  radiusKm: 30,
});

export const TEST_USERS = [ALICE, BOB, CHAI, DAN, EKK, FAH, GUN, HANA, JOE];

const MAX_SCORE = 100;
const SCORE_PENALTY_PER_KM = 2;
const ALLOWED_PROFILE_KEYS = [
  "userId",
  "age",
  "gender",
  "latitude",
  "longitude",
  "targetPreference",
];

interface FakeProfile {
  userId: string;
  age: number;
  gender: string;
  latitude: number;
  longitude: number;
  targetPreference?: { ageMin: number; ageMax: number; gender: string[]; radiusKm: number };
}

/** A request the fake engine received. */
export interface EngineCall {
  path: string;
  body: Record<string, unknown>;
}

function badRequest(message: string): Response {
  return Response.json({ error: { code: "INVALID_INPUT", message } }, { status: 400 });
}

function checkProfile(value: unknown, needsPreference: boolean): FakeProfile | string {
  if (typeof value !== "object" || value === null) {
    return "profile must be an object";
  }
  const profile = value as Record<string, unknown>;
  const extra = Object.keys(profile).filter((key) => !ALLOWED_PROFILE_KEYS.includes(key));
  if (extra.length > 0) {
    return `unexpected profile fields: ${extra.join(", ")}`;
  }
  const isValid =
    typeof profile.userId === "string" &&
    Number.isInteger(profile.age) &&
    typeof profile.gender === "string" &&
    typeof profile.latitude === "number" &&
    typeof profile.longitude === "number";
  if (!isValid) {
    return "profile needs userId, age, gender, latitude and longitude";
  }
  if (needsPreference && typeof profile.targetPreference !== "object") {
    return "user needs targetPreference";
  }
  return profile as unknown as FakeProfile;
}

function fits(
  wants: NonNullable<FakeProfile["targetPreference"]>,
  age: number,
  gender: string,
  km: number,
): boolean {
  return (
    age >= wants.ageMin &&
    age <= wants.ageMax &&
    wants.gender.includes(gender) &&
    km <= wants.radiusKm
  );
}

function recommend(body: Record<string, unknown>): Response {
  const user = checkProfile(body.user, true);
  if (typeof user === "string") {
    return badRequest(user);
  }
  if (
    typeof body.userId !== "string" ||
    !Number.isInteger(body.limit) ||
    !Array.isArray(body.candidates)
  ) {
    return badRequest("userId, limit and candidates are required");
  }
  const found: { userId: string; matchScore: number; distanceKm: number }[] = [];
  for (const raw of body.candidates) {
    const candidate = checkProfile(raw, false);
    if (typeof candidate === "string") {
      return badRequest(candidate);
    }
    const km = distanceKm(
      { lat: user.latitude, lon: user.longitude },
      { lat: candidate.latitude, lon: candidate.longitude },
    );
    const userFitsCandidate =
      candidate.targetPreference === undefined ||
      fits(candidate.targetPreference, user.age, user.gender, km);
    if (
      user.targetPreference !== undefined &&
      fits(user.targetPreference, candidate.age, candidate.gender, km) &&
      userFitsCandidate
    ) {
      const score = Math.max(0, MAX_SCORE - km * SCORE_PENALTY_PER_KM);
      found.push({
        userId: candidate.userId,
        matchScore: Math.round(score * 10) / 10,
        distanceKm: Math.round(km * 100) / 100,
      });
    }
  }
  found.sort((a, b) => b.matchScore - a.matchScore);
  const limited = found.slice(0, body.limit as number);
  // The real engine sends both camelCase and snake_case names.
  return Response.json({
    candidates: limited.map((item) => ({
      ...item,
      user_id: item.userId,
      match_score: item.matchScore,
      distance_km: item.distanceKm,
    })),
  });
}

function search(body: Record<string, unknown>): Response {
  const location = body.location as { lat?: number; lng?: number } | undefined;
  const wanted = body.gender;
  const isValid =
    Number.isInteger(body.ageMin) &&
    Number.isInteger(body.ageMax) &&
    Array.isArray(wanted) &&
    typeof body.radiusKm === "number" &&
    typeof location?.lat === "number" &&
    typeof location.lng === "number" &&
    Number.isInteger(body.limit) &&
    Array.isArray(body.candidates);
  if (!isValid || location === undefined || !Array.isArray(body.candidates)) {
    return badRequest(
      "ageMin, ageMax, gender, radiusKm, location, limit and candidates are required",
    );
  }
  const found: { userId: string; distanceKm: number }[] = [];
  for (const raw of body.candidates) {
    const candidate = checkProfile(raw, false);
    if (typeof candidate === "string") {
      return badRequest(candidate);
    }
    const km = distanceKm(
      { lat: location.lat as number, lon: location.lng as number },
      { lat: candidate.latitude, lon: candidate.longitude },
    );
    const isMatch =
      candidate.age >= (body.ageMin as number) &&
      candidate.age <= (body.ageMax as number) &&
      (wanted as string[]).includes(candidate.gender) &&
      km <= (body.radiusKm as number);
    if (isMatch) {
      found.push({ userId: candidate.userId, distanceKm: Math.round(km * 100) / 100 });
    }
  }
  found.sort((a, b) => a.distanceKm - b.distanceKm);
  return Response.json({
    candidates: found.slice(0, body.limit as number).map((item) => ({
      ...item,
      user_id: item.userId,
      distance_km: item.distanceKm,
    })),
  });
}

/**
 * Build a fake Match Engine.
 * @returns a fetch function to give the engine client, the requests it received, and a switch
 *   that makes it answer 502 like an engine that lost its backend
 */
export function createFakeEngine() {
  const calls: EngineCall[] = [];
  const state = { isDown: false };

  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ path: url.pathname, body });
    if (state.isDown) {
      throw new TypeError("fetch failed");
    }
    if (url.pathname === "/internal/v1/recommendations") {
      return recommend(body);
    }
    if (url.pathname === "/internal/v1/candidates/search") {
      return search(body);
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  return { fetch: fakeFetch, calls, state };
}

/**
 * Build the Match Service on the fake engine and in-memory profiles.
 * @param profiles - the users that exist, default the nine test users
 * @returns the service, the fake engine and the profile list (push to it to add users)
 */
export function createTestMatchService(profiles: MatchProfile[] = [...TEST_USERS]) {
  const engine = createFakeEngine();
  const service = createMatchService({
    profiles: createInMemoryMatchProfileReader(profiles),
    engine: createMatchEngineClient({
      baseUrl: "http://match-engine.test:8000",
      timeoutMs: 1000,
      fetch: engine.fetch,
    }),
    now: () => NOW,
  });
  return { service, engine, profiles };
}
