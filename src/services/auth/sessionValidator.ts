/*
 * Auth Service stub (owner: Chuan). Defines what the REST API Layer needs from the Auth
 * Service to check a session. The real implementation replaces `stubSessionValidator`.
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

/**
 * Placeholder validator used until the Auth Service exists. It accepts no token, so every
 * protected route answers 401.
 * @returns always null
 */
export const stubSessionValidator: SessionValidator = async () => null;
