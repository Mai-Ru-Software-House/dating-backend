/*
 * Tests for the Favorites & Notes Service on in-memory data, following the functional test plan
 * (FV01 to FV04 and NT01 to NT08).
 */
import { describe, expect, it } from "bun:test";

import { createInMemoryMessageRepository } from "../../src/services/messaging/inMemoryMessageRepository";
import { createMessagingService } from "../../src/services/messaging/messagingService";
import {
  ALICE_ID,
  BOB,
  BOB_ID,
  CHAI,
  CHAI_ID,
  DAN_ID,
  ONE_MINUTE_MS,
  START_TIME,
  UNKNOWN_USER_ID,
  UTC_ISO_PATTERN,
  expectApiError,
  seedSheetMessages,
} from "../messaging/fixtures";
import { SEEDED_NOTE_TEXT, createTestFavoritesNotes } from "./fixtures";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const MAX_NOTE_LENGTH = 500;

describe("favorites", () => {
  it("FV01: adding bob puts him before chai, newest first", async () => {
    const { service, clock } = createTestFavoritesNotes();
    clock.advance(ONE_MINUTE_MS);
    const added = await service.addFavorite(ALICE_ID, BOB_ID);
    expect(added.userId).toBe(BOB_ID);
    expect(added.createdAt).toMatch(UTC_ISO_PATTERN);

    const { favorites } = await service.listFavorites(ALICE_ID);
    expect(favorites.map((favorite) => favorite.user.userId)).toEqual([BOB_ID, CHAI_ID]);
  });

  it("FV02: adding the same favorite twice gives no error, no duplicate and the first time", async () => {
    const { service, clock } = createTestFavoritesNotes();
    const first = await service.addFavorite(ALICE_ID, BOB_ID);
    clock.advance(ONE_MINUTE_MS);
    const second = await service.addFavorite(ALICE_ID, BOB_ID);

    expect(second).toEqual(first);
    const { favorites } = await service.listFavorites(ALICE_ID);
    expect(favorites.filter((favorite) => favorite.user.userId === BOB_ID)).toHaveLength(1);
  });

  it("FV03: removing chai leaves only the others", async () => {
    const { service } = createTestFavoritesNotes();
    await service.addFavorite(ALICE_ID, BOB_ID);
    await service.removeFavorite(ALICE_ID, CHAI_ID);

    const { favorites } = await service.listFavorites(ALICE_ID);
    expect(favorites.map((favorite) => favorite.user.userId)).toEqual([BOB_ID]);
  });

  it("removing a user who is not a favorite is not an error", async () => {
    const { service } = createTestFavoritesNotes();
    await service.removeFavorite(ALICE_ID, DAN_ID);
    await service.removeFavorite(ALICE_ID, UNKNOWN_USER_ID);
  });

  it("FV04: the list shows each favorite with display name and photo", async () => {
    const { service } = createTestFavoritesNotes();
    await service.addFavorite(ALICE_ID, BOB_ID);

    const { favorites } = await service.listFavorites(ALICE_ID);
    expect(favorites.map((favorite) => favorite.user)).toEqual([BOB, CHAI]);
  });

  it("rejects adding yourself with 400 on userId", async () => {
    const { service } = createTestFavoritesNotes();
    await expectApiError(
      service.addFavorite(ALICE_ID, ALICE_ID),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "userId",
    );
  });

  it("rejects an unknown user with 404 USER_NOT_FOUND", async () => {
    const { service } = createTestFavoritesNotes();
    await expectApiError(
      service.addFavorite(ALICE_ID, UNKNOWN_USER_ID),
      HTTP_NOT_FOUND,
      "USER_NOT_FOUND",
    );
  });

  it("keeps favorites private to their owner", async () => {
    const { service } = createTestFavoritesNotes();
    expect((await service.listFavorites(BOB_ID)).favorites).toEqual([]);
  });

  it("leaves out a favorite whose user no longer exists", async () => {
    const { service, favorites } = createTestFavoritesNotes();
    await favorites.addFavorite(ALICE_ID, UNKNOWN_USER_ID, new Date(START_TIME));
    const list = await service.listFavorites(ALICE_ID);
    expect(list.favorites.map((favorite) => favorite.user.userId)).toEqual([CHAI_ID]);
  });
});

describe("favorites in the chat list", () => {
  async function chatListOrder(
    changes: (test: ReturnType<typeof createTestFavoritesNotes>) => Promise<void>,
  ) {
    const test = createTestFavoritesNotes();
    const messages = createInMemoryMessageRepository();
    await seedSheetMessages(messages);
    const messaging = createMessagingService({
      messages,
      favorites: test.favorites,
      users: test.users,
      now: test.clock.now,
    });
    await changes(test);
    const chatList = await messaging.getChatList(ALICE_ID);
    return chatList.conversations.map((row) => row.user.userId);
  }

  it("shows chai first before anyone else is added, as the seed data says", async () => {
    const order = await chatListOrder(async () => {});
    expect(order[0]).toBe(CHAI_ID);
  });

  it("FV01: bob joins chai at the top of the chat list", async () => {
    const order = await chatListOrder(async ({ service }) => {
      await service.addFavorite(ALICE_ID, BOB_ID);
    });
    expect(order.slice(0, 2).sort()).toEqual([BOB_ID, CHAI_ID].sort());
  });

  it("FV03: chai goes back to her place by message time after removal", async () => {
    const order = await chatListOrder(async ({ service }) => {
      await service.addFavorite(ALICE_ID, BOB_ID);
      await service.removeFavorite(ALICE_ID, CHAI_ID);
    });
    expect(order[0]).toBe(BOB_ID);
    expect(order.indexOf(CHAI_ID)).toBeGreaterThan(0);
  });
});

describe("notes", () => {
  it("NT01: records a note with the server time and shows it", async () => {
    const { service } = createTestFavoritesNotes();
    const note = await service.createNote(ALICE_ID, BOB_ID, "Met at Siam Paragon, likes jazz");

    expect(note.aboutUserId).toBe(BOB_ID);
    expect(note.text).toBe("Met at Siam Paragon, likes jazz");
    expect(note.createdAt).toBe(START_TIME);
    expect((await service.listNotes(ALICE_ID, BOB_ID)).notes).toEqual([note]);
  });

  it("NT02: lists several notes newest first, each with its own time", async () => {
    const { service, clock } = createTestFavoritesNotes();
    await service.createNote(ALICE_ID, BOB_ID, "First");
    clock.advance(ONE_MINUTE_MS);
    await service.createNote(ALICE_ID, BOB_ID, "Second");
    clock.advance(ONE_MINUTE_MS);
    await service.createNote(ALICE_ID, BOB_ID, "Third");

    const { notes } = await service.listNotes(ALICE_ID, BOB_ID);
    expect(notes.map((note) => note.text)).toEqual(["Third", "Second", "First"]);
    expect(new Set(notes.map((note) => note.createdAt)).size).toBe(3);
  });

  it("NT02: notes made in the same millisecond stay in the order they were made", async () => {
    const { service } = createTestFavoritesNotes();
    await service.createNote(ALICE_ID, BOB_ID, "First");
    await service.createNote(ALICE_ID, BOB_ID, "Second");
    expect((await service.listNotes(ALICE_ID, BOB_ID)).notes.map((note) => note.text)).toEqual([
      "Second",
      "First",
    ]);
  });

  it("NT03: gives an empty list for a user with no notes", async () => {
    const { service } = createTestFavoritesNotes();
    expect((await service.listNotes(ALICE_ID, DAN_ID)).notes).toEqual([]);
  });

  it("NT04: shows the seeded note about chai with its time", async () => {
    const { service } = createTestFavoritesNotes();
    const { notes } = await service.listNotes(ALICE_ID, CHAI_ID);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.text).toBe(SEEDED_NOTE_TEXT);
    expect(notes[0]?.createdAt).toMatch(UTC_ISO_PATTERN);
    expect((notes[0]?.createdAt ?? "") < START_TIME).toBe(true);
  });

  it("NT05: rejects an empty note and a note of only spaces, and stores nothing", async () => {
    const { service } = createTestFavoritesNotes();
    await expectApiError(
      service.createNote(ALICE_ID, BOB_ID, ""),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "text",
    );
    await expectApiError(
      service.createNote(ALICE_ID, BOB_ID, "   \n  "),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "text",
    );
    expect((await service.listNotes(ALICE_ID, BOB_ID)).notes).toEqual([]);
  });

  it("NT06: saves 500 characters in full and rejects 501 with a message about the limit", async () => {
    const { service } = createTestFavoritesNotes();
    const full = "x".repeat(MAX_NOTE_LENGTH);
    const saved = await service.createNote(ALICE_ID, BOB_ID, full);
    expect(saved.text).toBe(full);

    let message = "";
    try {
      await service.createNote(ALICE_ID, BOB_ID, "x".repeat(MAX_NOTE_LENGTH + 1));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("500");
    expect((await service.listNotes(ALICE_ID, BOB_ID)).notes).toHaveLength(1);
  });

  it("counts an emoji as one character and trims spaces before counting", async () => {
    const { service } = createTestFavoritesNotes();
    const emojiNote = "😀".repeat(MAX_NOTE_LENGTH);
    expect((await service.createNote(ALICE_ID, BOB_ID, emojiNote)).text).toBe(emojiNote);
    const padded = `  ${"y".repeat(MAX_NOTE_LENGTH)}  `;
    expect((await service.createNote(ALICE_ID, BOB_ID, padded)).text).toBe(
      "y".repeat(MAX_NOTE_LENGTH),
    );
  });

  it("saves Thai text exactly as typed", async () => {
    const { service } = createTestFavoritesNotes();
    const note = await service.createNote(ALICE_ID, BOB_ID, "ชอบกาแฟและดนตรีแจ๊ส");
    expect(note.text).toBe("ชอบกาแฟและดนตรีแจ๊ส");
  });

  it("NT07: answers 404 USER_NOT_FOUND for a note about a user who does not exist", async () => {
    const { service } = createTestFavoritesNotes();
    await expectApiError(
      service.createNote(ALICE_ID, UNKNOWN_USER_ID, "Hello"),
      HTTP_NOT_FOUND,
      "USER_NOT_FOUND",
    );
    await expectApiError(
      service.listNotes(ALICE_ID, UNKNOWN_USER_ID),
      HTTP_NOT_FOUND,
      "USER_NOT_FOUND",
    );
  });

  it("rejects a note about yourself with 400 on aboutUserId", async () => {
    const { service } = createTestFavoritesNotes();
    await expectApiError(
      service.createNote(ALICE_ID, ALICE_ID, "Note to self"),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "aboutUserId",
    );
  });

  it("NT08: keeps notes private, bob sees only his own notes about alice", async () => {
    const { service } = createTestFavoritesNotes();
    await service.createNote(ALICE_ID, BOB_ID, "Alice wrote this about Bob");

    expect((await service.listNotes(BOB_ID, ALICE_ID)).notes).toEqual([]);
    expect((await service.listNotePeople(BOB_ID)).people).toEqual([]);
    await service.createNote(BOB_ID, ALICE_ID, "Bob wrote this about Alice");
    expect((await service.listNotes(BOB_ID, ALICE_ID)).notes.map((note) => note.text)).toEqual([
      "Bob wrote this about Alice",
    ]);
  });
});

describe("notes people list", () => {
  it("lists each person once with the count and the newest note, newest person first", async () => {
    const { service, clock } = createTestFavoritesNotes();
    clock.advance(ONE_MINUTE_MS);
    await service.createNote(ALICE_ID, BOB_ID, "About Bob 1");
    clock.advance(ONE_MINUTE_MS);
    await service.createNote(ALICE_ID, BOB_ID, "About Bob 2");

    const { people } = await service.listNotePeople(ALICE_ID);
    expect(people.map((person) => person.user.userId)).toEqual([BOB_ID, CHAI_ID]);
    expect(people[0]?.noteCount).toBe(2);
    expect(people[0]?.lastNote.text).toBe("About Bob 2");
    expect(people[1]?.noteCount).toBe(1);
    expect(people[1]?.lastNote.text).toBe(SEEDED_NOTE_TEXT);
    expect(people[1]?.user).toEqual(CHAI);
  });
});
