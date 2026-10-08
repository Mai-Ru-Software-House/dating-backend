/*
 * Match Service types: the profile data the service needs from the Data Access Layer, and the
 * cards it sends to the app (`CandidateCard` in docs/api-contract.md).
 */

/** What a user wants to see: the target age range, genders and distance. */
export interface MatchPreference {
  ageMin: number;
  ageMax: number;
  /** Gender codes the user wants to see, for example `["male", "non_binary"]`. */
  genders: string[];
  radiusKm: number;
}

/** A user as the Match Service needs them: card data, exact location and preferences. */
export interface MatchProfile {
  userId: string;
  username: string;
  displayName: string;
  photoId: string;
  /** Gender code, for example `female`. */
  gender: string;
  /** Date of birth. Only the UTC date counts. Never sent to the app or to the engine. */
  dateOfBirth: Date;
  latitude: number;
  longitude: number;
  placeName: string | null;
  preference: MatchPreference;
}

/** A user shown in Find Matches (`CandidateCard` in the contract, plus `username`). */
export interface CandidateCard {
  userId: string;
  username: string;
  displayName: string;
  photoId: string;
  age: number;
  gender: string;
  placeName: string | null;
  /** Whole km, at least 1. */
  distanceKm: number;
  /** 0 to 100. Only in recommendations. */
  matchScore?: number;
}

/** Reads the profile data for matching. Proposed, Chuan to confirm. */
export interface MatchProfileReader {
  /**
   * @param userId - the user to look up
   * @returns the user's profile, or null when the user does not exist or has no location or
   *   preferences
   */
  findProfile(userId: string): Promise<MatchProfile | null>;

  /**
   * List the users who could be shown to someone: every user with a location and preferences,
   * except `excludeUserId`.
   * @param excludeUserId - the user who asks, never part of the answer
   * @param limit - the largest number of profiles to return
   * @returns up to `limit` profiles, in any order
   */
  listPool(excludeUserId: string, limit: number): Promise<MatchProfile[]>;
}
