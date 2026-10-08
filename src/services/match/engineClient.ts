/*
 * Match Engine client (the only place that knows the engine's packets). It sends the engine
 * exactly what the engine defines (docs/match-engine.md, dating-match-engine `app/models`):
 *
 *   POST /internal/v1/recommendations  { userId, limit, user, candidates }
 *     -> { candidates: [{ userId, matchScore (0 to 100), distanceKm }] }
 *   POST /internal/v1/candidates/search { ageMin, ageMax, gender, radiusKm, location, limit, candidates }
 *     -> { candidates: [{ userId, distanceKm }] }
 *
 * The answer may also use snake_case names, or a `results` list with `score` from 0 to 1 (the
 * format Vic and Tae talked about); both are accepted. Any failure becomes 500
 * MATCH_ENGINE_UNAVAILABLE. The base URL and the timeout come from the environment.
 */
import { ApiError, ERROR_CODES } from "../../plugins/errors";

const HTTP_INTERNAL_ERROR = 500;
const RECOMMENDATIONS_PATH = "/internal/v1/recommendations";
const SEARCH_PATH = "/internal/v1/candidates/search";
const MAX_SCORE = 100;
const UNAVAILABLE_MESSAGE = "The match service is not available right now. Please try again.";

/** A profile as the engine wants it. The age is whole years; the date of birth is never sent. */
export interface EngineProfile {
  userId: string;
  age: number;
  gender: string;
  latitude: number;
  longitude: number;
  targetPreference?: { ageMin: number; ageMax: number; gender: string[]; radiusKm: number };
}

/** The request for ranked recommendations. `user` must have its `targetPreference`. */
export interface RecommendInput {
  userId: string;
  limit: number;
  user: EngineProfile;
  candidates: EngineProfile[];
}

/** One recommended candidate. `score` is 0 to 100. */
export interface EngineRecommendation {
  userId: string;
  score: number;
  distanceKm: number | null;
}

/** The request for a search by specification. */
export interface SearchInput {
  ageMin: number;
  ageMax: number;
  genders: string[];
  radiusKm: number;
  location: { lat: number; lng: number };
  limit: number;
  candidates: EngineProfile[];
}

/** One search hit. `distanceKm` is measured from the search point. */
export interface EngineSearchHit {
  userId: string;
  distanceKm: number | null;
}

/** What the Match Service needs from the Match Engine. */
export interface MatchEngineClient {
  /**
   * Rank candidates for a user.
   * @param input - the user, the candidate pool and the largest number of results
   * @returns the candidates the engine found mutually eligible, best score first
   * @throws ApiError 500 MATCH_ENGINE_UNAVAILABLE on a network error, a timeout, a status
   *   outside 2xx or an answer of the wrong shape
   */
  recommend(input: RecommendInput): Promise<EngineRecommendation[]>;

  /**
   * Filter candidates by age, gender and distance from a point.
   * @param input - the criteria, the search point and the candidate pool
   * @returns the candidates that fit, nearest first
   * @throws ApiError 500 MATCH_ENGINE_UNAVAILABLE as for `recommend`
   */
  search(input: SearchInput): Promise<EngineSearchHit[]>;
}

/** Settings for createMatchEngineClient. `fetch` can be replaced in tests. */
export interface MatchEngineClientOptions {
  baseUrl: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

function unavailable(): ApiError {
  return new ApiError(HTTP_INTERNAL_ERROR, ERROR_CODES.matchEngineUnavailable, UNAVAILABLE_MESSAGE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(item: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = item[name];
    if (typeof value === "string" && value !== "") {
      return value;
    }
  }
  return undefined;
}

function readNumber(item: Record<string, unknown>, ...names: string[]): number | undefined {
  for (const name of names) {
    const value = item[name];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function readItems(body: unknown): Record<string, unknown>[] {
  if (!isRecord(body)) {
    throw unavailable();
  }
  const list = body.candidates ?? body.results;
  if (!Array.isArray(list) || !list.every(isRecord)) {
    throw unavailable();
  }
  return list;
}

function parseRecommendations(body: unknown): EngineRecommendation[] {
  return readItems(body).map((item) => {
    const userId = readText(item, "userId", "user_id");
    const matchScore = readNumber(item, "matchScore", "match_score");
    const unitScore = readNumber(item, "score");
    if (userId === undefined || (matchScore === undefined && unitScore === undefined)) {
      throw unavailable();
    }
    const score = matchScore ?? (unitScore as number) * MAX_SCORE;
    return {
      userId,
      score: Math.min(MAX_SCORE, Math.max(0, score)),
      distanceKm: readNumber(item, "distanceKm", "distance_km") ?? null,
    };
  });
}

function parseSearchHits(body: unknown): EngineSearchHit[] {
  return readItems(body).map((item) => {
    const userId = readText(item, "userId", "user_id");
    if (userId === undefined) {
      throw unavailable();
    }
    return { userId, distanceKm: readNumber(item, "distanceKm", "distance_km") ?? null };
  });
}

/**
 * Create the Match Engine client.
 * @param options - engine base URL, timeout in milliseconds and an optional fetch function
 * @returns the client
 */
export function createMatchEngineClient(options: MatchEngineClientOptions): MatchEngineClient {
  const fetchFn = options.fetch ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");

  async function post(path: string, body: unknown): Promise<unknown> {
    try {
      const response = await fetchFn(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`Match Engine answered ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error("Match Engine request failed:", error);
      throw unavailable();
    }
  }

  return {
    async recommend(input) {
      return parseRecommendations(await post(RECOMMENDATIONS_PATH, input));
    },

    async search(input) {
      const { genders, location, ...rest } = input;
      return parseSearchHits(await post(SEARCH_PATH, { ...rest, gender: genders, location }));
    },
  };
}
