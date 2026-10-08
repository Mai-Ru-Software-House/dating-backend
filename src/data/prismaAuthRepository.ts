/*
 * Prisma version of the Auth repository (Data Access Layer, owner: Chuan). Reads the password
 * hash from `user_auth_methods` and keeps hashed refresh tokens in `refresh_tokens`.
 */
import type { AuthRepository } from "../services/auth/authRepository";
import type { PrismaClient } from "../generated/prisma/client";

const PASSWORD_AUTH_TYPE = "password";

/**
 * Create the Auth repository on PostgreSQL.
 * @param prisma - the Prisma client from `createPrismaClient`
 * @returns the repository
 */
export function createPrismaAuthRepository(prisma: PrismaClient): AuthRepository {
  return {
    async findCredentialsByUsername(username) {
      const method = await prisma.userAuthMethod.findFirst({
        where: { authType: PASSWORD_AUTH_TYPE, passwordHash: { not: null }, user: { username } },
        select: { userId: true, passwordHash: true },
      });
      if (method === null || method.passwordHash === null) {
        return null;
      }
      return { userId: method.userId, passwordHash: method.passwordHash };
    },

    async insertRefreshToken(token) {
      await prisma.refreshToken.create({ data: token });
    },

    async rotateRefreshToken(oldTokenHash, replacement, now) {
      return prisma.$transaction(async (tx) => {
        const old = await tx.refreshToken.findUnique({ where: { tokenHash: oldTokenHash } });
        if (old === null) {
          return null;
        }
        // The conditional update is the lock: of two requests with the same token, only one
        // sees a count of 1.
        const cancelled = await tx.refreshToken.updateMany({
          where: { id: old.id, revokedAt: null, expiresAt: { gt: now } },
          data: { revokedAt: now },
        });
        if (cancelled.count !== 1) {
          return null;
        }
        await tx.refreshToken.create({ data: { userId: old.userId, ...replacement } });
        return old.userId;
      });
    },

    async revokeRefreshToken(userId, tokenHash, now) {
      await prisma.refreshToken.updateMany({
        where: { userId, tokenHash, revokedAt: null },
        data: { revokedAt: now },
      });
    },

    async revokeAllRefreshTokens(userId, now) {
      await prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
    },
  };
}
