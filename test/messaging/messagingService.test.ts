/*
 * Unit tests for the Messaging Service with in-memory data and a fixed clock (no database, no
 * network). Each rule is tested with correct input, incorrect input and boundary cases. Test
 * names start with the case ID of the team functional test plan when there is one (CH05, MS09
 * and so on). The test plan in docs/test-plans/messaging-unit-tests.md lists every test name.
 */
import { describe, expect, it } from "bun:test";

import {
  DEFAULT_CONVERSATION_LIMIT,
  DEFAULT_UNREAD_LIMIT,
  MAX_MESSAGE_LENGTH,
  type MessagingService,
} from "../../src/services/messaging/messagingService";
import {
  ALICE,
  ALICE_ID,
  BOB,
  BOB_ID,
  CHAI_ID,
  createSeededService,
  createTestService,
  DAN_ID,
  expectApiError,
  FAH_ID,
  HANA_ID,
  seedThread,
  START_TIME,
  UNKNOWN_USER_ID,
  UTC_ISO_PATTERN,
} from "./fixtures";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const EMOJI = "😀";
const THAI_GREETING = "สวัสดีค่ะ 😊";
const THAI_LETTER = "ก";
const THAI_LETTER_WITH_VOWEL = "กิ";
const LONG_THREAD_LENGTH = 60;
const LONG_THREAD_PAGE_SIZE = 25;

function send(
  service: MessagingService,
  from: string,
  to: string,
  text = "Hello",
  replyToMessageId?: string,
) {
  return service.sendMessage(from, to, { text, replyToMessageId });
}

async function unreadCountFrom(service: MessagingService, userId: string, otherUserId: string) {
  const { conversations } = await service.getChatList(userId);
  return conversations.find((row) => row.user.userId === otherUserId)?.unreadCount;
}

describe("sendMessage", () => {
  it("MS01: stores a valid message and returns it with the server time in UTC", async () => {
    const { service } = createTestService();

    const message = await send(service, ALICE_ID, BOB_ID, "Hi Bob, coffee this weekend?");

    expect(message).toEqual({
      messageId: message.messageId,
      senderId: ALICE_ID,
      receiverId: BOB_ID,
      text: "Hi Bob, coffee this weekend?",
      sentAt: START_TIME,
      isRead: false,
      replyTo: null,
    });
    expect(message.sentAt).toMatch(UTC_ISO_PATTERN);
  });

  it("MS01: shows the new message to the receiver in the unread list with the time sent", async () => {
    const { service } = createTestService();
    const message = await send(service, ALICE_ID, BOB_ID, "Hi Bob");

    const { messages } = await service.getUnreadMessages(BOB_ID, {});

    expect(messages).toEqual([
      { messageId: message.messageId, sender: ALICE, text: "Hi Bob", sentAt: START_TIME },
    ]);
  });

  it("trims spaces around the text", async () => {
    const { service } = createTestService();

    const message = await send(service, ALICE_ID, BOB_ID, "   Hi Bob \n ");

    expect(message.text).toBe("Hi Bob");
  });

  it("MS06: accepts text of exactly 1000 characters", async () => {
    const { service } = createTestService();

    const message = await send(service, ALICE_ID, BOB_ID, "a".repeat(MAX_MESSAGE_LENGTH));

    expect(message.text).toHaveLength(MAX_MESSAGE_LENGTH);
  });

  it("accepts 1000 characters after trimming spaces at both ends", async () => {
    const { service } = createTestService();

    const message = await send(service, ALICE_ID, BOB_ID, `  ${"a".repeat(MAX_MESSAGE_LENGTH)}  `);

    expect(message.text).toHaveLength(MAX_MESSAGE_LENGTH);
  });

  it("MS06: rejects text of 1001 characters with 400 text", async () => {
    const { service, repository } = createTestService();

    await expectApiError(
      send(service, ALICE_ID, BOB_ID, "a".repeat(MAX_MESSAGE_LENGTH + 1)),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "text",
    );
    expect(await repository.listConversationSummaries(ALICE_ID)).toEqual([]);
  });

  it("counts an emoji as one character at the limit", async () => {
    const { service } = createTestService();
    const atLimit = `${"a".repeat(MAX_MESSAGE_LENGTH - 1)}${EMOJI}`;

    const message = await send(service, ALICE_ID, BOB_ID, atLimit);

    expect(message.text).toBe(atLimit);
    await expectApiError(
      send(service, ALICE_ID, BOB_ID, `${atLimit}${EMOJI}`),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "text",
    );
  });

  it("MS02: saves Thai text and an emoji exactly as typed, for both users", async () => {
    const { service } = createTestService();
    const message = await send(service, ALICE_ID, BOB_ID, THAI_GREETING);

    const seenByAlice = await service.getConversation(ALICE_ID, BOB_ID, {});
    const seenByBob = await service.getConversation(BOB_ID, ALICE_ID, {});

    expect(message.text).toBe(THAI_GREETING);
    expect(seenByAlice.messages[0]?.text).toBe(THAI_GREETING);
    expect(seenByBob.messages[0]?.text).toBe(THAI_GREETING);
  });

  it("MS06: counts Thai letters by Unicode characters, 1000 is accepted and 1001 is not", async () => {
    const { service } = createTestService();

    const accepted = await send(service, ALICE_ID, BOB_ID, THAI_LETTER.repeat(MAX_MESSAGE_LENGTH));

    expect([...accepted.text]).toHaveLength(MAX_MESSAGE_LENGTH);
    await expectApiError(
      send(service, ALICE_ID, BOB_ID, THAI_LETTER.repeat(MAX_MESSAGE_LENGTH + 1)),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "text",
    );
  });

  it("counts a Thai vowel mark as its own character", async () => {
    const { service } = createTestService();
    const marksPerLetter = [...THAI_LETTER_WITH_VOWEL].length;
    const pairsAtLimit = MAX_MESSAGE_LENGTH / marksPerLetter;

    const accepted = await send(
      service,
      ALICE_ID,
      BOB_ID,
      THAI_LETTER_WITH_VOWEL.repeat(pairsAtLimit),
    );

    expect([...accepted.text]).toHaveLength(MAX_MESSAGE_LENGTH);
    await expectApiError(
      send(service, ALICE_ID, BOB_ID, THAI_LETTER_WITH_VOWEL.repeat(pairsAtLimit + 1)),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "text",
    );
  });

  it("MS05: rejects empty text with 400 text", async () => {
    const { service } = createTestService();

    await expectApiError(
      send(service, ALICE_ID, BOB_ID, ""),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "text",
    );
  });

  it("MS05: rejects text with only spaces with 400 text and saves nothing", async () => {
    const { service, repository } = createTestService();

    await expectApiError(
      send(service, ALICE_ID, BOB_ID, " \t\n "),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "text",
    );
    expect(await repository.listConversationSummaries(ALICE_ID)).toEqual([]);
  });

  it("rejects a message to yourself with 400 userId", async () => {
    const { service } = createTestService();

    await expectApiError(
      send(service, ALICE_ID, ALICE_ID),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "userId",
    );
  });

  it("rejects a message to an unknown user with 404 USER_NOT_FOUND", async () => {
    const { service } = createTestService();

    await expectApiError(
      send(service, ALICE_ID, UNKNOWN_USER_ID),
      HTTP_NOT_FOUND,
      "USER_NOT_FOUND",
    );
  });

  it("calls the notifier once with the stored message", async () => {
    const { service, notified } = createTestService();

    const message = await send(service, ALICE_ID, BOB_ID);

    expect(notified).toHaveLength(1);
    expect(notified[0]?.messageId).toBe(message.messageId);
  });

  it("MS04: keeps both messages, in one shared order, when two users send at the same time", async () => {
    const { service } = createTestService();

    const [fromAlice, fromBob] = await Promise.all([
      send(service, ALICE_ID, BOB_ID, "Hi Bob"),
      send(service, BOB_ID, ALICE_ID, "Hi Alice"),
    ]);
    const seenByAlice = await service.getConversation(ALICE_ID, BOB_ID, {});
    const seenByBob = await service.getConversation(BOB_ID, ALICE_ID, {});

    expect(fromAlice.sentAt).toBe(fromBob.sentAt);
    expect(seenByAlice.messages).toHaveLength(2);
    expect(seenByBob.messages.map((m) => m.messageId)).toEqual(
      seenByAlice.messages.map((m) => m.messageId),
    );
    expect(new Set(seenByAlice.messages.map((m) => m.messageId))).toEqual(
      new Set([fromAlice.messageId, fromBob.messageId]),
    );
  });

  describe("with replyToMessageId", () => {
    it("MS09: stores and returns which message it answers", async () => {
      const { service, seed } = await createSeededService();

      const reply = await send(service, ALICE_ID, BOB_ID, "Yes, Saturday works", seed.M3.messageId);

      expect(reply.receiverId).toBe(BOB_ID);
      expect(reply.replyTo).toEqual({
        messageId: seed.M3.messageId,
        senderId: BOB_ID,
        text: "Are you free this weekend?",
      });
    });

    it("keeps the link when the conversation is read again", async () => {
      const { service, seed } = await createSeededService();
      await send(service, ALICE_ID, BOB_ID, "Yes, Saturday works", seed.M3.messageId);

      const [newest] = (await service.getConversation(ALICE_ID, BOB_ID, {})).messages;

      expect(newest?.replyTo?.messageId).toBe(seed.M3.messageId);
    });

    it("accepts one of my own messages as the original", async () => {
      const { service, seed } = await createSeededService();

      const reply = await send(service, ALICE_ID, HANA_ID, "Hello again", seed.M6.messageId);

      expect(reply.replyTo?.messageId).toBe(seed.M6.messageId);
      expect(reply.replyTo?.senderId).toBe(ALICE_ID);
    });

    it("rejects an original that does not exist with 404 MESSAGE_NOT_FOUND", async () => {
      const { service } = createTestService();

      await expectApiError(
        send(service, ALICE_ID, BOB_ID, "Hi", "msg_missing"),
        HTTP_NOT_FOUND,
        "MESSAGE_NOT_FOUND",
      );
    });

    it("rejects an original from a chat I am not in with 404 MESSAGE_NOT_FOUND", async () => {
      const { service, seed } = await createSeededService();

      await expectApiError(
        send(service, HANA_ID, BOB_ID, "Hi", seed.M2.messageId),
        HTTP_NOT_FOUND,
        "MESSAGE_NOT_FOUND",
      );
    });

    it("rejects an original from another conversation of mine with 400 replyToMessageId", async () => {
      const { service, seed } = await createSeededService();

      await expectApiError(
        send(service, ALICE_ID, BOB_ID, "Hi", seed.M1.messageId),
        HTTP_BAD_REQUEST,
        "INVALID_INPUT",
        "replyToMessageId",
      );
    });

    it("saves nothing when the original is rejected", async () => {
      const { service, seed, notified } = await createSeededService();

      await expectApiError(
        send(service, ALICE_ID, BOB_ID, "Hi", seed.M1.messageId),
        HTTP_BAD_REQUEST,
        "INVALID_INPUT",
        "replyToMessageId",
      );

      expect(notified).toHaveLength(0);
      expect((await service.getConversation(ALICE_ID, BOB_ID, {})).messages).toHaveLength(3);
    });
  });
});

describe("replyToMessage", () => {
  it("MS09: sends the reply to bob without typing his ID, and bob sees it as unread", async () => {
    const { service, seed } = await createSeededService();

    const reply = await service.replyToMessage(ALICE_ID, seed.M3.messageId, "Yes, Saturday works");

    expect(reply.senderId).toBe(ALICE_ID);
    expect(reply.receiverId).toBe(BOB_ID);
    expect(reply.isRead).toBe(false);
    expect(reply.replyTo).toEqual({
      messageId: seed.M3.messageId,
      senderId: BOB_ID,
      text: "Are you free this weekend?",
    });
    expect(await unreadCountFrom(service, BOB_ID, ALICE_ID)).toBe(1);
  });

  it("sends the reply to the sender when the receiver replies", async () => {
    const { service } = createTestService();
    const original = await send(service, ALICE_ID, BOB_ID, "Coffee?");

    const reply = await service.replyToMessage(BOB_ID, original.messageId, "Sure");

    expect(reply.senderId).toBe(BOB_ID);
    expect(reply.receiverId).toBe(ALICE_ID);
  });

  it("sends the reply to the receiver when the sender replies to their own message", async () => {
    const { service } = createTestService();
    const original = await send(service, ALICE_ID, BOB_ID, "Coffee?");

    const reply = await service.replyToMessage(ALICE_ID, original.messageId, "Or tea?");

    expect(reply.senderId).toBe(ALICE_ID);
    expect(reply.receiverId).toBe(BOB_ID);
  });

  it("links the reply to the original message", async () => {
    const { service } = createTestService();
    const original = await send(service, ALICE_ID, BOB_ID, "Coffee?");

    const reply = await service.replyToMessage(BOB_ID, original.messageId, "  Sure  ");

    expect(reply.text).toBe("Sure");
    expect(reply.replyTo).toEqual({
      messageId: original.messageId,
      senderId: ALICE_ID,
      text: "Coffee?",
    });
  });

  it("rejects a reply from a third person with 404 MESSAGE_NOT_FOUND", async () => {
    const { service } = createTestService();
    const original = await send(service, ALICE_ID, BOB_ID);

    await expectApiError(
      service.replyToMessage(HANA_ID, original.messageId, "Hi"),
      HTTP_NOT_FOUND,
      "MESSAGE_NOT_FOUND",
    );
  });

  it("rejects a reply to a message that does not exist with 404 MESSAGE_NOT_FOUND", async () => {
    const { service } = createTestService();

    await expectApiError(
      service.replyToMessage(ALICE_ID, "msg_missing", "Hi"),
      HTTP_NOT_FOUND,
      "MESSAGE_NOT_FOUND",
    );
  });

  it("MS05: rejects an empty reply with 400 text", async () => {
    const { service } = createTestService();
    const original = await send(service, ALICE_ID, BOB_ID);

    await expectApiError(
      service.replyToMessage(BOB_ID, original.messageId, "   "),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "text",
    );
  });

  it("MS06: rejects a reply of 1001 characters with 400 text", async () => {
    const { service } = createTestService();
    const original = await send(service, ALICE_ID, BOB_ID);

    await expectApiError(
      service.replyToMessage(BOB_ID, original.messageId, "a".repeat(MAX_MESSAGE_LENGTH + 1)),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "text",
    );
  });
});

describe("getChatList", () => {
  it("CH01: shows one row per person with the last message, its time and the unread count", async () => {
    const { service, seed } = await createSeededService();

    const { conversations } = await service.getChatList(ALICE_ID);

    expect(conversations.map((row) => row.user.userId)).toEqual([CHAI_ID, BOB_ID, HANA_ID]);
    const byUser = new Map(conversations.map((row) => [row.user.userId, row]));
    expect(byUser.get(BOB_ID)).toMatchObject({
      user: BOB,
      lastMessage: {
        messageId: seed.M4.messageId,
        senderId: BOB_ID,
        text: "There is a jazz night at Siam on Saturday.",
        sentAt: "2026-10-06T09:20:00.000Z",
      },
      unreadCount: 3,
    });
    expect(byUser.get(CHAI_ID)?.lastMessage.sentAt).toBe("2026-10-05T10:00:00.000Z");
    expect(byUser.get(CHAI_ID)?.unreadCount).toBe(0);
    expect(byUser.get(HANA_ID)?.lastMessage.text).toBe("Hi Hana");
    expect(byUser.get(HANA_ID)?.lastMessage.sentAt).toBe("2026-10-06T07:00:00.000Z");
    expect(byUser.get(HANA_ID)?.unreadCount).toBe(0);
  });

  it("CH02: puts a favorite first, even when another chat has a newer last message", async () => {
    const { service } = await createSeededService();

    const { conversations } = await service.getChatList(ALICE_ID);

    expect(conversations[0]?.user.userId).toBe(CHAI_ID);
    expect(conversations[0]?.isFavorite).toBe(true);
    expect(conversations.slice(1).every((row) => !row.isFavorite)).toBe(true);
  });

  it("CH03: sorts the other chats by newest last message, bob before hana", async () => {
    const { service } = await createSeededService();

    const { conversations } = await service.getChatList(ALICE_ID);

    expect(conversations.map((row) => row.user.userId).slice(1)).toEqual([BOB_ID, HANA_ID]);
  });

  it("CH04: returns an empty list, not an error, for a user with no chats", async () => {
    const { service } = await createSeededService();

    expect(await service.getChatList(FAH_ID)).toEqual({ conversations: [] });
  });

  it("returns the last message in either direction", async () => {
    const { service, clock } = createTestService();
    await send(service, ALICE_ID, BOB_ID, "first");
    clock.advance();
    const last = await send(service, BOB_ID, ALICE_ID, "second");

    const { conversations } = await service.getChatList(ALICE_ID);

    expect(conversations).toEqual([
      {
        user: BOB,
        isFavorite: false,
        lastMessage: {
          messageId: last.messageId,
          senderId: BOB_ID,
          text: "second",
          sentAt: last.sentAt,
        },
        unreadCount: 1,
      },
    ]);
  });

  it("orders rows with the same last message time by the larger message ID first", async () => {
    const { service } = createTestService();
    const toBob = await send(service, ALICE_ID, BOB_ID);
    const toChai = await send(service, ALICE_ID, CHAI_ID);

    const { conversations } = await service.getChatList(ALICE_ID);

    expect(toChai.sentAt).toBe(toBob.sentAt);
    expect(conversations.map((row) => row.user.userId)).toEqual([CHAI_ID, BOB_ID]);
  });

  it("counts only unread messages from the other user", async () => {
    const { service } = createTestService();
    await send(service, BOB_ID, ALICE_ID, "one");
    await send(service, BOB_ID, ALICE_ID, "two");
    await send(service, ALICE_ID, BOB_ID, "mine");

    expect(await unreadCountFrom(service, ALICE_ID, BOB_ID)).toBe(2);
    expect(await unreadCountFrom(service, BOB_ID, ALICE_ID)).toBe(1);
  });

  it("does not show a favorite with no messages", async () => {
    const { service } = createTestService({ [ALICE_ID]: [BOB_ID, CHAI_ID] });
    await send(service, ALICE_ID, CHAI_ID);

    const { conversations } = await service.getChatList(ALICE_ID);

    expect(conversations.map((row) => row.user.userId)).toEqual([CHAI_ID]);
  });

  it("SY04: sends every last message time as UTC ISO 8601 ending in Z", async () => {
    const { service } = await createSeededService();

    const { conversations } = await service.getChatList(ALICE_ID);

    expect(conversations.length).toBeGreaterThan(0);
    for (const row of conversations) {
      expect(row.lastMessage.sentAt).toMatch(UTC_ISO_PATTERN);
    }
  });
});

describe("getConversation", () => {
  it("returns only messages between the two users, newest first", async () => {
    const { service, clock } = createTestService();
    const first = await send(service, ALICE_ID, BOB_ID, "1");
    clock.advance();
    await send(service, ALICE_ID, CHAI_ID, "to Chai");
    clock.advance();
    const second = await send(service, BOB_ID, ALICE_ID, "2");

    const page = await service.getConversation(ALICE_ID, BOB_ID, {});

    expect(page.messages.map((m) => m.messageId)).toEqual([second.messageId, first.messageId]);
    expect(page.hasMore).toBe(false);
  });

  it("CH05: shows the messages in time order and marks them as read", async () => {
    const { service, seed } = await createSeededService();

    const page = await service.getConversation(ALICE_ID, BOB_ID, {});

    expect(page.messages.map((m) => m.messageId)).toEqual([
      seed.M4.messageId,
      seed.M3.messageId,
      seed.M2.messageId,
    ]);
    expect(page.messages.map((m) => m.senderId)).toEqual([BOB_ID, BOB_ID, BOB_ID]);
    expect(page.messages.every((m) => m.isRead)).toBe(true);
    for (const message of page.messages) {
      expect(message.sentAt).toMatch(UTC_ISO_PATTERN);
    }
  });

  it("CH05: sets bob's unread count to 0 in the chat list and on the home page", async () => {
    const { service } = await createSeededService();
    expect(await unreadCountFrom(service, ALICE_ID, BOB_ID)).toBe(3);

    await service.getConversation(ALICE_ID, BOB_ID, {});

    expect(await unreadCountFrom(service, ALICE_ID, BOB_ID)).toBe(0);
    expect(await service.getUnreadMessages(ALICE_ID, {})).toEqual({ messages: [], hasMore: false });
  });

  it("marks every unread message from that user, not only the page that was asked for", async () => {
    const { service } = await createSeededService();

    const page = await service.getConversation(ALICE_ID, BOB_ID, { limit: 1 });

    expect(page.messages).toHaveLength(1);
    expect(await unreadCountFrom(service, ALICE_ID, BOB_ID)).toBe(0);
  });

  it("does not mark the messages I sent", async () => {
    const { service } = await createSeededService();
    await send(service, ALICE_ID, BOB_ID, "mine");

    await service.getConversation(ALICE_ID, BOB_ID, {});

    expect(await unreadCountFrom(service, BOB_ID, ALICE_ID)).toBe(1);
  });

  it("does not mark the messages of another conversation", async () => {
    const { service } = await createSeededService();
    await send(service, CHAI_ID, ALICE_ID, "new from Chai");

    await service.getConversation(ALICE_ID, BOB_ID, {});

    expect(await unreadCountFrom(service, ALICE_ID, CHAI_ID)).toBe(1);
  });

  it("marks nothing when the request is rejected", async () => {
    const { service, seed } = await createSeededService();
    const rejectedRequests = [
      { field: "limit", request: () => service.getConversation(ALICE_ID, BOB_ID, { limit: 0 }) },
      {
        field: "before",
        request: () => service.getConversation(ALICE_ID, BOB_ID, { before: seed.M1.messageId }),
      },
      {
        field: "after",
        request: () =>
          service.getConversation(ALICE_ID, BOB_ID, {
            before: seed.M2.messageId,
            after: seed.M2.messageId,
          }),
      },
    ];

    for (const { field, request } of rejectedRequests) {
      await expectApiError(request(), HTTP_BAD_REQUEST, "INVALID_INPUT", field);
    }

    expect(await unreadCountFrom(service, ALICE_ID, BOB_ID)).toBe(3);
  });

  it("CH08: answers 404 USER_NOT_FOUND for a user that does not exist", async () => {
    const { service } = createTestService();

    await expectApiError(
      service.getConversation(ALICE_ID, UNKNOWN_USER_ID, {}),
      HTTP_NOT_FOUND,
      "USER_NOT_FOUND",
    );
  });

  it("CH09: returns only messages between hana and bob, which is none", async () => {
    const { service, seed } = await createSeededService();

    const page = await service.getConversation(HANA_ID, BOB_ID, {});

    expect(page).toEqual({ messages: [], hasMore: false });
    const seen = page.messages.map((m) => m.messageId);
    for (const key of ["M2", "M3", "M4", "M5"] as const) {
      expect(seen).not.toContain(seed[key].messageId);
    }
  });

  it("CH09: leaves bob's messages to alice unread when hana opens the chat with bob", async () => {
    const { service } = await createSeededService();

    await service.getConversation(HANA_ID, BOB_ID, {});

    expect(await unreadCountFrom(service, ALICE_ID, BOB_ID)).toBe(3);
    expect((await service.getChatList(HANA_ID)).conversations.map((r) => r.user.userId)).toEqual([
      ALICE_ID,
    ]);
  });

  it("CH06: loads the 60 message thread page by page, every message once", async () => {
    const { service, repository } = createTestService();
    const ids = await seedThread(repository, ALICE_ID, DAN_ID, LONG_THREAD_LENGTH);

    const seen: string[] = [];
    const hasMoreByPage: boolean[] = [];
    let before: string | undefined;
    let hasMore = true;
    while (hasMore) {
      const page = await service.getConversation(ALICE_ID, DAN_ID, {
        before,
        limit: LONG_THREAD_PAGE_SIZE,
      });
      seen.push(...page.messages.map((m) => m.messageId));
      hasMoreByPage.push(page.hasMore);
      hasMore = page.hasMore;
      before = page.messages.at(-1)?.messageId;
    }

    expect(seen).toEqual([...ids].reverse());
    expect(new Set(seen).size).toBe(LONG_THREAD_LENGTH);
    expect(hasMoreByPage).toEqual([true, true, false]);
  });

  it("uses a limit of 30 when none is sent", async () => {
    const { service } = createTestService();
    for (let i = 0; i <= DEFAULT_CONVERSATION_LIMIT; i += 1) {
      await send(service, ALICE_ID, BOB_ID, `m${i}`);
    }

    const page = await service.getConversation(ALICE_ID, BOB_ID, {});

    expect(page.messages).toHaveLength(DEFAULT_CONVERSATION_LIMIT);
    expect(page.hasMore).toBe(true);
  });

  it("accepts limit 1 and limit 100", async () => {
    const { service } = createTestService();
    await send(service, ALICE_ID, BOB_ID, "1");
    await send(service, ALICE_ID, BOB_ID, "2");

    const smallest = await service.getConversation(ALICE_ID, BOB_ID, { limit: 1 });
    const largest = await service.getConversation(ALICE_ID, BOB_ID, { limit: 100 });

    expect(smallest.messages).toHaveLength(1);
    expect(smallest.hasMore).toBe(true);
    expect(largest.messages).toHaveLength(2);
    expect(largest.hasMore).toBe(false);
  });

  it("rejects limit 0, 101 and 2.5 with 400 limit", async () => {
    const { service } = createTestService();

    for (const limit of [0, 101, 2.5]) {
      await expectApiError(
        service.getConversation(ALICE_ID, BOB_ID, { limit }),
        HTTP_BAD_REQUEST,
        "INVALID_INPUT",
        "limit",
      );
    }
  });

  it("pages back with before through every message with no gaps or duplicates", async () => {
    const { service, clock } = createTestService();
    const sent: string[] = [];
    // Pairs of messages share the same time, so the order must also use the message ID.
    for (let i = 0; i < 7; i += 1) {
      const isFromAlice = i % 2 === 0;
      const from = isFromAlice ? ALICE_ID : BOB_ID;
      const to = isFromAlice ? BOB_ID : ALICE_ID;
      sent.push((await send(service, from, to, `m${i}`)).messageId);
      if (i % 2 === 1) {
        clock.advance();
      }
    }

    const seen: string[] = [];
    let before: string | undefined;
    let hasMore = true;
    while (hasMore) {
      const page = await service.getConversation(ALICE_ID, BOB_ID, { before, limit: 3 });
      seen.push(...page.messages.map((m) => m.messageId));
      hasMore = page.hasMore;
      before = page.messages.at(-1)?.messageId;
    }

    expect(seen).toEqual([...sent].reverse());
  });

  it("polls with after and returns only newer messages with no gaps", async () => {
    const { service, clock } = createTestService();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      ids.push((await send(service, BOB_ID, ALICE_ID, `m${i}`)).messageId);
      clock.advance();
    }

    const first = await service.getConversation(ALICE_ID, BOB_ID, { after: ids[0], limit: 2 });
    const second = await service.getConversation(ALICE_ID, BOB_ID, { after: ids[2], limit: 2 });
    const third = await service.getConversation(ALICE_ID, BOB_ID, { after: ids[4], limit: 2 });

    expect(first.messages.map((m) => m.messageId)).toEqual(ids.slice(1, 3).reverse());
    expect(first.hasMore).toBe(true);
    expect(second.messages.map((m) => m.messageId)).toEqual(ids.slice(3, 5).reverse());
    expect(second.hasMore).toBe(false);
    expect(third).toEqual({ messages: [], hasMore: false });
  });

  it("rejects a before cursor from another conversation with 400 before", async () => {
    const { service } = createTestService();
    const other = await send(service, ALICE_ID, CHAI_ID);

    await expectApiError(
      service.getConversation(ALICE_ID, BOB_ID, { before: other.messageId }),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "before",
    );
  });

  it("rejects an after cursor that does not exist with 400 after", async () => {
    const { service } = createTestService();

    await expectApiError(
      service.getConversation(ALICE_ID, BOB_ID, { after: "msg_missing" }),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "after",
    );
  });

  it("rejects before and after together with 400 after", async () => {
    const { service } = createTestService();
    const message = await send(service, ALICE_ID, BOB_ID);

    await expectApiError(
      service.getConversation(ALICE_ID, BOB_ID, {
        before: message.messageId,
        after: message.messageId,
      }),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "after",
    );
  });

  it("rejects a conversation with yourself with 400 userId", async () => {
    const { service } = createTestService();

    await expectApiError(
      service.getConversation(ALICE_ID, ALICE_ID, {}),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "userId",
    );
  });

  it("returns an empty list and hasMore false when there are no messages", async () => {
    const { service } = createTestService();

    expect(await service.getConversation(ALICE_ID, BOB_ID, {})).toEqual({
      messages: [],
      hasMore: false,
    });
  });

  it("fills replyTo with the original message", async () => {
    const { service } = createTestService();
    const original = await send(service, BOB_ID, ALICE_ID, "Coffee?");
    await service.replyToMessage(ALICE_ID, original.messageId, "Sure");

    const [reply] = (await service.getConversation(ALICE_ID, BOB_ID, {})).messages;

    expect(reply?.replyTo).toEqual({
      messageId: original.messageId,
      senderId: BOB_ID,
      text: "Coffee?",
    });
  });
});

describe("getUnreadMessages", () => {
  it("returns the unread messages sent to me with the sender and time sent, newest first", async () => {
    const { service, seed } = await createSeededService();

    const result = await service.getUnreadMessages(ALICE_ID, {});

    expect(result).toEqual({
      messages: [
        {
          messageId: seed.M4.messageId,
          sender: BOB,
          text: "There is a jazz night at Siam on Saturday.",
          sentAt: "2026-10-06T09:20:00.000Z",
        },
        {
          messageId: seed.M3.messageId,
          sender: BOB,
          text: "Are you free this weekend?",
          sentAt: "2026-10-06T09:10:00.000Z",
        },
        {
          messageId: seed.M2.messageId,
          sender: BOB,
          text: "Hi Alice",
          sentAt: "2026-10-06T09:00:00.000Z",
        },
      ],
      hasMore: false,
    });
  });

  it("returns an empty list for a user with no messages", async () => {
    const { service } = await createSeededService();

    expect(await service.getUnreadMessages(FAH_ID, {})).toEqual({ messages: [], hasMore: false });
  });

  it("leaves out read messages and messages I sent", async () => {
    const { service, clock } = createTestService();
    await send(service, BOB_ID, ALICE_ID, "read");
    await service.markConversationRead(ALICE_ID, BOB_ID);
    await send(service, ALICE_ID, BOB_ID, "mine");
    clock.advance();
    const unread = await send(service, BOB_ID, ALICE_ID, "unread");

    const { messages } = await service.getUnreadMessages(ALICE_ID, {});

    expect(messages.map((m) => m.messageId)).toEqual([unread.messageId]);
  });

  it("pages back with before with no gaps or duplicates", async () => {
    const { service } = createTestService();
    const sent: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      sent.push((await send(service, i % 2 === 0 ? BOB_ID : CHAI_ID, ALICE_ID, `m${i}`)).messageId);
    }

    const first = await service.getUnreadMessages(ALICE_ID, { limit: 3 });
    const second = await service.getUnreadMessages(ALICE_ID, {
      limit: 3,
      before: first.messages.at(-1)?.messageId,
    });

    expect(first.hasMore).toBe(true);
    expect(second.hasMore).toBe(false);
    expect([...first.messages, ...second.messages].map((m) => m.messageId)).toEqual(
      [...sent].reverse(),
    );
  });

  it("rejects a before cursor that was not sent to me with 400 before", async () => {
    const { service } = createTestService();
    const mine = await send(service, ALICE_ID, BOB_ID);

    await expectApiError(
      service.getUnreadMessages(ALICE_ID, { before: mine.messageId }),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "before",
    );
  });

  it("rejects limit 0 and 101 with 400 limit, accepts 1 and 100", async () => {
    const { service } = createTestService();
    await send(service, BOB_ID, ALICE_ID);

    for (const limit of [0, 101]) {
      await expectApiError(
        service.getUnreadMessages(ALICE_ID, { limit }),
        HTTP_BAD_REQUEST,
        "INVALID_INPUT",
        "limit",
      );
    }
    expect((await service.getUnreadMessages(ALICE_ID, { limit: 1 })).messages).toHaveLength(1);
    expect((await service.getUnreadMessages(ALICE_ID, { limit: 100 })).messages).toHaveLength(1);
  });

  it("uses a limit of 50 when none is sent", async () => {
    const { service } = createTestService();
    for (let i = 0; i <= DEFAULT_UNREAD_LIMIT; i += 1) {
      await send(service, BOB_ID, ALICE_ID, `m${i}`);
    }

    const result = await service.getUnreadMessages(ALICE_ID, {});

    expect(result.messages).toHaveLength(DEFAULT_UNREAD_LIMIT);
    expect(result.hasMore).toBe(true);
  });

  it("SY04: sends every time sent as UTC ISO 8601 ending in Z", async () => {
    const { service } = await createSeededService();

    const { messages } = await service.getUnreadMessages(ALICE_ID, {});

    expect(messages).toHaveLength(3);
    for (const message of messages) {
      expect(message.sentAt).toMatch(UTC_ISO_PATTERN);
    }
  });
});

describe("markConversationRead", () => {
  it("CH07: marks every message from bob as read and sets his unread count to 0", async () => {
    const { service } = await createSeededService();

    const result = await service.markConversationRead(ALICE_ID, BOB_ID);

    expect(result).toEqual({ userId: BOB_ID, unreadCount: 0 });
    expect(await unreadCountFrom(service, ALICE_ID, BOB_ID)).toBe(0);
    expect(await service.getUnreadMessages(ALICE_ID, {})).toEqual({ messages: [], hasMore: false });
    const { messages } = await service.getConversation(ALICE_ID, BOB_ID, {});
    expect(messages.every((m) => m.isRead)).toBe(true);
  });

  it("marks a message that arrived after the user last looked", async () => {
    const { service, clock } = await createSeededService();
    await service.markConversationRead(ALICE_ID, BOB_ID);
    clock.advance();
    await send(service, BOB_ID, ALICE_ID, "arrived later");
    expect(await unreadCountFrom(service, ALICE_ID, BOB_ID)).toBe(1);

    const result = await service.markConversationRead(ALICE_ID, BOB_ID);

    expect(result.unreadCount).toBe(0);
  });

  it("does not mark the messages I sent", async () => {
    const { service } = await createSeededService();
    await send(service, ALICE_ID, BOB_ID, "mine");

    await service.markConversationRead(ALICE_ID, BOB_ID);

    expect(await unreadCountFrom(service, BOB_ID, ALICE_ID)).toBe(1);
  });

  it("does not mark the messages of another conversation", async () => {
    const { service } = await createSeededService();
    await send(service, CHAI_ID, ALICE_ID, "new from Chai");

    await service.markConversationRead(ALICE_ID, BOB_ID);

    expect(await unreadCountFrom(service, ALICE_ID, CHAI_ID)).toBe(1);
  });

  it("is safe to repeat and keeps the first read time", async () => {
    const { service, repository, clock, seed } = await createSeededService();
    const first = await service.markConversationRead(ALICE_ID, BOB_ID);
    const firstReadAt = (await repository.findMessageById(seed.M2.messageId))?.readAt;
    clock.advance();

    const second = await service.markConversationRead(ALICE_ID, BOB_ID);

    expect(second).toEqual(first);
    expect(firstReadAt).toEqual(new Date(START_TIME));
    expect((await repository.findMessageById(seed.M2.messageId))?.readAt).toEqual(
      firstReadAt ?? null,
    );
  });

  it("answers with unread count 0 when there are no messages from that user", async () => {
    const { service } = await createSeededService();

    expect(await service.markConversationRead(ALICE_ID, FAH_ID)).toEqual({
      userId: FAH_ID,
      unreadCount: 0,
    });
  });

  it("rejects an unknown user with 404 USER_NOT_FOUND", async () => {
    const { service } = createTestService();

    await expectApiError(
      service.markConversationRead(ALICE_ID, UNKNOWN_USER_ID),
      HTTP_NOT_FOUND,
      "USER_NOT_FOUND",
    );
  });

  it("rejects yourself with 400 userId", async () => {
    const { service } = createTestService();

    await expectApiError(
      service.markConversationRead(ALICE_ID, ALICE_ID),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "userId",
    );
  });
});
