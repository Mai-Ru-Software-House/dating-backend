/*
 * Shared test setup for the Messaging tests: the users and messages of the team functional test
 * plan (Test Users and Seed Data sheets), a fixed clock that only moves when a test moves it, the
 * in-memory repositories, and a helper to check ApiError results.
 */
import { expect } from "bun:test";

import { loadConfig } from "../../src/config/env";
import { ApiError } from "../../src/plugins/errors";
import type { MessageRepository } from "../../src/services/messaging/messageRepository";
import type { StoredMessage, UserSummary } from "../../src/services/messaging/messagingTypes";
import {
  createInMemoryFavoritesReader,
  createInMemoryMessageRepository,
  createInMemoryUserReader,
} from "../../src/services/messaging/inMemoryMessageRepository";
import { createMessagingService } from "../../src/services/messaging/messagingService";

function makeUser(displayName: string): UserSummary {
  const key = displayName.toLowerCase();
  return { userId: `usr_${key}`, displayName, photoUrl: `/api/v1/photos/pho_${key}` };
}

export const ALICE = makeUser("Alice");
export const BOB = makeUser("Bob");
export const CHAI = makeUser("Chai");
export const DAN = makeUser("Dan");
export const FAH = makeUser("Fah");
export const HANA = makeUser("Hana");
export const ALICE_ID = ALICE.userId;
export const BOB_ID = BOB.userId;
export const CHAI_ID = CHAI.userId;
export const DAN_ID = DAN.userId;
export const FAH_ID = FAH.userId;
export const HANA_ID = HANA.userId;
/** The ID the functional test plan uses for a user that does not exist (CH08). */
export const UNKNOWN_USER_ID = "99999";

export const START_TIME = "2026-10-06T10:00:00.000Z";
export const ONE_MINUTE_MS = 60_000;
/** Every time the API sends is UTC ISO 8601 with milliseconds and a final Z. */
export const UTC_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

/** The names of the seeded messages on the Seed Data sheet. */
export type SeedKey = "M1" | "M2" | "M3" | "M4" | "M5" | "M6";

interface SeedRow {
  key: SeedKey;
  from: string;
  to: string;
  text: string;
  minutesAgo: number;
  isRead: boolean;
}

/** Seeded messages M1 to M6, sent relative to START_TIME as on the Seed Data sheet. */
const SEED_ROWS: SeedRow[] = [
  {
    key: "M1",
    from: CHAI_ID,
    to: ALICE_ID,
    text: "Hello Alice, nice to match with you!",
    minutesAgo: HOURS_PER_DAY * MINUTES_PER_HOUR,
    isRead: true,
  },
  { key: "M2", from: BOB_ID, to: ALICE_ID, text: "Hi Alice", minutesAgo: 60, isRead: false },
  {
    key: "M3",
    from: BOB_ID,
    to: ALICE_ID,
    text: "Are you free this weekend?",
    minutesAgo: 50,
    isRead: false,
  },
  {
    key: "M4",
    from: BOB_ID,
    to: ALICE_ID,
    text: "There is a jazz night at Siam on Saturday.",
    minutesAgo: 40,
    isRead: false,
  },
  {
    key: "M5",
    from: BOB_ID,
    to: CHAI_ID,
    text: "Hey Chai, see you at football later.",
    minutesAgo: 2 * MINUTES_PER_HOUR,
    isRead: true,
  },
  {
    key: "M6",
    from: ALICE_ID,
    to: HANA_ID,
    text: "Hi Hana",
    minutesAgo: 3 * MINUTES_PER_HOUR,
    isRead: true,
  },
];

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
    users: createInMemoryUserReader([ALICE, BOB, CHAI, DAN, FAH, HANA]),
    notifier: {
      async messageSent(message) {
        notified.push(message);
      },
    },
    now: clock.now,
  });
  return { service, repository, clock, notified };
}

/**
 * Load the seeded messages M1 to M6 of the Seed Data sheet. M1, M5 and M6 are read, M2 to M4 are
 * unread. Times are counted back from START_TIME.
 * @param repository - the repository to fill
 * @returns the stored messages by their name on the sheet
 */
export async function seedSheetMessages(
  repository: MessageRepository,
): Promise<Record<SeedKey, StoredMessage>> {
  const stored = {} as Record<SeedKey, StoredMessage>;
  const seedNow = new Date(START_TIME).getTime();
  for (const row of SEED_ROWS) {
    const sentAt = new Date(seedNow - row.minutesAgo * ONE_MINUTE_MS);
    stored[row.key] = await repository.insertMessage({
      senderId: row.from,
      receiverId: row.to,
      text: row.text,
      sentAt,
      replyToMessageId: null,
    });
    if (row.isRead) {
      await repository.markConversationRead(row.to, row.from, sentAt);
    }
  }
  return stored;
}

/** A test service with the seeded messages, and alice's favorite chai as on the sheet. */
export async function createSeededService(
  favoritesByUser: Record<string, string[]> = { [ALICE_ID]: [CHAI_ID] },
) {
  const test = createTestService(favoritesByUser);
  const seed = await seedSheetMessages(test.repository);
  return { ...test, seed };
}

/**
 * Load a long thread, as the 60 message thread of case CH06. The senders take turns and the
 * messages are one minute apart, the newest one at START_TIME.
 * @param repository - the repository to fill
 * @param userA - sends the first message
 * @param userB - the other user
 * @param count - how many messages to store
 * @returns the message IDs, oldest first
 */
export async function seedThread(
  repository: MessageRepository,
  userA: string,
  userB: string,
  count: number,
): Promise<string[]> {
  const ids: string[] = [];
  const threadNow = new Date(START_TIME).getTime();
  for (let index = 0; index < count; index += 1) {
    const isFromA = index % 2 === 0;
    const stored = await repository.insertMessage({
      senderId: isFromA ? userA : userB,
      receiverId: isFromA ? userB : userA,
      text: `Message ${index + 1}`,
      sentAt: new Date(threadNow - (count - 1 - index) * ONE_MINUTE_MS),
      replyToMessageId: null,
    });
    ids.push(stored.messageId);
  }
  return ids;
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
  JWT_SECRET: "test-secret",
  DATABASE_URL: "postgres://user:pass@localhost:5432/test",
  RUSTFS_ENDPOINT: "http://localhost:9000",
  RUSTFS_ACCESS_KEY: "test",
  RUSTFS_SECRET_KEY: "test",
  RUSTFS_BUCKET: "test",
  MATCH_ENGINE_URL: "http://localhost:8000",
  NOMINATIM_URL: "http://nominatim.test",
});
