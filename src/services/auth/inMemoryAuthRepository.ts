/*
 * In-memory Auth repository. Unit tests use it. Data is lost when the process stops, so the
 * real app uses the Prisma version in src/data/prismaAuthRepository.ts.
 */
import type { AuthRepository, Credentials, NewRefreshToken } from "./authRepository";

interface StoredRefreshToken extends NewRefreshToken {
  revokedAt: Date | null;
}

/** An in-memory repository plus a way to add users, for tests. */
export interface InMemoryAuthRepository extends AuthRepository {
  /**
   * Add a user that can log in.
   * @param username - the username
   * @param credentials - the user ID and password hash
   */
  addUser(username: string, credentials: Credentials): void;

  /** @returns how many refresh tokens are stored and not cancelled */
  countActiveRefreshTokens(): number;
}

/**
 * Create an empty in-memory Auth repository.
 * @returns the repository
 */
export function createInMemoryAuthRepository(): InMemoryAuthRepository {
  const users = new Map<string, Credentials>();
  const tokens = new Map<string, StoredRefreshToken>();

  return {
    addUser(username, credentials) {
      users.set(username, credentials);
    },

    countActiveRefreshTokens() {
      return [...tokens.values()].filter((token) => token.revokedAt === null).length;
    },

    findCredentialsByUsername(username) {
      return Promise.resolve(users.get(username) ?? null);
    },

    insertRefreshToken(token) {
      tokens.set(token.tokenHash, { ...token, revokedAt: null });
      return Promise.resolve();
    },

    rotateRefreshToken(oldTokenHash, replacement, now) {
      const old = tokens.get(oldTokenHash);
      if (old?.revokedAt !== null || old.expiresAt <= now) {
        return Promise.resolve(null);
      }
      old.revokedAt = now;
      tokens.set(replacement.tokenHash, {
        userId: old.userId,
        tokenHash: replacement.tokenHash,
        expiresAt: replacement.expiresAt,
        revokedAt: null,
      });
      return Promise.resolve(old.userId);
    },

    revokeRefreshToken(userId, tokenHash, now) {
      const token = tokens.get(tokenHash);
      if (token?.userId === userId && token.revokedAt === null) {
        token.revokedAt = now;
      }
      return Promise.resolve();
    },

    revokeAllRefreshTokens(userId, now) {
      for (const token of tokens.values()) {
        if (token.userId === userId && token.revokedAt === null) {
          token.revokedAt = now;
        }
      }
      return Promise.resolve();
    },
  };
}
