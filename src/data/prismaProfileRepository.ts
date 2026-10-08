/*
 * Prisma version of the Profile repository (Data Access Layer, owner: Chuan). Sign up writes
 * `users`, `user_auth_methods` and `user_target_genders` in one transaction; Edit Profile
 * updates `users` and replaces the target genders in one transaction. A taken username or
 * photo key (Prisma P2002) is an answer, not an error.
 */
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import type {
  ProfileChanges,
  ProfileRepository,
  StoredProfile,
} from "../services/profile/profileRepository";
import type { Preferences } from "../services/profile/profileTypes";
import { isUuid } from "./ids";
import { photoIdFromKey } from "./photoKey";
import { brokenUniqueIndex, UNIQUE_INDEXES } from "./prismaErrors";

const PASSWORD_AUTH_TYPE = "password";
/** Interactive transactions stop after 5 s by default; the remote dev database needs longer. */
const TRANSACTION_TIMEOUT_MS = 15_000;

const profileInclude = {
  targetGenders: { select: { genderCode: true }, orderBy: { genderCode: "asc" } },
} as const;

type UserWithTargets = Prisma.UserGetPayload<{ include: typeof profileInclude }>;

function toStoredProfile(user: UserWithTargets): StoredProfile {
  return {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    dateOfBirth: user.dateOfBirth,
    gender: user.genderCode,
    latitude: user.latitude,
    longitude: user.longitude,
    placeName: user.placeName === null || user.placeName === "" ? null : user.placeName,
    photoId: photoIdFromKey(user.photoKey),
    preferences: {
      minAge: user.targetMinAge,
      maxAge: user.targetMaxAge,
      targetGenders: user.targetGenders.map((target) => target.genderCode),
      radiusKm: user.targetRadiusKm,
    },
  };
}

function targetGenderRows(userId: string, preferences: Preferences) {
  return preferences.targetGenders.map((genderCode) => ({ userId, genderCode }));
}

function toUserChanges(changes: ProfileChanges): Prisma.UserUncheckedUpdateManyInput {
  return {
    displayName: changes.displayName,
    dateOfBirth: changes.dateOfBirth,
    genderCode: changes.gender,
    latitude: changes.location?.latitude,
    longitude: changes.location?.longitude,
    // `null` clears the old name; `undefined` (no new location) keeps it.
    placeName: changes.location === undefined ? undefined : changes.location.placeName,
    targetMinAge: changes.preferences?.minAge,
    targetMaxAge: changes.preferences?.maxAge,
    targetRadiusKm: changes.preferences?.radiusKm,
  };
}

/**
 * Create the Profile repository on PostgreSQL.
 * @param prisma - the Prisma client from `createPrismaClient`
 * @returns the repository
 */
export function createPrismaProfileRepository(prisma: PrismaClient): ProfileRepository {
  return {
    async listGenderCodes() {
      const genders = await prisma.gender.findMany({
        select: { code: true },
        orderBy: { code: "asc" },
      });
      return genders.map((gender) => gender.code);
    },

    async isUsernameTaken(username) {
      const user = await prisma.user.findUnique({ where: { username }, select: { id: true } });
      return user !== null;
    },

    async createProfile(profile) {
      try {
        const created = await prisma.$transaction(
          async (tx) => {
            const user = await tx.user.create({
              data: {
                username: profile.username,
                displayName: profile.displayName,
                dateOfBirth: profile.dateOfBirth,
                genderCode: profile.gender,
                photoKey: profile.photoKey,
                latitude: profile.latitude,
                longitude: profile.longitude,
                placeName: profile.placeName,
                targetMinAge: profile.preferences.minAge,
                targetMaxAge: profile.preferences.maxAge,
                targetRadiusKm: profile.preferences.radiusKm,
              },
              select: { id: true },
            });
            await tx.userAuthMethod.create({
              data: {
                userId: user.id,
                authType: PASSWORD_AUTH_TYPE,
                passwordHash: profile.passwordHash,
              },
            });
            await tx.userTargetGender.createMany({
              data: targetGenderRows(user.id, profile.preferences),
            });
            return tx.user.findUniqueOrThrow({ where: { id: user.id }, include: profileInclude });
          },
          { timeout: TRANSACTION_TIMEOUT_MS },
        );
        return { status: "created", profile: toStoredProfile(created) };
      } catch (error) {
        const index = brokenUniqueIndex(error);
        if (index === UNIQUE_INDEXES.username) {
          return { status: "usernameTaken" };
        }
        if (index === UNIQUE_INDEXES.photoKey) {
          return { status: "photoKeyTaken" };
        }
        throw error;
      }
    },

    async findProfileById(userId) {
      // The database rejects text that is not a UUID, so such an ID is simply "not found".
      if (!isUuid(userId)) {
        return null;
      }
      const user = await prisma.user.findUnique({ where: { id: userId }, include: profileInclude });
      return user === null ? null : toStoredProfile(user);
    },

    async updateProfile(userId, changes) {
      if (!isUuid(userId)) {
        return null;
      }
      const updated = await prisma.$transaction(
        async (tx) => {
          // The conditional update also tells whether the user exists (count 0 or 1).
          const { count } = await tx.user.updateMany({
            where: { id: userId },
            data: toUserChanges(changes),
          });
          if (count === 0) {
            return null;
          }
          if (changes.preferences !== undefined) {
            await tx.userTargetGender.deleteMany({ where: { userId } });
            await tx.userTargetGender.createMany({
              data: targetGenderRows(userId, changes.preferences),
            });
          }
          return tx.user.findUniqueOrThrow({ where: { id: userId }, include: profileInclude });
        },
        { timeout: TRANSACTION_TIMEOUT_MS },
      );
      return updated === null ? null : toStoredProfile(updated);
    },
  };
}
