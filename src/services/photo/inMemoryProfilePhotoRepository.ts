/*
 * In-memory profile photo repository (Chuan, for the Photo functions of Tae). Unit tests use
 * it; the real app uses the Prisma version in src/data/prismaProfilePhotoRepository.ts.
 */
import { possibleProfilePhotoKeys } from "../../data/photoKey";
import type { ProfilePhotoRepository } from "./profilePhotoRepository";

/**
 * Create an in-memory profile photo repository.
 * @param users - the users that exist, with their photo keys
 * @returns the repository
 */
export function createInMemoryProfilePhotoRepository(
  users: { userId: string; photoKey: string }[] = [],
): ProfilePhotoRepository {
  const photoKeys = new Map(users.map((user) => [user.userId, user.photoKey]));

  return {
    async findPhotoKeyByPhotoId(photoId) {
      const wanted = new Set(possibleProfilePhotoKeys(photoId));
      return [...photoKeys.values()].find((key) => wanted.has(key)) ?? null;
    },

    async replacePhotoKey(userId, newPhotoKey) {
      const oldPhotoKey = photoKeys.get(userId);
      if (oldPhotoKey === undefined) {
        return null;
      }
      photoKeys.set(userId, newPhotoKey);
      return oldPhotoKey;
    },
  };
}
