/*
 * The match score shown on a candidate profile (`GET /users/{userId}`). It uses the Match
 * Engine client and the mutual rule of the Match Service (Vic), without changing them: when the
 * two users fit each other both ways, the engine scores the one candidate; otherwise the score
 * is 0 and the engine is not called, as for an empty recommendation list.
 */
import type { EngineProfile, MatchEngineClient } from "../match/engineClient";
import type { MatchProfile } from "../match/matchTypes";
import { ageOn, keepMutualCandidates } from "../match/mutualRule";

/** The score of two users who do not fit each other both ways (or a user and themselves). */
export const NO_MATCH_SCORE = 0;
const ONE_CANDIDATE = 1;

/** Scores one candidate for the logged in user. */
export interface MatchScorer {
  /**
   * @param viewer - the logged in user
   * @param candidate - the user whose profile is shown
   * @returns a whole number from 0 to 100; 0 when they do not fit each other both ways
   * @throws ApiError 500 MATCH_ENGINE_UNAVAILABLE when the engine fails or times out
   */
  scoreCandidate(viewer: MatchProfile, candidate: MatchProfile): Promise<number>;
}

/** Parts the scorer needs. `now` is replaceable in tests. */
export interface EngineMatchScorerOptions {
  engine: MatchEngineClient;
  now?: () => Date;
}

// The same packet as the Match Service sends (its own helper is not exported).
function toEngineProfile(profile: MatchProfile, age: number): EngineProfile {
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

/**
 * Create the scorer on the Match Engine.
 * @param options - the engine client and an optional clock
 * @returns the scorer
 */
export function createEngineMatchScorer(options: EngineMatchScorerOptions): MatchScorer {
  const now = options.now ?? (() => new Date());

  return {
    async scoreCandidate(viewer, candidate) {
      const moment = now();
      const [entry] = keepMutualCandidates(viewer, [candidate], moment);
      if (entry === undefined) {
        return NO_MATCH_SCORE;
      }
      const hits = await options.engine.recommend({
        userId: viewer.userId,
        limit: ONE_CANDIDATE,
        user: toEngineProfile(viewer, ageOn(viewer.dateOfBirth, moment)),
        candidates: [toEngineProfile(candidate, entry.age)],
      });
      const hit = hits.find((item) => item.userId === candidate.userId);
      return hit === undefined ? NO_MATCH_SCORE : Math.round(hit.score);
    },
  };
}
