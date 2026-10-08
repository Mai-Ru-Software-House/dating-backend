/*
 * In-memory profile reader for the Match Service. Tests use it, and the app uses it until the
 * Data Access Layer (Chuan) provides the real reader. Data is lost when the server stops.
 */
import type { MatchProfile, MatchProfileReader } from "./matchTypes";

/**
 * Create a profile reader from a fixed list.
 * @param profiles - the users that exist
 * @returns a reader; `listPool` leaves out the user who asks and honours the limit
 */
export function createInMemoryMatchProfileReader(
  profiles: MatchProfile[] = [],
): MatchProfileReader {
  return {
    async findProfile(userId) {
      return profiles.find((profile) => profile.userId === userId) ?? null;
    },

    async listPool(excludeUserId, limit) {
      return profiles.filter((profile) => profile.userId !== excludeUserId).slice(0, limit);
    },
  };
}
