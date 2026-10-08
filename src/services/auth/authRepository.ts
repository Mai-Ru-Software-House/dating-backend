/*
 * What the Auth Service needs from the Data Access Layer (Chuan). The in-memory version is in
 * inMemoryAuthRepository.ts and the Prisma version in src/data/prismaAuthRepository.ts.
 */

/** What login needs to know about a user. */
export interface Credentials {
  userId: string;
  passwordHash: string;
}

/** A refresh token to store. Only the hash is kept, never the token itself. */
export interface NewRefreshToken {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

/** Reads credentials and stores refresh tokens. */
export interface AuthRepository {
  /**
   * @param username - the username to look up, already in lowercase (as stored)
   * @returns the user ID and password hash, or null when no user has that username
   */
  findCredentialsByUsername(username: string): Promise<Credentials | null>;

  /**
   * Store a new refresh token.
   * @param token - the user, the token hash and when it expires
   */
  insertRefreshToken(token: NewRefreshToken): Promise<void>;

  /**
   * Cancel a refresh token and store its replacement in one step. Two requests with the same
   * token at the same time must not both succeed.
   * @param oldTokenHash - hash of the token the app sent
   * @param replacement - the new token to store for the same user
   * @param now - the current time, used for the expiry check and the cancel time
   * @returns the user ID, or null if the old token is unknown, expired or already cancelled
   *   (nothing is stored then)
   */
  rotateRefreshToken(
    oldTokenHash: string,
    replacement: Omit<NewRefreshToken, "userId">,
    now: Date,
  ): Promise<string | null>;

  /**
   * Cancel one refresh token of a user. Does nothing for an unknown token or another user's token.
   * @param userId - the logged in user
   * @param tokenHash - hash of the token to cancel
   * @param now - the cancel time
   */
  revokeRefreshToken(userId: string, tokenHash: string, now: Date): Promise<void>;

  /**
   * Cancel every active refresh token of a user.
   * @param userId - the logged in user
   * @param now - the cancel time
   */
  revokeAllRefreshTokens(userId: string, now: Date): Promise<void>;
}
