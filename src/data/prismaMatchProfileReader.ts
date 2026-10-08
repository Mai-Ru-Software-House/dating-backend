/*
 * Prisma version of the Match profile reader (Data Access Layer, owner: Chuan; written by Vic
 * as a proposal). Reads users, their target preferences and target genders from PostgreSQL.
 * Every user in Chuan's schema has a location and preferences, so every user can be a candidate.
 */
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import type { MatchProfile, MatchProfileReader } from "../services/match/matchTypes";

/**
 * Turn the RustFS object key of a profile photo into the `photoId` of the API. Proposal: the key
 * is `profile-photos/<photoId>.<extension>`, so the ID is the file name without the extension.
 * @param photoKey - the object key stored in `users.photo_key`
 * @returns the photo ID
 */
export function photoIdFromKey(photoKey: string): string {
  const fileName = photoKey.slice(photoKey.lastIndexOf("/") + 1);
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const profileInclude = { targetGenders: { select: { genderCode: true } } } as const;

type UserWithTargets = Prisma.UserGetPayload<{ include: typeof profileInclude }>;

function toProfile(user: UserWithTargets): MatchProfile {
  return {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    photoId: photoIdFromKey(user.photoKey),
    gender: user.genderCode,
    dateOfBirth: user.dateOfBirth,
    latitude: user.latitude,
    longitude: user.longitude,
    placeName: user.placeName === null || user.placeName === "" ? null : user.placeName,
    preference: {
      ageMin: user.targetMinAge,
      ageMax: user.targetMaxAge,
      genders: user.targetGenders.map((target) => target.genderCode),
      radiusKm: user.targetRadiusKm,
    },
  };
}

/**
 * Create the Match profile reader on PostgreSQL.
 * @param prisma - the Prisma client from `createPrismaClient`
 * @returns the reader
 */
export function createPrismaMatchProfileReader(prisma: PrismaClient): MatchProfileReader {
  return {
    async findProfile(userId) {
      // The database rejects text that is not a UUID, so such an ID is simply "not found".
      if (!UUID_PATTERN.test(userId)) {
        return null;
      }
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: profileInclude,
      });
      return user === null ? null : toProfile(user);
    },

    async listPool(excludeUserId, limit) {
      const users = await prisma.user.findMany({
        where: { id: { not: excludeUserId } },
        include: profileInclude,
        orderBy: { id: "asc" },
        take: limit,
      });
      return users.map(toProfile);
    },
  };
}
