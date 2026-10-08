/*
 * Auth Service: login, token refresh, logout and the session check used by every protected
 * route. Passwords are checked with Argon2id. Access tokens are JWTs checked by signature
 * only. Refresh tokens are random, stored as hashes and rotated on every use.
 */
import { ApiError, ERROR_CODES } from "../../plugins/errors";
import type { AuthRepository } from "./authRepository";
import type { PasswordHasher } from "./passwordHasher";
import type { SessionValidator } from "./sessionValidator";
import type { TokenService } from "./tokens";

const HTTP_UNAUTHORIZED = 401;
const MS_PER_DAY = 86_400_000;
const DECOY_PASSWORD = "decoy password for unknown usernames";

/** The two tokens the app stores after login, sign up or refresh. */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Parts the Auth Service needs. `now` is replaceable in tests. */
export interface AuthServiceOptions {
  repository: AuthRepository;
  hasher: PasswordHasher;
  tokens: TokenService;
  /** How long a refresh token is valid, in days. */
  refreshTtlDays: number;
  now?: () => Date;
}

/** What the rest of the backend can ask of the Auth Service. */
export interface AuthService {
  /**
   * Log a user in.
   * @param username - the username, in any letter case
   * @param password - the plain password
   * @returns a new access token and refresh token
   * @throws ApiError 401 INVALID_CREDENTIALS for an unknown username or a wrong password (the
   *   same answer for both)
   */
  login(username: string, password: string): Promise<TokenPair>;

  /**
   * Swap a refresh token for a new pair. The old refresh token stops working.
   * @param refreshToken - the refresh token the app holds
   * @returns a new access token and refresh token
   * @throws ApiError 401 UNAUTHENTICATED when the token is unknown, expired, used or cancelled
   */
  refresh(refreshToken: string): Promise<TokenPair>;

  /**
   * Log out: cancel a refresh token, or every refresh token of the user when none is given.
   * The access token keeps working until it expires.
   * @param userId - the logged in user
   * @param refreshToken - the token to cancel; ignored if it belongs to someone else
   */
  logout(userId: string, refreshToken?: string): Promise<void>;

  /**
   * Create a token pair for a user who just signed up.
   * @param userId - the new user
   * @returns a new access token and refresh token
   */
  issueTokens(userId: string): Promise<TokenPair>;

  /** The session check the REST API Layer calls with the access token of each request. */
  validateSession: SessionValidator;
}

/**
 * Create the Auth Service.
 * @param options - repository, hasher, token service and refresh token life
 * @returns the Auth Service
 */
export function createAuthService(options: AuthServiceOptions): AuthService {
  const { repository, hasher, tokens } = options;
  const now = options.now ?? (() => new Date());
  let decoyHash: Promise<string> | undefined;

  function refreshExpiry(): Date {
    return new Date(now().getTime() + options.refreshTtlDays * MS_PER_DAY);
  }

  // Checking a password against a decoy hash takes as long as a real check, so the answer for
  // an unknown username is not faster than the answer for a wrong password.
  async function checkDecoyPassword(password: string): Promise<void> {
    decoyHash ??= hasher.hash(DECOY_PASSWORD);
    await hasher.verify(password, await decoyHash);
  }

  async function issueTokens(userId: string): Promise<TokenPair> {
    const refreshToken = tokens.createRefreshToken();
    await repository.insertRefreshToken({
      userId,
      tokenHash: tokens.hashRefreshToken(refreshToken),
      expiresAt: refreshExpiry(),
    });
    return { accessToken: await tokens.signAccessToken(userId), refreshToken };
  }

  return {
    issueTokens,

    async login(username, password) {
      // Usernames are stored in lowercase, so "Alice" and "alice" are the same user.
      const credentials = await repository.findCredentialsByUsername(username.toLowerCase());
      if (credentials === null) {
        await checkDecoyPassword(password);
      }
      const isValid =
        credentials !== null && (await hasher.verify(password, credentials.passwordHash));
      if (credentials === null || !isValid) {
        throw new ApiError(
          HTTP_UNAUTHORIZED,
          ERROR_CODES.invalidCredentials,
          "The username or password is not correct.",
        );
      }
      return issueTokens(credentials.userId);
    },

    async refresh(refreshToken) {
      const replacement = tokens.createRefreshToken();
      const userId = await repository.rotateRefreshToken(
        tokens.hashRefreshToken(refreshToken),
        { tokenHash: tokens.hashRefreshToken(replacement), expiresAt: refreshExpiry() },
        now(),
      );
      if (userId === null) {
        throw new ApiError(
          HTTP_UNAUTHORIZED,
          ERROR_CODES.unauthenticated,
          "Your session has ended. Please log in again.",
        );
      }
      return { accessToken: await tokens.signAccessToken(userId), refreshToken: replacement };
    },

    async logout(userId, refreshToken) {
      if (refreshToken === undefined) {
        await repository.revokeAllRefreshTokens(userId, now());
        return;
      }
      await repository.revokeRefreshToken(userId, tokens.hashRefreshToken(refreshToken), now());
    },

    async validateSession(token) {
      const userId = await tokens.verifyAccessToken(token);
      return userId === null ? null : { userId };
    },
  };
}
