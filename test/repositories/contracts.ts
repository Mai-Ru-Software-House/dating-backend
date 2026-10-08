/*
 * One set of behaviour tests for the repositories (messages, favorites, notes, users). They run
 * against the in-memory versions (always) and against the Prisma versions (when a test database
 * is set), so both must behave the same. The tests only use the repository interfaces.
 */
import { describe, expect, it } from "bun:test";

import type {
  FavoritesRepository,
  NotesRepository,
} from "../../src/services/favoritesNotes/favoritesNotesRepository";
import type { MessageRepository, UserReader } from "../../src/services/messaging/messageRepository";
import type { NewMessage } from "../../src/services/messaging/messagingTypes";

const T0 = new Date("2026-10-08T10:00:00.000Z").getTime();
const MINUTE_MS = 60_000;
const NO_SUCH_USER = "99999";
const NO_SUCH_UUID = "00000000-0000-7000-8000-000000000000";

/** A moment `minutes` after T0. */
function at(minutes: number): Date {
  return new Date(T0 + minutes * MINUTE_MS);
}

/** Three users that exist in the world of a test. */
export interface People {
  alice: string;
  bob: string;
  chai: string;
}

/** A fresh world for one test of the message repository. */
export interface MessageWorld extends People {
  repository: MessageRepository;
}

/** A fresh world for one test of the favorites repository. */
export interface FavoritesWorld extends People {
  repository: FavoritesRepository;
}

/** A fresh world for one test of the notes repository. */
export interface NotesWorld extends People {
  repository: NotesRepository;
}

/** A fresh world for one test of the user reader. */
export interface UsersWorld extends People {
  reader: UserReader;
  /** The summary each user must have, by user ID. */
  expected: Record<string, { displayName: string; photoUrl: string }>;
}

function newMessage(
  senderId: string,
  receiverId: string,
  text: string,
  minute: number,
): NewMessage {
  return { senderId, receiverId, text, sentAt: at(minute), replyToMessageId: null };
}

/**
 * Behaviour tests for `MessageRepository`.
 * @param setup - builds a fresh repository and three existing users for each test
 */
export function describeMessageRepository(setup: () => Promise<MessageWorld>): void {
  describe("MessageRepository", () => {
    it("stores a message as not read and finds it again", async () => {
      const { repository, alice, bob } = await setup();
      const stored = await repository.insertMessage(newMessage(alice, bob, "Hello", 0));
      expect(stored).toMatchObject({
        senderId: alice,
        receiverId: bob,
        text: "Hello",
        readAt: null,
      });
      expect(stored.sentAt.getTime()).toBe(at(0).getTime());
      expect(stored.replyToMessageId).toBeNull();
      expect(await repository.findMessageById(stored.messageId)).toEqual(stored);
    });

    it("keeps which message a reply answers", async () => {
      const { repository, alice, bob } = await setup();
      const first = await repository.insertMessage(newMessage(alice, bob, "Coffee?", 0));
      const reply = await repository.insertMessage({
        ...newMessage(bob, alice, "Sure", 1),
        replyToMessageId: first.messageId,
      });
      expect(reply.replyToMessageId).toBe(first.messageId);
      expect((await repository.findMessageById(reply.messageId))?.replyToMessageId).toBe(
        first.messageId,
      );
    });

    it("does not find an unknown message, or an ID that is not a UUID", async () => {
      const { repository } = await setup();
      expect(await repository.findMessageById(NO_SUCH_UUID)).toBeNull();
      expect(await repository.findMessageById(NO_SUCH_USER)).toBeNull();
    });

    it("finds several messages by ID and leaves out the ones that do not exist", async () => {
      const { repository, alice, bob } = await setup();
      const one = await repository.insertMessage(newMessage(alice, bob, "One", 0));
      const two = await repository.insertMessage(newMessage(bob, alice, "Two", 1));
      const found = await repository.findMessagesByIds([
        two.messageId,
        NO_SUCH_UUID,
        NO_SUCH_USER,
        one.messageId,
      ]);
      expect(found.map((message) => message.text).sort()).toEqual(["One", "Two"]);
    });

    it("lists a conversation in both directions, newest first, and only that conversation", async () => {
      const { repository, alice, bob, chai } = await setup();
      await repository.insertMessage(newMessage(alice, bob, "1 to bob", 0));
      await repository.insertMessage(newMessage(bob, alice, "2 from bob", 1));
      await repository.insertMessage(newMessage(alice, chai, "to chai", 2));
      await repository.insertMessage(newMessage(alice, bob, "3 to bob", 3));
      const page = await repository.listConversationMessages(alice, bob, { limit: 10 });
      expect(page.map((message) => message.text)).toEqual(["3 to bob", "2 from bob", "1 to bob"]);
      const sameFromBobSide = await repository.listConversationMessages(bob, alice, { limit: 10 });
      expect(sameFromBobSide.map((message) => message.text)).toEqual(page.map((m) => m.text));
    });

    it("honours the page size, and pages back with `before`", async () => {
      const { repository, alice, bob } = await setup();
      for (let minute = 0; minute < 5; minute += 1) {
        await repository.insertMessage(newMessage(alice, bob, `m${minute}`, minute));
      }
      const first = await repository.listConversationMessages(alice, bob, { limit: 2 });
      expect(first.map((message) => message.text)).toEqual(["m4", "m3"]);
      const last = first[first.length - 1]!;
      const second = await repository.listConversationMessages(alice, bob, {
        limit: 2,
        before: { sentAt: last.sentAt, messageId: last.messageId },
      });
      expect(second.map((message) => message.text)).toEqual(["m2", "m1"]);
    });

    it("gives the messages just after a position with `after`, shown newest first", async () => {
      const { repository, alice, bob } = await setup();
      const stored = [];
      for (let minute = 0; minute < 5; minute += 1) {
        stored.push(await repository.insertMessage(newMessage(alice, bob, `m${minute}`, minute)));
      }
      const position = stored[1]!;
      const page = await repository.listConversationMessages(alice, bob, {
        limit: 2,
        after: { sentAt: position.sentAt, messageId: position.messageId },
      });
      // The two messages closest after m1 are m2 and m3, shown newest first.
      expect(page.map((message) => message.text)).toEqual(["m3", "m2"]);
    });

    it("orders messages sent at the same moment by their ID, and pages through them without a gap", async () => {
      const { repository, alice, bob } = await setup();
      const a = await repository.insertMessage(newMessage(alice, bob, "a", 0));
      const b = await repository.insertMessage(newMessage(bob, alice, "b", 0));
      const c = await repository.insertMessage(newMessage(alice, bob, "c", 0));
      const all = await repository.listConversationMessages(alice, bob, { limit: 10 });
      expect(all.map((message) => message.text)).toEqual(["c", "b", "a"]);
      const olderThanC = await repository.listConversationMessages(alice, bob, {
        limit: 10,
        before: { sentAt: c.sentAt, messageId: c.messageId },
      });
      expect(olderThanC.map((message) => message.text)).toEqual(["b", "a"]);
      const newerThanA = await repository.listConversationMessages(alice, bob, {
        limit: 10,
        after: { sentAt: a.sentAt, messageId: a.messageId },
      });
      expect(newerThanA.map((message) => message.text)).toEqual(["c", "b"]);
      expect(b.messageId).not.toBe(a.messageId);
    });

    it("gives an empty list for users with no messages or IDs that are not UUIDs", async () => {
      const { repository, alice, bob } = await setup();
      expect(await repository.listConversationMessages(alice, bob, { limit: 5 })).toEqual([]);
      expect(await repository.listConversationMessages(NO_SUCH_USER, bob, { limit: 5 })).toEqual(
        [],
      );
    });

    it("lists only unread messages to the receiver, newest first, with a limit and `before`", async () => {
      const { repository, alice, bob, chai } = await setup();
      await repository.insertMessage(newMessage(bob, alice, "old", 0));
      await repository.insertMessage(newMessage(chai, alice, "mid", 1));
      await repository.insertMessage(newMessage(bob, alice, "new", 2));
      await repository.insertMessage(newMessage(alice, bob, "sent by alice", 3));
      await repository.markConversationRead(alice, chai, at(5));

      const unread = await repository.listUnreadForReceiver(alice, { limit: 10 });
      expect(unread.map((message) => message.text)).toEqual(["new", "old"]);
      expect(
        (await repository.listUnreadForReceiver(alice, { limit: 1 })).map((m) => m.text),
      ).toEqual(["new"]);
      const newest = unread[0]!;
      const older = await repository.listUnreadForReceiver(alice, {
        limit: 10,
        before: { sentAt: newest.sentAt, messageId: newest.messageId },
      });
      expect(older.map((message) => message.text)).toEqual(["old"]);
      expect(await repository.listUnreadForReceiver(NO_SUCH_USER, { limit: 5 })).toEqual([]);
    });

    it("gives one summary per chat partner: the newest message either way and the unread count", async () => {
      const { repository, alice, bob, chai } = await setup();
      await repository.insertMessage(newMessage(bob, alice, "b1", 0));
      await repository.insertMessage(newMessage(bob, alice, "b2", 1));
      await repository.insertMessage(newMessage(alice, chai, "c1", 2));
      await repository.insertMessage(newMessage(chai, alice, "c2", 3));
      await repository.insertMessage(newMessage(alice, bob, "b3 from alice", 4));

      const summaries = await repository.listConversationSummaries(alice);
      const byPartner = new Map(summaries.map((summary) => [summary.otherUserId, summary]));
      expect(summaries).toHaveLength(2);
      expect(byPartner.get(bob)?.lastMessage.text).toBe("b3 from alice");
      expect(byPartner.get(bob)?.unreadCount).toBe(2);
      expect(byPartner.get(chai)?.lastMessage.text).toBe("c2");
      expect(byPartner.get(chai)?.unreadCount).toBe(1);
    });

    it("counts no unread for a partner who only received messages, and lists nobody without messages", async () => {
      const { repository, alice, bob, chai } = await setup();
      await repository.insertMessage(newMessage(alice, bob, "hello", 0));
      const summaries = await repository.listConversationSummaries(alice);
      expect(summaries.map((summary) => [summary.otherUserId, summary.unreadCount])).toEqual([
        [bob, 0],
      ]);
      expect(await repository.listConversationSummaries(chai)).toEqual([]);
      expect(await repository.listConversationSummaries(NO_SUCH_USER)).toEqual([]);
    });

    it("marks only the messages from the other user to the reader as read", async () => {
      const { repository, alice, bob, chai } = await setup();
      const fromBob = await repository.insertMessage(newMessage(bob, alice, "from bob", 0));
      const fromAlice = await repository.insertMessage(newMessage(alice, bob, "from alice", 1));
      const fromChai = await repository.insertMessage(newMessage(chai, alice, "from chai", 2));

      expect(await repository.markConversationRead(alice, bob, at(10))).toBe(0);

      expect((await repository.findMessageById(fromBob.messageId))?.readAt?.getTime()).toBe(
        at(10).getTime(),
      );
      expect((await repository.findMessageById(fromAlice.messageId))?.readAt).toBeNull();
      expect((await repository.findMessageById(fromChai.messageId))?.readAt).toBeNull();
    });

    it("keeps the first read time when the messages are marked again", async () => {
      const { repository, alice, bob } = await setup();
      const stored = await repository.insertMessage(newMessage(bob, alice, "hi", 0));
      await repository.markConversationRead(alice, bob, at(10));
      await repository.markConversationRead(alice, bob, at(20));
      expect((await repository.findMessageById(stored.messageId))?.readAt?.getTime()).toBe(
        at(10).getTime(),
      );
    });

    it("marks nothing for users that do not exist", async () => {
      const { repository, alice } = await setup();
      expect(await repository.markConversationRead(alice, NO_SUCH_USER, at(1))).toBe(0);
    });
  });
}

/**
 * Behaviour tests for `FavoritesRepository`.
 * @param setup - builds a fresh repository and three existing users for each test
 */
export function describeFavoritesRepository(setup: () => Promise<FavoritesWorld>): void {
  describe("FavoritesRepository", () => {
    it("adds a favorite and lists favorites newest first", async () => {
      const { repository, alice, bob, chai } = await setup();
      await repository.addFavorite(alice, chai, at(0));
      const added = await repository.addFavorite(alice, bob, at(1));
      expect(added).toEqual({ userId: alice, favoriteUserId: bob, createdAt: at(1) });
      const list = await repository.listFavorites(alice);
      expect(list.map((favorite) => favorite.favoriteUserId)).toEqual([bob, chai]);
      expect(await repository.listFavoriteUserIds(alice)).toEqual([bob, chai]);
    });

    it("keeps the first time when a favorite is added again, and adds no second row", async () => {
      const { repository, alice, bob } = await setup();
      await repository.addFavorite(alice, bob, at(0));
      const again = await repository.addFavorite(alice, bob, at(5));
      expect(again.createdAt.getTime()).toBe(at(0).getTime());
      expect(await repository.listFavorites(alice)).toHaveLength(1);
    });

    it("removes a favorite, and removing one that is not there is not an error", async () => {
      const { repository, alice, bob, chai } = await setup();
      await repository.addFavorite(alice, bob, at(0));
      await repository.addFavorite(alice, chai, at(1));
      await repository.removeFavorite(alice, bob);
      await repository.removeFavorite(alice, bob);
      await repository.removeFavorite(alice, NO_SUCH_USER);
      expect(await repository.listFavoriteUserIds(alice)).toEqual([chai]);
    });

    it("keeps favorites private to their owner and gives nothing for unknown users", async () => {
      const { repository, alice, bob } = await setup();
      await repository.addFavorite(alice, bob, at(0));
      expect(await repository.listFavorites(bob)).toEqual([]);
      expect(await repository.listFavorites(NO_SUCH_USER)).toEqual([]);
      expect(await repository.listFavoriteUserIds(NO_SUCH_USER)).toEqual([]);
    });
  });
}

/**
 * Behaviour tests for `NotesRepository`.
 * @param setup - builds a fresh repository and three existing users for each test
 */
export function describeNotesRepository(setup: () => Promise<NotesWorld>): void {
  describe("NotesRepository", () => {
    it("stores a note with an ID and lists the author's notes about a user, newest first", async () => {
      const { repository, alice, bob } = await setup();
      const first = await repository.insertNote({
        authorId: alice,
        subjectUserId: bob,
        text: "first",
        createdAt: at(0),
      });
      await repository.insertNote({
        authorId: alice,
        subjectUserId: bob,
        text: "second",
        createdAt: at(1),
      });
      expect(first.noteId).not.toBe("");
      expect(first).toMatchObject({ authorId: alice, subjectUserId: bob, text: "first" });
      const notes = await repository.listNotesAbout(alice, bob);
      expect(notes.map((note) => note.text)).toEqual(["second", "first"]);
    });

    it("keeps the order of notes made at the same moment (the later one first)", async () => {
      const { repository, alice, bob } = await setup();
      await repository.insertNote({
        authorId: alice,
        subjectUserId: bob,
        text: "a",
        createdAt: at(0),
      });
      await repository.insertNote({
        authorId: alice,
        subjectUserId: bob,
        text: "b",
        createdAt: at(0),
      });
      expect((await repository.listNotesAbout(alice, bob)).map((note) => note.text)).toEqual([
        "b",
        "a",
      ]);
    });

    it("never gives a note to anyone but its author", async () => {
      const { repository, alice, bob } = await setup();
      await repository.insertNote({
        authorId: alice,
        subjectUserId: bob,
        text: "private",
        createdAt: at(0),
      });
      expect(await repository.listNotesAbout(bob, alice)).toEqual([]);
      expect(await repository.listNotePeople(bob)).toEqual([]);
    });

    it("lists each person once with the count and the newest note, the newest person first", async () => {
      const { repository, alice, bob, chai } = await setup();
      await repository.insertNote({
        authorId: alice,
        subjectUserId: chai,
        text: "chai 1",
        createdAt: at(0),
      });
      await repository.insertNote({
        authorId: alice,
        subjectUserId: bob,
        text: "bob 1",
        createdAt: at(1),
      });
      await repository.insertNote({
        authorId: alice,
        subjectUserId: bob,
        text: "bob 2",
        createdAt: at(2),
      });
      const people = await repository.listNotePeople(alice);
      expect(people.map((person) => person.subjectUserId)).toEqual([bob, chai]);
      expect(people[0]?.noteCount).toBe(2);
      expect(people[0]?.lastNote.text).toBe("bob 2");
      expect(people[1]?.noteCount).toBe(1);
      expect(people[1]?.lastNote.text).toBe("chai 1");
    });

    it("gives nothing for users that do not exist", async () => {
      const { repository } = await setup();
      expect(await repository.listNotesAbout(NO_SUCH_USER, NO_SUCH_USER)).toEqual([]);
      expect(await repository.listNotePeople(NO_SUCH_USER)).toEqual([]);
    });
  });
}

/**
 * Behaviour tests for `UserReader`.
 * @param setup - builds a fresh reader and three existing users for each test
 */
export function describeUserReader(setup: () => Promise<UsersWorld>): void {
  describe("UserReader", () => {
    it("gives the display name and the photo path of each user that exists", async () => {
      const { reader, alice, bob, expected } = await setup();
      const found = await reader.findUserSummaries([alice, bob]);
      expect(found).toHaveLength(2);
      for (const summary of found) {
        expect(summary.displayName).toBe(expected[summary.userId]?.displayName as string);
        expect(summary.photoUrl).toBe(expected[summary.userId]?.photoUrl as string);
        expect(summary.photoUrl.startsWith("/api/v1/photos/")).toBe(true);
      }
    });

    it("leaves out users that do not exist and IDs that are not UUIDs", async () => {
      const { reader, chai } = await setup();
      const found = await reader.findUserSummaries([NO_SUCH_UUID, NO_SUCH_USER, chai]);
      expect(found.map((summary) => summary.userId)).toEqual([chai]);
      expect(await reader.findUserSummaries([])).toEqual([]);
    });
  });
}
