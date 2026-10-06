/*
 * Shared test setup for the Messaging tests: three known users, a fixed clock that only moves
 * when a test moves it, the in-memory repositories, and a helper to check ApiError results.
 */
import { expect } from "bun:test";

import { loadConfig } from "../../src/config/env";
import { ApiError } from "../../src/plugins/errors";
import type { StoredMessage, UserSummary } from "../../src/services/messaging/messagingTypes";
import {
  createInMemoryFavoritesReader,
  createInMemoryMessageRepository,
  createInMemoryUserReader,
} from "../../src/services/messaging/inMemoryMessageRepository";
import { createMessagingService } from "../../src/services/messaging/messagingService";

export const USER_A: UserSummary = { userId: "usr_a", displayName: "Mai", photoId: "pho_a" };
export const USER_B: UserSummary = { userId: "usr_b", displayName: "Ploy", photoId: "pho_b" };
export const USER_C: UserSummary = { userId: "usr_c", displayName: "Arm", photoId: "pho_c" };
export const UNKNOWN_USER_ID = "usr_unknown";
export const START_TIME = "2026-10-06T10:00:00.000Z";
export const ONE_MINUTE_MS = 60_000;

/** A clock that stays still until `advance` is called. */
export function createFixedClock(start: string = START_TIME) {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current),
    advance(ms: number = ONE_MINUTE_MS) {
      current += ms;
    },
  };
}

/** Build a Messaging Service on in-memory data, with a fixed clock and a recording notifier. */
export function createTestService(favoritesByUser: Record<string, string[]> = {}) {
  const clock = createFixedClock();
  const repository = createInMemoryMessageRepository();
  const notified: StoredMessage[] = [];
  const service = createMessagingService({
    messages: repository,
    favorites: createInMemoryFavoritesReader(favoritesByUser),
    users: createInMemoryUserReader([USER_A, USER_B, USER_C]),
    notifier: {
      async messageSent(message) {
        notified.push(message);
      },
    },
    now: clock.now,
  });
  return { service, repository, clock, notified };
}

/** Check that a promise rejects with an ApiError with this status, code and field. */
export async function expectApiError(
  promise: Promise<unknown>,
  status: number,
  code: string,
  field?: string,
): Promise<void> {
  let error: unknown;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(ApiError);
  const apiError = error as ApiError;
  expect(apiError.status).toBe(status);
  expect(apiError.code).toBe(code);
  expect(apiError.field).toBe(field);
}

/** Config for tests that build the whole app. */
export const testConfig = loadConfig({
  NODE_ENV: "test",
  PORT: "3000",
  CORS_ORIGINS: "http://localhost:8081",
  SESSION_SECRET: "test-secret",
  DATABASE_URL: "postgres://user:pass@localhost:5432/test",
  RUSTFS_ENDPOINT: "http://localhost:9000",
  RUSTFS_ACCESS_KEY: "test",
  RUSTFS_SECRET_KEY: "test",
  RUSTFS_BUCKET: "test",
  MATCH_ENGINE_URL: "http://localhost:8000",
  NOMINATIM_URL: "http://nominatim.test",
});
