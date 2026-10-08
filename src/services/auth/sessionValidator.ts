/*
 * Session check contract: what the REST API Layer needs from the Auth Service to check an access
 * token. The Auth Service (authService.ts) provides the implementation.
 */

/** The logged in user a valid session belongs to. */
export interface Session {
  userId: string;
}

/**
 * Looks up a session token. Resolves to the session, or null if the token is unknown or expired.
 * Rejects only for unexpected failures (for example, the database is down).
 */
export type SessionValidator = (token: string) => Promise<Session | null>;
