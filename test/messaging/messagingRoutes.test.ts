/*
 * Route tests for the Messaging API through the real app, with a fake token check and the
 * in-memory Messaging Service: status codes, the error shape and the session check.
 */
import { describe, expect, it } from "bun:test";

import { createApp } from "../../src/app";
import type { SessionValidator } from "../../src/services/auth/sessionValidator";
import { createTestService, testConfig, UNKNOWN_USER_ID, USER_A, USER_B } from "./fixtures";

const TOKEN_A = "token-a";
const TOKEN_B = "token-b";
const BASE_URL = "http://localhost/api/v1";

interface ErrorBody {
  error: { code: string; message: string; field?: string };
}

const fakeValidator: SessionValidator = async (token) => {
  if (token === TOKEN_A) {
    return { userId: USER_A.userId };
  }
  return token === TOKEN_B ? { userId: USER_B.userId } : null;
};

function createTestApp() {
  const { service } = createTestService();
  return createApp(testConfig, { messagingService: service, sessionValidator: fakeValidator });
}

async function call(
  app: ReturnType<typeof createApp>,
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

async function sendAsA(app: ReturnType<typeof createApp>, text = "Hello") {
  const { body } = await call(app, "POST", `/conversations/${USER_B.userId}/messages`, {
    token: TOKEN_A,
    form: textForm(text),
  });
  return body as { messageId: string };
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

  it("sends a multipart message and answers 201 with the message", async () => {
    const app = createTestApp();

    const { status, body } = await call(app, "POST", `/conversations/${USER_B.userId}/messages`, {
      token: TOKEN_A,
      form: textForm("  Hi Ploy  "),
    });

    expect(status).toBe(201);
    expect(body).toMatchObject({
      senderId: USER_A.userId,
      receiverId: USER_B.userId,
      text: "Hi Ploy",
      replyTo: null,
    });
  });

  it("answers 400 with field text and only the error key for an empty message", async () => {
    const app = createTestApp();

    const { status, body } = await call(app, "POST", `/conversations/${USER_B.userId}/messages`, {
      token: TOKEN_A,
      form: textForm("   "),
    });

    expect(status).toBe(400);
    expectError(body, "INVALID_INPUT", "text");
  });

  it("answers 400 with field photos when a photos part is sent", async () => {
    const app = createTestApp();
    const form = textForm("Look");
    form.append("photos", new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" }));

    const { status, body } = await call(app, "POST", `/conversations/${USER_B.userId}/messages`, {
      token: TOKEN_A,
      form,
    });

    expect(status).toBe(400);
    expectError(body, "INVALID_INPUT", "photos");
  });

  it("answers 404 USER_NOT_FOUND when sending to an unknown user", async () => {
    const app = createTestApp();

    const { status, body } = await call(app, "POST", `/conversations/${UNKNOWN_USER_ID}/messages`, {
      token: TOKEN_A,
      form: textForm("Hello"),
    });

    expect(status).toBe(404);
    expectError(body, "USER_NOT_FOUND");
  });

  it("answers 201 for a JSON reply", async () => {
    const app = createTestApp();
    const original = await sendAsA(app, "Coffee?");

    const { status, body } = await call(app, "POST", `/messages/${original.messageId}/replies`, {
      token: TOKEN_B,
      json: { text: "Sure" },
    });

    expect(status).toBe(201);
    expect(body).toMatchObject({ senderId: USER_B.userId, receiverId: USER_A.userId });
  });

  it("answers 400 with field text when the reply has no text", async () => {
    const app = createTestApp();
    const original = await sendAsA(app);

    const { status, body } = await call(app, "POST", `/messages/${original.messageId}/replies`, {
      token: TOKEN_B,
      json: {},
    });

    expect(status).toBe(400);
    expectError(body, "INVALID_INPUT", "text");
  });

  it("answers 403 NOT_MESSAGE_SENDER when the receiver deletes", async () => {
    const app = createTestApp();
    const message = await sendAsA(app);

    const { status, body } = await call(app, "DELETE", `/messages/${message.messageId}`, {
      token: TOKEN_B,
    });

    expect(status).toBe(403);
    expectError(body, "NOT_MESSAGE_SENDER");
  });

  it("answers 204 with no body when the sender deletes", async () => {
    const app = createTestApp();
    const message = await sendAsA(app);

    const { status, body } = await call(app, "DELETE", `/messages/${message.messageId}`, {
      token: TOKEN_A,
    });

    expect(status).toBe(204);
    expect(body).toBeNull();
  });

  it("answers 400 with field unread when unread is not true", async () => {
    const app = createTestApp();

    for (const query of ["", "?unread=false"]) {
      const { status, body } = await call(app, "GET", `/messages${query}`, { token: TOKEN_A });

      expect(status).toBe(400);
      expectError(body, "INVALID_INPUT", "unread");
    }
  });

  it("answers 400 with field limit when limit is not a number", async () => {
    const app = createTestApp();

    const { status, body } = await call(
      app,
      "GET",
      `/conversations/${USER_B.userId}/messages?limit=abc`,
      { token: TOKEN_A },
    );

    expect(status).toBe(400);
    expectError(body, "INVALID_INPUT", "limit");
  });

  it("returns the chat list and marks a conversation as read", async () => {
    const app = createTestApp();
    const message = await sendAsA(app);

    const before = await call(app, "GET", "/conversations", { token: TOKEN_B });
    const marked = await call(app, "PATCH", `/conversations/${USER_A.userId}`, {
      token: TOKEN_B,
      json: { lastReadMessageId: message.messageId },
    });

    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ conversations: [{ user: USER_A, unreadCount: 1 }] });
    expect(marked.status).toBe(200);
    expect(marked.body).toEqual({ userId: USER_A.userId, unreadCount: 0 });
  });
});
