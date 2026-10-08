/*
 * Prisma version of the profile photo repository (Data Access Layer, owner: Chuan, for the
 * Photo functions of Tae). Reads and replaces `users.photo_key`, which has a unique index.
 */
import type { PrismaClient } from "../generated/prisma/client";
import type { ProfilePhotoRepository } from "../services/photo/profilePhotoRepository";
import { isUuid } from "./ids";
import { possibleProfilePhotoKeys } from "./photoKey";

/**
 * Create the profile photo repository on PostgreSQL.
 * @param prisma - the Prisma client from `createPrismaClient`
 * @returns the repository
 */
export function createPrismaProfilePhotoRepository(prisma: PrismaClient): ProfilePhotoRepository {
  return {
    async findPhotoKeyByPhotoId(photoId) {
      if (!isUuid(photoId)) {
        return null;
      }
      // Four exact keys (one per allowed extension): an index lookup, never a LIKE scan.
      const user = await prisma.user.findFirst({
        where: { photoKey: { in: possibleProfilePhotoKeys(photoId) } },
        select: { photoKey: true },
      });
      return user?.photoKey ?? null;
    },

    async replacePhotoKey(userId, newPhotoKey) {
      if (!isUuid(userId)) {
        return null;
      }
      // One statement: the subquery locks the row (FOR UPDATE) and keeps its old key, so a
      // second replace at the same time waits and then gets the key the first one stored.
      const rows = await prisma.$queryRaw<{ oldPhotoKey: string }[]>`
        UPDATE users AS u
        SET photo_key = ${newPhotoKey}, updated_at = CURRENT_TIMESTAMP
        FROM (SELECT id, photo_key FROM users WHERE id = ${userId}::uuid FOR UPDATE) AS old
        WHERE u.id = old.id
        RETURNING old.photo_key AS "oldPhotoKey"`;
      return rows[0]?.oldPhotoKey ?? null;
    },
  };
}
