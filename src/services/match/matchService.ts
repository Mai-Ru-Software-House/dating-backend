/*
 * Match Service: recommendations and search by specification (docs/api-contract.md, Matching
 * section). The service reads the profiles, keeps the candidates that fit both ways (mutual
 * rule, test plan A11), pushes the pool to the Match Engine in one request, and turns the engine's
 * answer into cards. The engine never reads our database.
 */
import { ApiError, ERROR_CODES } from "../../plugins/errors";
import { distanceKm, roundDistanceKm } from "../location/distance";
import type { EngineProfile, MatchEngineClient } from "./engineClient";
import type { CandidateCard, MatchProfile, MatchProfileReader } from "./matchTypes";
import {
  ageOn,
  keepCandidatesWhoWantUser,
  keepMutualCandidates,
  type PoolEntry,
} from "./mutualRule";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const MIN_AGE = 18;
const MIN_LIMIT = 1;
export const MAX_LIMIT = 50;
export const DEFAULT_RECOMMENDATION_LIMIT = 10;
export const DEFAULT_SEARCH_LIMIT = 20;
/** The most results the engine is asked for in one request (offset + limit + 1 for `hasMore`). */
export const MAX_RECOMMENDATION_WINDOW = 200;
/** The most profiles sent to the engine in one request. */
export const MAX_POOL_SIZE = 2000;
const MIN_LATITUDE = -90;
const MAX_LATITUDE = 90;
const MIN_LONGITUDE = -180;
const MAX_LONGITUDE = 180;

/** The query of `GET /recommendations`. */
export interface RecommendationQuery {
  limit?: number;
  offset?: number;
}

/** The query of `GET /candidates`. Every value is optional. */
export interface SearchQuery {
  minAge?: number;
  maxAge?: number;
  targetGenders?: string[];
  maxDistanceKm?: number;
  lat?: number;
  lon?: number;
  limit?: number;
}

/** What the routes call. */
export interface MatchService {
  /**
   * List the users who fit the logged in user both ways, best match first.
   * @param userId - the logged in user
   * @param query - page size (1 to 50, default 10) and the number of cards already shown
   * @returns one page of cards with `matchScore`, and whether more exist
   * @throws ApiError 400 INVALID_INPUT (field `limit` or `offset`) for a value out of range
   * @throws ApiError 404 USER_NOT_FOUND when the user has no profile
   * @throws ApiError 500 MATCH_ENGINE_UNAVAILABLE when the engine fails or times out
   */
  getRecommendations(
    userId: string,
    query: RecommendationQuery,
  ): Promise<{ recommendations: CandidateCard[]; hasMore: boolean }>;

  /**
   * Search users by specification. A missing value uses the logged in user's own preference or
   * location. Only users whose own preferences accept the logged in user are returned.
   * @param userId - the logged in user
   * @param query - the search values
   * @returns cards without `matchScore`, nearest to the search point first
   * @throws ApiError 400 INVALID_INPUT (with `field`) when a value breaks its rule
   * @throws ApiError 404 USER_NOT_FOUND when the user has no profile
   * @throws ApiError 500 MATCH_ENGINE_UNAVAILABLE when the engine fails or times out
   */
  searchCandidates(userId: string, query: SearchQuery): Promise<{ candidates: CandidateCard[] }>;
}

/** Parts the service needs. `now` is replaceable in tests. */
export interface MatchServiceOptions {
  profiles: MatchProfileReader;
  engine: MatchEngineClient;
  now?: () => Date;
}

function invalidInput(field: string, message: string): ApiError {
  return new ApiError(HTTP_BAD_REQUEST, ERROR_CODES.invalidInput, message, field);
}

function assertWholeNumberInRange(field: string, value: number, min: number, max: number): number {
  // Written so that NaN also fails.
  if (!(Number.isInteger(value) && value >= min && value <= max)) {
    throw invalidInput(field, `${field} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

function toEngineProfile(entry: { profile: MatchProfile; age: number }): EngineProfile {
  const { profile, age } = entry;
  return {
    userId: profile.userId,
    age,
    gender: profile.gender,
    latitude: profile.latitude,
    longitude: profile.longitude,
    targetPreference: {
      ageMin: profile.preference.ageMin,
      ageMax: profile.preference.ageMax,
      gender: profile.preference.genders,
      radiusKm: profile.preference.radiusKm,
    },
  };
}

function toCard(entry: PoolEntry, kmFromPoint: number, matchScore?: number): CandidateCard {
  const { profile, age } = entry;
  const card: CandidateCard = {
    userId: profile.userId,
    username: profile.username,
    displayName: profile.displayName,
    photoId: profile.photoId,
    age,
    gender: profile.gender,
    placeName: profile.placeName,
    distanceKm: roundDistanceKm(kmFromPoint),
  };
  if (matchScore !== undefined) {
    card.matchScore = matchScore;
  }
  return card;
}

/**
 * Create the Match Service.
 * @param options - profile reader, engine client and an optional clock
 * @returns the service
 */
export function createMatchService(options: MatchServiceOptions): MatchService {
  const { profiles, engine } = options;
  const now = options.now ?? (() => new Date());

  async function loadUser(userId: string): Promise<MatchProfile> {
    const user = await profiles.findProfile(userId);
    if (user === null) {
      throw new ApiError(HTTP_NOT_FOUND, ERROR_CODES.userNotFound, "That user does not exist.");
    }
    return user;
  }

  function resolveSearchPoint(
    user: MatchProfile,
    query: SearchQuery,
  ): { lat: number; lon: number } {
    if ((query.lat === undefined) !== (query.lon === undefined)) {
      throw invalidInput(
        query.lat === undefined ? "lat" : "lon",
        "Send both lat and lon, or neither.",
      );
    }
    const lat = query.lat ?? user.latitude;
    const lon = query.lon ?? user.longitude;
    if (!(lat >= MIN_LATITUDE && lat <= MAX_LATITUDE)) {
      throw invalidInput("lat", `lat must be a number from ${MIN_LATITUDE} to ${MAX_LATITUDE}.`);
    }
    if (!(lon >= MIN_LONGITUDE && lon <= MAX_LONGITUDE)) {
      throw invalidInput("lon", `lon must be a number from ${MIN_LONGITUDE} to ${MAX_LONGITUDE}.`);
    }
    return { lat, lon };
  }

  function resolveAgeRange(
    user: MatchProfile,
    query: SearchQuery,
  ): { ageMin: number; ageMax: number } {
    const ageMin = query.minAge ?? user.preference.ageMin;
    const ageMax = query.maxAge ?? user.preference.ageMax;
    if (!Number.isInteger(ageMin)) {
      throw invalidInput("minAge", "minAge must be a whole number.");
    }
    if (!Number.isInteger(ageMax)) {
      throw invalidInput("maxAge", "maxAge must be a whole number.");
    }
    if (ageMin < MIN_AGE) {
      throw invalidInput("minAge", `The minimum age is ${MIN_AGE}.`);
    }
    if (ageMin > ageMax) {
      throw invalidInput(
        "minAge",
        "The age range is not valid: the minimum age cannot be above the maximum age.",
      );
    }
    return { ageMin, ageMax };
  }

  return {
    async getRecommendations(userId, query) {
      const limit = assertWholeNumberInRange(
        "limit",
        query.limit ?? DEFAULT_RECOMMENDATION_LIMIT,
        MIN_LIMIT,
        MAX_LIMIT,
      );
      const offset = assertWholeNumberInRange(
        "offset",
        query.offset ?? 0,
        0,
        MAX_RECOMMENDATION_WINDOW - limit,
      );
      const user = await loadUser(userId);
      const moment = now();
      const entries = keepMutualCandidates(
        user,
        await profiles.listPool(userId, MAX_POOL_SIZE),
        moment,
      );
      if (entries.length === 0) {
        return { recommendations: [], hasMore: false };
      }

      // One extra result tells whether another page exists.
      const wanted = offset + limit + 1;
      const hits = await engine.recommend({
        userId,
        limit: wanted,
        user: toEngineProfile({ profile: user, age: ageOn(user.dateOfBirth, moment) }),
        candidates: entries.map(toEngineProfile),
      });

      const byId = new Map(entries.map((entry) => [entry.profile.userId, entry]));
      const seen = new Set<string>();
      const ranked: { entry: PoolEntry; score: number }[] = [];
      for (const hit of hits) {
        const entry = byId.get(hit.userId);
        if (entry !== undefined && !seen.has(hit.userId)) {
          seen.add(hit.userId);
          ranked.push({ entry, score: hit.score });
        }
      }
      ranked.sort((a, b) => b.score - a.score);

      const page = ranked.slice(offset, offset + limit);
      return {
        recommendations: page.map(({ entry, score }) =>
          toCard(entry, entry.distanceKm, Math.round(score)),
        ),
        hasMore: ranked.length > offset + limit,
      };
    },

    async searchCandidates(userId, query) {
      const limit = assertWholeNumberInRange(
        "limit",
        query.limit ?? DEFAULT_SEARCH_LIMIT,
        MIN_LIMIT,
        MAX_LIMIT,
      );
      const user = await loadUser(userId);
      const { ageMin, ageMax } = resolveAgeRange(user, query);
      const radiusKm = query.maxDistanceKm ?? user.preference.radiusKm;
      if (!(radiusKm > 0)) {
        throw invalidInput("maxDistanceKm", "maxDistanceKm must be a number above 0.");
      }
      const genders = query.targetGenders ?? user.preference.genders;
      if (genders.length === 0) {
        throw invalidInput("targetGenders", "Choose at least one gender.");
      }
      const point = resolveSearchPoint(user, query);

      const moment = now();
      const entries = keepCandidatesWhoWantUser(
        user,
        await profiles.listPool(userId, MAX_POOL_SIZE),
        moment,
      );
      if (entries.length === 0) {
        return { candidates: [] };
      }

      const hits = await engine.search({
        ageMin,
        ageMax,
        genders,
        radiusKm,
        location: { lat: point.lat, lng: point.lon },
        limit,
        candidates: entries.map(toEngineProfile),
      });

      const byId = new Map(entries.map((entry) => [entry.profile.userId, entry]));
      const seen = new Set<string>();
      const found: { entry: PoolEntry; km: number }[] = [];
      for (const hit of hits) {
        const entry = byId.get(hit.userId);
        if (entry !== undefined && !seen.has(hit.userId)) {
          seen.add(hit.userId);
          const km =
            hit.distanceKm ??
            distanceKm(point, { lat: entry.profile.latitude, lon: entry.profile.longitude });
          found.push({ entry, km });
        }
      }
      found.sort((a, b) => a.km - b.km);
      return { candidates: found.slice(0, limit).map(({ entry, km }) => toCard(entry, km)) };
    },
  };
}
