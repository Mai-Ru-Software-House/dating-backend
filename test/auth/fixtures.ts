/*
 * Shared setup for the Auth tests: an Auth Service on an in-memory repository, cheap Argon2id
 * settings, a fixed clock and the test users from the functional test plan.
 */
import { createAuthService } from "../../src/services/auth/authService";
import { createInMemoryAuthRepository } from "../../src/services/auth/inMemoryAuthRepository";
import { createPasswordHasher } from "../../src/services/auth/passwordHasher";
import { createTokenService } from "../../src/services/auth/tokens";
import { createFixedClock } from "../messaging/fixtures";

export const ACCESS_TTL_SECONDS = 60;
export const REFRESH_TTL_DAYS = 30;
export const TEST_JWT_SECRET = "test-secret-for-auth-tests";
const CHEAP_MEMORY_COST = 1024;
const CHEAP_TIME_COST = 1;

/** Users from the Test Users sheet of the functional test plan. */
export const TEST_USERS = [
  { userId: "usr_alice", username: "alice", password: "Alice2026" },
  { userId: "usr_bob", username: "bob", password: "Bob2026x" },
] as const;

/** Argon2id settings that are fast enough for tests. */
export const cheapHasher = createPasswordHasher({
  memoryCost: CHEAP_MEMORY_COST,
  timeCost: CHEAP_TIME_COST,
});

/**
 * Build an Auth Service with alice and bob registered.
 * @returns the service, its repository, the token service and the clock
 */
export async function createTestAuth() {
  const clock = createFixedClock();
  const repository = createInMemoryAuthRepository();
  for (const user of TEST_USERS) {
    repository.addUser(user.username, {
      userId: user.userId,
      passwordHash: await cheapHasher.hash(user.password),
    });
  }
  const tokens = createTokenService({
    secret: TEST_JWT_SECRET,
    accessTtlSeconds: ACCESS_TTL_SECONDS,
    now: clock.now,
  });
  const service = createAuthService({
    repository,
    hasher: cheapHasher,
    tokens,
    refreshTtlDays: REFRESH_TTL_DAYS,
    now: clock.now,
  });
  return { service, repository, tokens, clock };
}
