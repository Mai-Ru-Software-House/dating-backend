/*
 * Shared setup for the Favorites & Notes tests: the users and seed data of the functional test
 * plan (alice's favorite chai, alice's note about chai), in-memory repositories and a clock that
 * only moves when a test moves it.
 */
import { createFavoritesNotesService } from "../../src/services/favoritesNotes/favoritesNotesService";
import {
  createInMemoryFavoritesRepository,
  createInMemoryNotesRepository,
} from "../../src/services/favoritesNotes/inMemoryFavoritesNotesRepository";
import { createInMemoryUserReader } from "../../src/services/messaging/inMemoryMessageRepository";
import {
  ALICE,
  ALICE_ID,
  BOB,
  CHAI,
  CHAI_ID,
  DAN,
  FAH,
  HANA,
  ONE_MINUTE_MS,
  START_TIME,
  createFixedClock,
} from "../messaging/fixtures";

const MINUTES_PER_DAY = 1440;
/** The seeded note of the Seed Data sheet, written a month before START_TIME. */
export const SEEDED_NOTE_TEXT = "Met at a cafe in Ari last month.";
const DAYS_BEFORE_START = 30;

/**
 * Build the service on in-memory data: alice has chai as a favorite (added a day ago) and one
 * note about chai (30 days ago), as the Seed Data sheet says.
 * @returns the service, the repositories, the clock and the user reader
 */
export function createTestFavoritesNotes() {
  const clock = createFixedClock();
  const startMs = new Date(START_TIME).getTime();
  const favorites = createInMemoryFavoritesRepository([
    {
      userId: ALICE_ID,
      favoriteUserId: CHAI_ID,
      createdAt: new Date(startMs - MINUTES_PER_DAY * ONE_MINUTE_MS),
    },
  ]);
  const notes = createInMemoryNotesRepository([
    {
      authorId: ALICE_ID,
      subjectUserId: CHAI_ID,
      text: SEEDED_NOTE_TEXT,
      createdAt: new Date(startMs - DAYS_BEFORE_START * MINUTES_PER_DAY * ONE_MINUTE_MS),
    },
  ]);
  const users = createInMemoryUserReader([ALICE, BOB, CHAI, DAN, FAH, HANA]);
  const service = createFavoritesNotesService({ favorites, notes, users, now: clock.now });
  return { service, favorites, notes, users, clock };
}
