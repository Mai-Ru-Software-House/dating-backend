/*
 * Route tests for the Messaging API through the real app, with a fake token check and the
 * in-memory Messaging Service: status codes, JSON only bodies, the error shape, times in UTC and
 * the session check.
 */
import { describe, expect, it } from "bun:test";

import { createApp } from "../../src/app";
import type { SessionValidator } from "../../src/services/auth/sessionValidator";
import {
  ALICE,
  ALICE_ID,
  BOB_ID,
  createTestService,
  HANA_ID,
  testConfig,
  UNKNOWN_USER_ID,
  UTC_ISO_PATTERN,
} from "./fixtures";

const TOKEN_ALICE = "token-alice";
const TOKEN_BOB = "token-bob";
const TOKEN_HANA = "token-hana";
const BASE_URL = "http://localhost/api/v1";
const USER_IDS_BY_TOKEN = new Map([
  [TOKEN_ALICE, ALICE_ID],
  [TOKEN_BOB, BOB_ID],
  [TOKEN_HANA, HANA_ID],
]);
const MESSAGE_KEYS = ["isRead", "messageId", "receiverId", "replyTo", "senderId", "sentAt", "text"];

type TestApp = ReturnType<typeof createApp>;

interface ErrorBody {
  error: { code: string; message: string; field?: string };
}

interface MessageBody {
  messageId: string;
  senderId: string;
  receiverId: string;
  text: string;
  sentAt: string;
  isRead: boolean;
  replyTo: { messageId: string; senderId: string; text: string } | null;
}

const fakeValidator: SessionValidator = async (token) => {
  const userId = USER_IDS_BY_TOKEN.get(token);
  return userId === undefined ? null : { userId };
};

function createTestApp() {
  const { service } = createTestService();
  return createApp(testConfig, { messagingService: service, sessionValidator: fakeValidator });
}

async function call(
  app: TestApp,
  method: string,
  path: string,
  options: { token?: string; json?: unknown; form?: FormData } = {},
) {
  const headers = new Headers();
  if (options.token !== undefined) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }
  let body: BodyInit | undefined = options.form;
  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.json);
  }
  const response = await app.handle(new Request(`${BASE_URL}${path}`, { method, headers, body }));
  const text = await response.text();
  return { status: response.status, body: text === "" ? null : (JSON.parse(text) as unknown) };
}

function textForm(text: string): FormData {
  const form = new FormData();
  form.append("text", text);
  return form;
}

async function sendAsAlice(app: TestApp, text = "Hello", replyToMessageId?: string) {
  const { body } = await call(app, "POST", `/conversations/${BOB_ID}/messages`, {
    token: TOKEN_ALICE,
    json: { text, replyToMessageId },
  });
  return body as MessageBody;
}

function expectError(body: unknown, code: string, field?: string) {
  expect(Object.keys(body as object)).toEqual(["error"]);
  const error = (body as ErrorBody).error;
  expect(error.code).toBe(code);
  expect(error.field).toBe(field);
}

describe("Messaging routes", () => {
  it("answers 401 UNAUTHENTICATED without a token", async () => {
    const app = createTestApp();

    const { status, body } = await call(app, "GET", "/conversations");

    expect(status).toBe(401);
    expectError(body, "UNAUTHENTICATED");
  });

  it("answers 401 UNAUTHENTICATED with an unknown token", async () => {
    const app = createTestApp();

    const { status, body } = await call(app, "GET", "/messages?unread=true", { token: "nope" });

    expect(status).toBe(401);
    expectError(body, "UNAUTHENTICATED");
  });
});

describe("Send message route", () => {
  it("sends a JSON message and answers 201 with a message that has no photo or deleted fields", async () => {
    const app = createTestApp();

    const { status, body } = await call(app, "POST", `/conversations/${BOB_ID}/messages`, {
      token: TOKEN_ALICE,
      json: { text: "  Hi Bob  " },
    });

    expect(status).toBe(201);
    expect(body).toMatchObject({
      senderId: ALICE_ID,
      receiverId: BOB_ID,
      text: "Hi Bob",
      isRead: false,
      replyTo: null,
    });
    expect(Object.keys(body as object).sort()).toEqual(MESSAGE_KEYS);
    expect((body as MessageBody).sentAt).toMatch(UTC_ISO_PATTERN);
  });

  it("MS09: answers 201 and returns which message it answers when replyToMessageId is sent", async () => {
    const app = createTestApp();
    const original = await sendAsAlice(app, "Are you free this weekend?");

    const { status, body } = await call(app, "POST", `/conversations/${ALICE_ID}/messages`, {
      token: TOKEN_BOB,
      json: { text: "Yes, Saturday works", replyToMessageId: original.messageId },
    });

    expect(status).toBe(201);
    expect(body).toMatchObject({
      senderId: BOB_ID,
      receiverId: ALICE_ID,
      replyTo: {
        messageId: original.messageId,
        senderId: ALICE_ID,
        text: "Are you free this weekend?",
      },
    });
  });

  it("answers 404 MESSAGE_NOT_FOUND when replyToMessageId does not exist", async () => {
    const app = createTestApp();

    const { status, body } = await call(app, "POST", `/conversations/${BOB_ID}/messages`, {
      token: TOKEN_ALICE,
      json: { text: "Hi", replyToMessageId: "msg_missing" },
    });

    expect(status).toBe(404);
    expectError(body, "MESSAGE_NOT_FOUND");
  });

  it("answers 400 with field replyToMessageId when it is not a string", async () => {
    const app = createTestApp();

    const { status, body } = await call(app, "POST", `/conversations/${BOB_ID}/messages`, {
      token: TOKEN_ALICE,
      json: { text: "Hi", replyToMessageId: 5 },
    });

    expect(status).toBe(400);
    expectError(body, "INVALID_INPUT", "replyToMessageId");
  });

  it("MS05: answers 400 with field text and only the error key for empty and space only text", async () => {
    const app = createTestApp();

    for (const text of ["", "   "]) {
      const { status, body } = await call(app, "POST", `/conversations/${BOB_ID}/messages`, {
        token: TOKEN_ALICE,
        json: { text },
      });

      expect(status).toBe(400);
      expectError(body, "INVALID_INPUT", "text");
    }
  });

  it("answers 400 with field text when text is missing or is not a string", async () => {
    const app = createTestApp();

    for (const json of [{}, { text: 5 }, { text: null }]) {
      const { status, body } = await call(app, "POST", `/conversations/${BOB_ID}/messages`, {
        token: TOKEN_ALICE,
        json,
      });

      expect(status).toBe(400);
      expectError(body, "INVALID_INPUT", "text");
    }
  });

  it("answers 400 for a multipart request, because only JSON is accepted, and saves nothing", async () => {
    const app = createTestApp();
    const form = textForm("Look");
    form.append("photos", new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" }));

    const plain = await call(app, "POST", `/conversations/${BOB_ID}/messages`, {
      token: TOKEN_ALICE,
      form: textForm("Hello"),
    });
    const withPhoto = await call(app, "POST", `/conversations/${BOB_ID}/messages`, {
      token: TOKEN_ALICE,
      form,
    });
    const chats = await call(app, "GET", "/conversations", { token: TOKEN_BOB });

    expect(plain.status).toBe(400);
    expectError(plain.body, "INVALID_INPUT");
    expect(withPhoto.status).toBe(400);
    expectError(withPhoto.body, "INVALID_INPUT");
    expect(chats.body).toEqual({ conversations: [] });
  });

  it("answers 404 USER_NOT_FOUND when sending to an unknown user", async () => {
    const app = createTestApp();

    const { status, body } = await call(app, "POST", `/conversations/${UNKNOWN_USER_ID}/messages`, {
      token: TOKEN_ALICE,
      json: { text: "Hello" },
    });

    expect(status).toBe(404);
    expectError(body, "USER_NOT_FOUND");
  });
});

describe("Reply route", () => {
  it("answers 201 for a JSON reply, with the receiver taken from the original message", async () => {
    const app = createTestApp();
    const original = await sendAsAlice(app, "Coffee?");

    const { status, body } = await call(app, "POST", `/messages/${original.messageId}/replies`, {
      token: TOKEN_BOB,
      json: { text: "Sure" },
    });

    expect(status).toBe(201);
    expect(body).toMatchObject({
      senderId: BOB_ID,
      receiverId: ALICE_ID,
      replyTo: { messageId: original.messageId, text: "Coffee?" },
    });
  });

  it("answers 400 with field text when the reply has no text", async () => {
    const app = createTestApp();
    const original = await sendAsAlice(app);

    const { status, body } = await call(app, "POST", `/messages/${original.messageId}/replies`, {
      token: TOKEN_BOB,
      json: {},
    });

    expect(status).toBe(400);
    expectError(body, "INVALID_INPUT", "text");
  });

  it("answers 400 for a multipart reply", async () => {
    const app = createTestApp();
    const original = await sendAsAlice(app);

    const { status, body } = await call(app, "POST", `/messages/${original.messageId}/replies`, {
      token: TOKEN_BOB,
      form: textForm("Sure"),
    });

    expect(status).toBe(400);
    expectError(body, "INVALID_INPUT");
  });
});

describe("Message delete route", () => {
  it("is gone: DELETE /messages/{messageId} answers 404 NOT_FOUND and keeps the message", async () => {
    const app = createTestApp();
    const message = await sendAsAlice(app);

    const { status, body } = await call(app, "DELETE", `/messages/${message.messageId}`, {
      token: TOKEN_ALICE,
    });
    const chats = await call(app, "GET", "/conversations", { token: TOKEN_BOB });

    expect(status).toBe(404);
    expectError(body, "NOT_FOUND");
    expect(chats.body).toMatchObject({ conversations: [{ unreadCount: 1 }] });
  });
});

describe("Mark as read route", () => {
  it("CH07: answers 200 for { isRead: true } and sets the unread count to 0", async () => {
    const app = createTestApp();
    await sendAsAlice(app);
    await sendAsAlice(app, "Second");

    const before = await call(app, "GET", "/conversations", { token: TOKEN_BOB });
    const marked = await call(app, "PATCH", `/conversations/${ALICE_ID}`, {
      token: TOKEN_BOB,
      json: { isRead: true },
    });
    const after = await call(app, "GET", "/conversations", { token: TOKEN_BOB });
    const unread = await call(app, "GET", "/messages?unread=true", { token: TOKEN_BOB });

    expect(before.body).toMatchObject({ conversations: [{ user: ALICE, unreadCount: 2 }] });
    expect(marked.status).toBe(200);
    expect(marked.body).toEqual({ userId: ALICE_ID, unreadCount: 0 });
    expect(after.body).toMatchObject({ conversations: [{ user: ALICE, unreadCount: 0 }] });
    expect(unread.body).toEqual({ messages: [], hasMore: false });
  });

  it("answers 400 with field isRead for false, a string, a missing value and the old body", async () => {
    const app = createTestApp();
    const message = await sendAsAlice(app);
    const bodies = [
      { isRead: false },
      { isRead: "true" },
      {},
      { lastReadMessageId: message.messageId },
    ];

    for (const json of bodies) {
      const { status, body } = await call(app, "PATCH", `/conversations/${ALICE_ID}`, {
        token: TOKEN_BOB,
        json,
      });

      expect(status).toBe(400);
      expectError(body, "INVALID_INPUT", "isRead");
    }
    const chats = await call(app, "GET", "/conversations", { token: TOKEN_BOB });
    expect(chats.body).toMatchObject({ conversations: [{ unreadCount: 1 }] });
  });

  it("answers 400 for a multipart body", async () => {
    const app = createTestApp();
    await sendAsAlice(app);
    const form = new FormData();
    form.append("isRead", "true");

    const { status, body } = await call(app, "PATCH", `/conversations/${ALICE_ID}`, {
      token: TOKEN_BOB,
      form,
    });

    expect(status).toBe(400);
    expectError(body, "INVALID_INPUT");
  });

  it("answers 404 USER_NOT_FOUND for an unknown user and 400 userId for yourself", async () => {
    const app = createTestApp();

    const unknown = await call(app, "PATCH", `/conversations/${UNKNOWN_USER_ID}`, {
      token: TOKEN_BOB,
      json: { isRead: true },
    });
    const self = await call(app, "PATCH", `/conversations/${BOB_ID}`, {
      token: TOKEN_BOB,
      json: { isRead: true },
    });

    expect(unknown.status).toBe(404);
    expectError(unknown.body, "USER_NOT_FOUND");
    expect(self.status).toBe(400);
    expectError(self.body, "INVALID_INPUT", "userId");
  });
});

describe("Conversation and list routes", () => {
  it("CH05: opening a conversation marks the messages as read", async () => {
    const app = createTestApp();
    await sendAsAlice(app, "Hi Bob");

    const opened = await call(app, "GET", `/conversations/${ALICE_ID}/messages`, {
      token: TOKEN_BOB,
    });
    const chats = await call(app, "GET", "/conversations", { token: TOKEN_BOB });
    const unread = await call(app, "GET", "/messages?unread=true", { token: TOKEN_BOB });

    expect(opened.status).toBe(200);
    expect(opened.body).toMatchObject({ messages: [{ text: "Hi Bob", isRead: true }] });
    expect(chats.body).toMatchObject({ conversations: [{ unreadCount: 0 }] });
    expect(unread.body).toEqual({ messages: [], hasMore: false });
  });

  it("CH08: answers 404 USER_NOT_FOUND in the standard shape for a user that does not exist", async () => {
    const app = createTestApp();

    const { status, body } = await call(app, "GET", `/conversations/${UNKNOWN_USER_ID}/messages`, {
      token: TOKEN_ALICE,
    });

    expect(status).toBe(404);
    expectError(body, "USER_NOT_FOUND");
  });

  it("CH09: hana gets no messages from the chat of alice and bob and marks nothing as read", async () => {
    const app = createTestApp();
    await sendAsAlice(app, "Private");

    const hana = await call(app, "GET", `/conversations/${BOB_ID}/messages`, { token: TOKEN_HANA });
    const bobChats = await call(app, "GET", "/conversations", { token: TOKEN_BOB });

    expect(hana.status).toBe(200);
    expect(hana.body).toEqual({ messages: [], hasMore: false });
    expect(bobChats.body).toMatchObject({ conversations: [{ unreadCount: 1 }] });
  });

  it("SY04: sends every time as UTC ISO 8601 ending in Z", async () => {
    const app = createTestApp();
    await sendAsAlice(app);

    const chats = await call(app, "GET", "/conversations", { token: TOKEN_BOB });
    const unread = await call(app, "GET", "/messages?unread=true", { token: TOKEN_BOB });
    const opened = await call(app, "GET", `/conversations/${ALICE_ID}/messages`, {
      token: TOKEN_BOB,
    });

    const chatTime = (chats.body as { conversations: { lastMessage: { sentAt: string } }[] })
      .conversations[0]?.lastMessage.sentAt;
    const unreadTime = (unread.body as { messages: { sentAt: string }[] }).messages[0]?.sentAt;
    const openedTime = (opened.body as { messages: { sentAt: string }[] }).messages[0]?.sentAt;
    expect(chatTime).toMatch(UTC_ISO_PATTERN);
    expect(unreadTime).toMatch(UTC_ISO_PATTERN);
    expect(openedTime).toMatch(UTC_ISO_PATTERN);
  });

  it("answers 400 with field unread when unread is not true", async () => {
    const app = createTestApp();

    for (const query of ["", "?unread=false"]) {
      const { status, body } = await call(app, "GET", `/messages${query}`, {
        token: TOKEN_ALICE,
      });

      expect(status).toBe(400);
      expectError(body, "INVALID_INPUT", "unread");
    }
  });

  it("answers 400 with field limit when limit is not a number", async () => {
    const app = createTestApp();

    const { status, body } = await call(app, "GET", `/conversations/${BOB_ID}/messages?limit=abc`, {
      token: TOKEN_ALICE,
    });

    expect(status).toBe(400);
    expectError(body, "INVALID_INPUT", "limit");
  });
});
