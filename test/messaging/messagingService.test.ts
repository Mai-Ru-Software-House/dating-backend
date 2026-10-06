/*
 * Unit tests for the Messaging Service with in-memory data and a fixed clock (no database, no
 * network). Each rule is tested with correct input, incorrect input and boundary cases. The
 * test plan in docs/test-plans/messaging-unit-tests.md lists every test name below.
 */
import { describe, expect, it } from "bun:test";

import {
  DEFAULT_CONVERSATION_LIMIT,
  DEFAULT_UNREAD_LIMIT,
  MAX_MESSAGE_LENGTH,
  type MessagingService,
} from "../../src/services/messaging/messagingService";
import {
  createTestService,
  expectApiError,
  START_TIME,
  UNKNOWN_USER_ID,
  USER_A,
  USER_B,
  USER_C,
} from "./fixtures";

const A = USER_A.userId;
const B = USER_B.userId;
const C = USER_C.userId;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const EMOJI = "😀";

function send(service: MessagingService, from: string, to: string, text = "Hello") {
  return service.sendMessage(from, to, { text, hasPhotos: false });
}

describe("sendMessage", () => {
  it("stores a valid message and returns it with the server time in UTC", async () => {
    const { service } = createTestService();

    const message = await send(service, A, B, "Hi Ploy");

    expect(message).toEqual({
      messageId: message.messageId,
      senderId: A,
      receiverId: B,
      text: "Hi Ploy",
      sentAt: START_TIME,
      isRead: false,
      photoIds: [],
      isDeleted: false,
      replyTo: null,
    });
  });

  it("trims spaces around the text", async () => {
    const { service } = createTestService();

    const message = await send(service, A, B, "   Hi Ploy \n ");

    expect(message.text).toBe("Hi Ploy");
  });

  it("accepts text of exactly 1000 characters", async () => {
    const { service } = createTestService();

    const message = await send(service, A, B, "a".repeat(MAX_MESSAGE_LENGTH));

    expect(message.text).toHaveLength(MAX_MESSAGE_LENGTH);
  });

  it("accepts 1000 characters after trimming spaces at both ends", async () => {
    const { service } = createTestService();

    const message = await send(service, A, B, `  ${"a".repeat(MAX_MESSAGE_LENGTH)}  `);

    expect(message.text).toHaveLength(MAX_MESSAGE_LENGTH);
  });

  it("rejects text of 1001 characters with 400 text", async () => {
    const { service } = createTestService();

    await expectApiError(
      send(service, A, B, "a".repeat(MAX_MESSAGE_LENGTH + 1)),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "text",
    );
  });

  it("counts an emoji as one character at the limit", async () => {
    const { service } = createTestService();
    const atLimit = `${"a".repeat(MAX_MESSAGE_LENGTH - 1)}${EMOJI}`;

    const message = await send(service, A, B, atLimit);

    expect(message.text).toBe(atLimit);
    await expectApiError(
      send(service, A, B, `${atLimit}${EMOJI}`),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "text",
    );
  });

  it("rejects empty text with 400 text", async () => {
    const { service } = createTestService();

    await expectApiError(send(service, A, B, ""), HTTP_BAD_REQUEST, "INVALID_INPUT", "text");
  });

  it("rejects text with only spaces with 400 text", async () => {
    const { service } = createTestService();

    await expectApiError(send(service, A, B, " \t\n "), HTTP_BAD_REQUEST, "INVALID_INPUT", "text");
  });

  it("rejects a message with no text with 400 text", async () => {
    const { service } = createTestService();

    await expectApiError(
      service.sendMessage(A, B, { hasPhotos: false }),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "text",
    );
  });

  it("rejects a photos part with 400 photos", async () => {
    const { service, repository } = createTestService();

    await expectApiError(
      service.sendMessage(A, B, { text: "Look", hasPhotos: true }),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "photos",
    );
    expect(await repository.listConversationSummaries(A)).toEqual([]);
  });

  it("rejects a message to yourself with 400 userId", async () => {
    const { service } = createTestService();

    await expectApiError(send(service, A, A), HTTP_BAD_REQUEST, "INVALID_INPUT", "userId");
  });

  it("rejects a message to an unknown user with 404 USER_NOT_FOUND", async () => {
    const { service } = createTestService();

    await expectApiError(send(service, A, UNKNOWN_USER_ID), HTTP_NOT_FOUND, "USER_NOT_FOUND");
  });

  it("calls the notifier once with the stored message", async () => {
    const { service, notified } = createTestService();

    const message = await send(service, A, B);

    expect(notified).toHaveLength(1);
    expect(notified[0]?.messageId).toBe(message.messageId);
  });
});

describe("replyToMessage", () => {
  it("sends the reply to the sender when the receiver replies", async () => {
    const { service } = createTestService();
    const original = await send(service, A, B, "Coffee?");

    const reply = await service.replyToMessage(B, original.messageId, "Sure");

    expect(reply.senderId).toBe(B);
    expect(reply.receiverId).toBe(A);
  });

  it("sends the reply to the receiver when the sender replies to their own message", async () => {
    const { service } = createTestService();
    const original = await send(service, A, B, "Coffee?");

    const reply = await service.replyToMessage(A, original.messageId, "Or tea?");

    expect(reply.senderId).toBe(A);
    expect(reply.receiverId).toBe(B);
  });

  it("links the reply to the original message", async () => {
    const { service } = createTestService();
    const original = await send(service, A, B, "Coffee?");

    const reply = await service.replyToMessage(B, original.messageId, "  Sure  ");

    expect(reply.text).toBe("Sure");
    expect(reply.replyTo).toEqual({ messageId: original.messageId, senderId: A, text: "Coffee?" });
  });

  it("rejects a reply from a third person with 404 MESSAGE_NOT_FOUND", async () => {
    const { service } = createTestService();
    const original = await send(service, A, B);

    await expectApiError(
      service.replyToMessage(C, original.messageId, "Hi"),
      HTTP_NOT_FOUND,
      "MESSAGE_NOT_FOUND",
    );
  });

  it("rejects a reply to a message that does not exist with 404 MESSAGE_NOT_FOUND", async () => {
    const { service } = createTestService();

    await expectApiError(
      service.replyToMessage(A, "msg_missing", "Hi"),
      HTTP_NOT_FOUND,
      "MESSAGE_NOT_FOUND",
    );
  });

  it("rejects an empty reply with 400 text", async () => {
    const { service } = createTestService();
    const original = await send(service, A, B);

    await expectApiError(
      service.replyToMessage(B, original.messageId, "   "),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "text",
    );
  });

  it("rejects a reply of 1001 characters with 400 text", async () => {
    const { service } = createTestService();
    const original = await send(service, A, B);

    await expectApiError(
      service.replyToMessage(B, original.messageId, "a".repeat(MAX_MESSAGE_LENGTH + 1)),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "text",
    );
  });
});

describe("getChatList", () => {
  it("returns an empty list for a user with no messages", async () => {
    const { service } = createTestService();

    expect(await service.getChatList(A)).toEqual({ conversations: [] });
  });

  it("returns one row per other user with the last message in either direction", async () => {
    const { service, clock } = createTestService();
    await send(service, A, B, "first");
    clock.advance();
    const last = await send(service, B, A, "second");

    const { conversations } = await service.getChatList(A);

    expect(conversations).toEqual([
      {
        user: USER_B,
        isFavorite: false,
        lastMessage: {
          messageId: last.messageId,
          senderId: B,
          text: "second",
          sentAt: last.sentAt,
          isDeleted: false,
        },
        unreadCount: 1,
      },
    ]);
  });

  it("puts favorites first, then the newest last message first", async () => {
    const { service, clock } = createTestService({ [A]: [C] });
    await send(service, A, C, "old, but C is a favorite");
    clock.advance();
    await send(service, A, B, "newest");

    const { conversations } = await service.getChatList(A);

    expect(conversations.map((row) => row.user.userId)).toEqual([C, B]);
    expect(conversations.map((row) => row.isFavorite)).toEqual([true, false]);
  });

  it("orders rows with the same last message time by the larger message ID first", async () => {
    const { service } = createTestService();
    const toB = await send(service, A, B);
    const toC = await send(service, A, C);

    const { conversations } = await service.getChatList(A);

    expect(toC.sentAt).toBe(toB.sentAt);
    expect(conversations.map((row) => row.user.userId)).toEqual([C, B]);
  });

  it("counts only unread messages from the other user", async () => {
    const { service } = createTestService();
    await send(service, B, A, "one");
    await send(service, B, A, "two");
    await send(service, A, B, "mine");

    const [rowForA] = (await service.getChatList(A)).conversations;
    const [rowForB] = (await service.getChatList(B)).conversations;

    expect(rowForA?.unreadCount).toBe(2);
    expect(rowForB?.unreadCount).toBe(1);
  });

  it("shows a deleted last message with isDeleted true and no text", async () => {
    const { service } = createTestService();
    const message = await send(service, A, B, "oops");
    await service.deleteMessage(A, message.messageId);

    const [row] = (await service.getChatList(B)).conversations;

    expect(row?.lastMessage.isDeleted).toBe(true);
    expect(row?.lastMessage.text).toBeNull();
    expect(row?.unreadCount).toBe(0);
  });

  it("does not show a favorite with no messages", async () => {
    const { service } = createTestService({ [A]: [B, C] });
    await send(service, A, C);

    const { conversations } = await service.getChatList(A);

    expect(conversations.map((row) => row.user.userId)).toEqual([C]);
  });
});

describe("getConversation", () => {
  it("returns only messages between the two users, newest first", async () => {
    const { service, clock } = createTestService();
    const first = await send(service, A, B, "1");
    clock.advance();
    await send(service, A, C, "to C");
    clock.advance();
    const second = await send(service, B, A, "2");

    const page = await service.getConversation(A, B, {});

    expect(page.messages.map((m) => m.messageId)).toEqual([second.messageId, first.messageId]);
    expect(page.hasMore).toBe(false);
  });

  it("uses a limit of 30 when none is sent", async () => {
    const { service } = createTestService();
    for (let i = 0; i <= DEFAULT_CONVERSATION_LIMIT; i += 1) {
      await send(service, A, B, `m${i}`);
    }

    const page = await service.getConversation(A, B, {});

    expect(page.messages).toHaveLength(DEFAULT_CONVERSATION_LIMIT);
    expect(page.hasMore).toBe(true);
  });

  it("accepts limit 1 and limit 100", async () => {
    const { service } = createTestService();
    await send(service, A, B, "1");
    await send(service, A, B, "2");

    const smallest = await service.getConversation(A, B, { limit: 1 });
    const largest = await service.getConversation(A, B, { limit: 100 });

    expect(smallest.messages).toHaveLength(1);
    expect(smallest.hasMore).toBe(true);
    expect(largest.messages).toHaveLength(2);
    expect(largest.hasMore).toBe(false);
  });

  it("rejects limit 0, 101 and 2.5 with 400 limit", async () => {
    const { service } = createTestService();

    for (const limit of [0, 101, 2.5]) {
      await expectApiError(
        service.getConversation(A, B, { limit }),
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
      sent.push((await send(service, i % 2 === 0 ? A : B, i % 2 === 0 ? B : A, `m${i}`)).messageId);
      if (i % 2 === 1) {
        clock.advance();
      }
    }

    const seen: string[] = [];
    let before: string | undefined;
    let hasMore = true;
    while (hasMore) {
      const page = await service.getConversation(A, B, { before, limit: 3 });
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
      ids.push((await send(service, B, A, `m${i}`)).messageId);
      clock.advance();
    }

    const first = await service.getConversation(A, B, { after: ids[0], limit: 2 });
    const second = await service.getConversation(A, B, { after: ids[2], limit: 2 });
    const third = await service.getConversation(A, B, { after: ids[4], limit: 2 });

    expect(first.messages.map((m) => m.messageId)).toEqual(ids.slice(1, 3).reverse());
    expect(first.hasMore).toBe(true);
    expect(second.messages.map((m) => m.messageId)).toEqual(ids.slice(3, 5).reverse());
    expect(second.hasMore).toBe(false);
    expect(third).toEqual({ messages: [], hasMore: false });
  });

  it("rejects a before cursor from another conversation with 400 before", async () => {
    const { service } = createTestService();
    const other = await send(service, A, C);

    await expectApiError(
      service.getConversation(A, B, { before: other.messageId }),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "before",
    );
  });

  it("rejects an after cursor that does not exist with 400 after", async () => {
    const { service } = createTestService();

    await expectApiError(
      service.getConversation(A, B, { after: "msg_missing" }),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "after",
    );
  });

  it("rejects before and after together with 400 after", async () => {
    const { service } = createTestService();
    const message = await send(service, A, B);

    await expectApiError(
      service.getConversation(A, B, { before: message.messageId, after: message.messageId }),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "after",
    );
  });

  it("rejects a conversation with yourself with 400 userId", async () => {
    const { service } = createTestService();

    await expectApiError(
      service.getConversation(A, A, {}),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "userId",
    );
  });

  it("rejects an unknown user with 404 USER_NOT_FOUND", async () => {
    const { service } = createTestService();

    await expectApiError(
      service.getConversation(A, UNKNOWN_USER_ID, {}),
      HTTP_NOT_FOUND,
      "USER_NOT_FOUND",
    );
  });

  it("returns an empty list and hasMore false when there are no messages", async () => {
    const { service } = createTestService();

    expect(await service.getConversation(A, B, {})).toEqual({ messages: [], hasMore: false });
  });

  it("does not mark messages as read", async () => {
    const { service } = createTestService();
    await send(service, B, A);

    await service.getConversation(A, B, {});

    expect((await service.getChatList(A)).conversations[0]?.unreadCount).toBe(1);
  });

  it("fills replyTo with the original message", async () => {
    const { service } = createTestService();
    const original = await send(service, B, A, "Coffee?");
    await service.replyToMessage(A, original.messageId, "Sure");

    const [reply] = (await service.getConversation(A, B, {})).messages;

    expect(reply?.replyTo).toEqual({ messageId: original.messageId, senderId: B, text: "Coffee?" });
  });
});

describe("getUnreadMessages", () => {
  it("returns unread messages sent to me with the sender and time sent, newest first", async () => {
    const { service, clock } = createTestService();
    const fromB = await send(service, B, A, "from B");
    clock.advance();
    const fromC = await send(service, C, A, "from C");

    const result = await service.getUnreadMessages(A, {});

    expect(result).toEqual({
      messages: [
        { messageId: fromC.messageId, sender: USER_C, text: "from C", sentAt: fromC.sentAt },
        { messageId: fromB.messageId, sender: USER_B, text: "from B", sentAt: fromB.sentAt },
      ],
      hasMore: false,
    });
  });

  it("leaves out read messages and messages I sent", async () => {
    const { service, clock } = createTestService();
    const read = await send(service, B, A, "read");
    await service.markConversationRead(A, B, read.messageId);
    await send(service, A, B, "mine");
    clock.advance();
    const unread = await send(service, B, A, "unread");

    const { messages } = await service.getUnreadMessages(A, {});

    expect(messages.map((m) => m.messageId)).toEqual([unread.messageId]);
  });

  it("leaves out deleted messages", async () => {
    const { service } = createTestService();
    const message = await send(service, B, A);
    await service.deleteMessage(B, message.messageId);

    expect(await service.getUnreadMessages(A, {})).toEqual({ messages: [], hasMore: false });
  });

  it("pages back with before with no gaps or duplicates", async () => {
    const { service } = createTestService();
    const sent: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      sent.push((await send(service, i % 2 === 0 ? B : C, A, `m${i}`)).messageId);
    }

    const first = await service.getUnreadMessages(A, { limit: 3 });
    const second = await service.getUnreadMessages(A, {
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
    const mine = await send(service, A, B);

    await expectApiError(
      service.getUnreadMessages(A, { before: mine.messageId }),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "before",
    );
  });

  it("rejects limit 0 and 101 with 400 limit, accepts 1 and 100", async () => {
    const { service } = createTestService();
    await send(service, B, A);

    for (const limit of [0, 101]) {
      await expectApiError(
        service.getUnreadMessages(A, { limit }),
        HTTP_BAD_REQUEST,
        "INVALID_INPUT",
        "limit",
      );
    }
    expect((await service.getUnreadMessages(A, { limit: 1 })).messages).toHaveLength(1);
    expect((await service.getUnreadMessages(A, { limit: 100 })).messages).toHaveLength(1);
  });

  it("uses a limit of 50 when none is sent", async () => {
    const { service } = createTestService();
    for (let i = 0; i <= DEFAULT_UNREAD_LIMIT; i += 1) {
      await send(service, B, A, `m${i}`);
    }

    const result = await service.getUnreadMessages(A, {});

    expect(result.messages).toHaveLength(DEFAULT_UNREAD_LIMIT);
    expect(result.hasMore).toBe(true);
  });
});

describe("markConversationRead", () => {
  it("sets the unread count to zero and marks the messages as read", async () => {
    const { service } = createTestService();
    await send(service, B, A, "one");
    const last = await send(service, B, A, "two");

    const result = await service.markConversationRead(A, B, last.messageId);

    expect(result).toEqual({ userId: B, unreadCount: 0 });
    expect((await service.getChatList(A)).conversations[0]?.unreadCount).toBe(0);
    const { messages } = await service.getConversation(A, B, {});
    expect(messages.every((m) => m.isRead)).toBe(true);
  });

  it("keeps a message that arrives later unread", async () => {
    const { service, clock } = createTestService();
    const seen = await send(service, B, A, "seen");
    clock.advance();
    await send(service, B, A, "arrived later");

    const result = await service.markConversationRead(A, B, seen.messageId);

    expect(result.unreadCount).toBe(1);
  });

  it("marks only messages up to the given message, including one with the same time", async () => {
    const { service } = createTestService();
    const first = await send(service, B, A, "first");
    const sameTime = await send(service, B, A, "same time, later ID");

    const result = await service.markConversationRead(A, B, first.messageId);

    expect(result.unreadCount).toBe(1);
    const { messages } = await service.getUnreadMessages(A, {});
    expect(messages.map((m) => m.messageId)).toEqual([sameTime.messageId]);
  });

  it("changes nothing when an older message ID is sent", async () => {
    const { service, clock } = createTestService();
    const older = await send(service, B, A, "older");
    clock.advance();
    const newer = await send(service, B, A, "newer");
    await service.markConversationRead(A, B, newer.messageId);

    const result = await service.markConversationRead(A, B, older.messageId);

    expect(result.unreadCount).toBe(0);
    const { messages } = await service.getConversation(A, B, {});
    expect(messages.every((m) => m.isRead)).toBe(true);
  });

  it("is safe to repeat", async () => {
    const { service } = createTestService();
    const message = await send(service, B, A);

    const first = await service.markConversationRead(A, B, message.messageId);
    const second = await service.markConversationRead(A, B, message.messageId);

    expect(second).toEqual(first);
  });

  it("accepts the ID of a message I sent", async () => {
    const { service, clock } = createTestService();
    await send(service, B, A, "from B");
    clock.advance();
    const mine = await send(service, A, B, "my answer");

    const result = await service.markConversationRead(A, B, mine.messageId);

    expect(result.unreadCount).toBe(0);
  });

  it("rejects a message from another conversation with 400 lastReadMessageId", async () => {
    const { service } = createTestService();
    const other = await send(service, C, A);

    await expectApiError(
      service.markConversationRead(A, B, other.messageId),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "lastReadMessageId",
    );
  });

  it("rejects an unknown user with 404 USER_NOT_FOUND", async () => {
    const { service } = createTestService();

    await expectApiError(
      service.markConversationRead(A, UNKNOWN_USER_ID, "msg_000001"),
      HTTP_NOT_FOUND,
      "USER_NOT_FOUND",
    );
  });

  it("rejects yourself with 400 userId", async () => {
    const { service } = createTestService();

    await expectApiError(
      service.markConversationRead(A, A, "msg_000001"),
      HTTP_BAD_REQUEST,
      "INVALID_INPUT",
      "userId",
    );
  });
});

describe("deleteMessage", () => {
  it("lets the sender delete a message and hides its text everywhere", async () => {
    const { service } = createTestService();
    const original = await send(service, A, B, "secret");
    await service.replyToMessage(B, original.messageId, "What?");

    await service.deleteMessage(A, original.messageId);

    const { messages } = await service.getConversation(B, A, {});
    const deleted = messages.find((m) => m.messageId === original.messageId);
    const reply = messages.find((m) => m.messageId !== original.messageId);
    expect(deleted).toMatchObject({ isDeleted: true, text: null, photoIds: [] });
    expect(reply?.replyTo).toEqual({ messageId: original.messageId, senderId: A, text: null });
  });

  it("rejects a delete by the receiver with 403 NOT_MESSAGE_SENDER", async () => {
    const { service } = createTestService();
    const message = await send(service, A, B);

    await expectApiError(
      service.deleteMessage(B, message.messageId),
      HTTP_FORBIDDEN,
      "NOT_MESSAGE_SENDER",
    );
  });

  it("rejects a delete by a third person with 404 MESSAGE_NOT_FOUND", async () => {
    const { service } = createTestService();
    const message = await send(service, A, B);

    await expectApiError(
      service.deleteMessage(C, message.messageId),
      HTTP_NOT_FOUND,
      "MESSAGE_NOT_FOUND",
    );
  });

  it("rejects a message that does not exist with 404 MESSAGE_NOT_FOUND", async () => {
    const { service } = createTestService();

    await expectApiError(
      service.deleteMessage(A, "msg_missing"),
      HTTP_NOT_FOUND,
      "MESSAGE_NOT_FOUND",
    );
  });

  it("succeeds again on a second delete and keeps the first delete time", async () => {
    const { service, repository, clock } = createTestService();
    const message = await send(service, A, B);
    await service.deleteMessage(A, message.messageId);
    const firstDelete = (await repository.findMessageById(message.messageId))?.deletedAt;
    clock.advance();

    await service.deleteMessage(A, message.messageId);

    const stored = await repository.findMessageById(message.messageId);
    expect(stored?.deletedAt).toEqual(firstDelete ?? null);
    expect(stored?.deletedAt).not.toBeNull();
  });

  it("removes a deleted unread message from the unread count", async () => {
    const { service } = createTestService();
    await send(service, B, A, "keep");
    const removed = await send(service, B, A, "remove");

    await service.deleteMessage(B, removed.messageId);

    expect((await service.getChatList(A)).conversations[0]?.unreadCount).toBe(1);
  });
});
