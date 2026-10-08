/*
 * Route tests for favorites and notes through the whole app: status codes, the error shape and
 * the paths of the functional test plan (NT07, NT08).
 */
import { describe, expect, it } from "bun:test";

import { createApp } from "../../src/app";
import type { SessionValidator } from "../../src/services/auth/sessionValidator";
import {
  ALICE_ID,
  BOB_ID,
  CHAI_ID,
  DAN_ID,
  UNKNOWN_USER_ID,
  testConfig,
} from "../messaging/fixtures";
import { createTestFavoritesNotes } from "./fixtures";

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const MAX_NOTE_LENGTH = 500;

const TOKENS: Record<string, string> = { "alice-token": ALICE_ID, "bob-token": BOB_ID };
const fakeValidator: SessionValidator = async (token) => {
  const userId = TOKENS[token];
  return userId === undefined ? null : { userId };
};

function setup() {
  const { service } = createTestFavoritesNotes();
  const app = createApp(testConfig, {
    favoritesNotesService: service,
    sessionValidator: fakeValidator,
  });

  async function call(method: string, path: string, token?: string, body?: unknown) {
    const headers: Record<string, string> = {};
    if (token !== undefined) {
      headers.authorization = `Bearer ${token}`;
    }
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    const response = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const text = await response.text();
    return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
  }
  return { call };
}

describe("favorites routes", () => {
  it("answer 401 without a token", async () => {
    const { call } = setup();
    expect((await call("GET", "/api/v1/favorites")).status).toBe(HTTP_UNAUTHORIZED);
    expect((await call("PUT", `/api/v1/favorites/${BOB_ID}`)).status).toBe(HTTP_UNAUTHORIZED);
    expect((await call("DELETE", `/api/v1/favorites/${BOB_ID}`)).status).toBe(HTTP_UNAUTHORIZED);
  });

  it("GET /favorites lists alice's seeded favorite chai with name and photo", async () => {
    const { call } = setup();
    const { status, body } = await call("GET", "/api/v1/favorites", "alice-token");
    expect(status).toBe(HTTP_OK);
    expect(body.favorites).toHaveLength(1);
    expect(body.favorites[0].user).toEqual({
      userId: CHAI_ID,
      displayName: "Chai",
      photoId: "pho_chai",
    });
  });

  it("PUT /favorites/{userId} returns 200 and is safe to repeat (FV01, FV02)", async () => {
    const { call } = setup();
    const first = await call("PUT", `/api/v1/favorites/${BOB_ID}`, "alice-token");
    const second = await call("PUT", `/api/v1/favorites/${BOB_ID}`, "alice-token");
    expect(first.status).toBe(HTTP_OK);
    expect(second.status).toBe(HTTP_OK);
    expect(second.body).toEqual(first.body);
    const list = await call("GET", "/api/v1/favorites", "alice-token");
    expect(list.body.favorites).toHaveLength(2);
  });

  it("PUT answers 404 USER_NOT_FOUND for an unknown user and 400 for yourself", async () => {
    const { call } = setup();
    const unknown = await call("PUT", `/api/v1/favorites/${UNKNOWN_USER_ID}`, "alice-token");
    expect(unknown.status).toBe(HTTP_NOT_FOUND);
    expect(unknown.body.error.code).toBe("USER_NOT_FOUND");
    const self = await call("PUT", `/api/v1/favorites/${ALICE_ID}`, "alice-token");
    expect(self.status).toBe(HTTP_BAD_REQUEST);
    expect(self.body.error).toMatchObject({ code: "INVALID_INPUT", field: "userId" });
  });

  it("DELETE /favorites/{userId} returns 204, also when it was not a favorite (FV03)", async () => {
    const { call } = setup();
    expect((await call("DELETE", `/api/v1/favorites/${CHAI_ID}`, "alice-token")).status).toBe(
      HTTP_NO_CONTENT,
    );
    expect((await call("DELETE", `/api/v1/favorites/${DAN_ID}`, "alice-token")).status).toBe(
      HTTP_NO_CONTENT,
    );
    const list = await call("GET", "/api/v1/favorites", "alice-token");
    expect(list.body.favorites).toEqual([]);
  });
});

describe("notes routes", () => {
  it("answer 401 without a token", async () => {
    const { call } = setup();
    expect((await call("GET", `/api/v1/notes?aboutUserId=${BOB_ID}`)).status).toBe(
      HTTP_UNAUTHORIZED,
    );
    expect(
      (await call("POST", "/api/v1/notes", undefined, { aboutUserId: BOB_ID, text: "Hi" })).status,
    ).toBe(HTTP_UNAUTHORIZED);
    expect((await call("GET", "/api/v1/notes/people")).status).toBe(HTTP_UNAUTHORIZED);
  });

  it("POST /notes returns 201 with the note, and GET /notes lists it (NT01)", async () => {
    const { call } = setup();
    const created = await call("POST", "/api/v1/notes", "alice-token", {
      aboutUserId: BOB_ID,
      text: "Met at Siam Paragon, likes jazz",
    });
    expect(created.status).toBe(HTTP_CREATED);
    expect(Object.keys(created.body).sort()).toEqual([
      "aboutUserId",
      "createdAt",
      "noteId",
      "text",
    ]);
    const list = await call("GET", `/api/v1/notes?aboutUserId=${BOB_ID}`, "alice-token");
    expect(list.status).toBe(HTTP_OK);
    expect(list.body.notes).toEqual([created.body]);
  });

  it("GET /notes shows the seeded note about chai (NT04) and none about dan (NT03)", async () => {
    const { call } = setup();
    const chai = await call("GET", `/api/v1/notes?aboutUserId=${CHAI_ID}`, "alice-token");
    expect(chai.body.notes.map((note: { text: string }) => note.text)).toEqual([
      "Met at a cafe in Ari last month.",
    ]);
    const dan = await call("GET", `/api/v1/notes?aboutUserId=${DAN_ID}`, "alice-token");
    expect(dan.body).toEqual({ notes: [] });
  });

  it("GET /notes without aboutUserId answers 400 with the field", async () => {
    const { call } = setup();
    const { status, body } = await call("GET", "/api/v1/notes", "alice-token");
    expect(status).toBe(HTTP_BAD_REQUEST);
    expect(body.error).toMatchObject({ code: "INVALID_INPUT", field: "aboutUserId" });
  });

  it("NT05: an empty note and a note of spaces answer 400 on text", async () => {
    const { call } = setup();
    for (const text of ["", "   "]) {
      const { status, body } = await call("POST", "/api/v1/notes", "alice-token", {
        aboutUserId: BOB_ID,
        text,
      });
      expect(status).toBe(HTTP_BAD_REQUEST);
      expect(body.error).toMatchObject({ code: "INVALID_INPUT", field: "text" });
    }
  });

  it("NT06: 500 characters are saved and 501 answer 400 with the limit in the message", async () => {
    const { call } = setup();
    const ok = await call("POST", "/api/v1/notes", "alice-token", {
      aboutUserId: BOB_ID,
      text: "x".repeat(MAX_NOTE_LENGTH),
    });
    expect(ok.status).toBe(HTTP_CREATED);
    const tooLong = await call("POST", "/api/v1/notes", "alice-token", {
      aboutUserId: BOB_ID,
      text: "x".repeat(MAX_NOTE_LENGTH + 1),
    });
    expect(tooLong.status).toBe(HTTP_BAD_REQUEST);
    expect(tooLong.body.error.message).toContain("500");
  });

  it("answers 404 USER_NOT_FOUND for a note about an unknown user", async () => {
    const { call } = setup();
    const { status, body } = await call("POST", "/api/v1/notes", "alice-token", {
      aboutUserId: UNKNOWN_USER_ID,
      text: "Hello",
    });
    expect(status).toBe(HTTP_NOT_FOUND);
    expect(body.error.code).toBe("USER_NOT_FOUND");
  });

  it("GET /notes/people lists the people alice wrote about", async () => {
    const { call } = setup();
    const { status, body } = await call("GET", "/api/v1/notes/people", "alice-token");
    expect(status).toBe(HTTP_OK);
    expect(body.people).toHaveLength(1);
    expect(body.people[0]).toMatchObject({
      user: { userId: CHAI_ID },
      noteCount: 1,
      lastNote: { text: "Met at a cafe in Ari last month." },
    });
  });
});

describe("test plan paths /users/{userId}/notes", () => {
  it("NT07: POST /users/99999/notes answers 404", async () => {
    const { call } = setup();
    const { status, body } = await call(
      "POST",
      `/api/v1/users/${UNKNOWN_USER_ID}/notes`,
      "alice-token",
      { text: "Hello" },
    );
    expect(status).toBe(HTTP_NOT_FOUND);
    expect(body.error.code).toBe("USER_NOT_FOUND");
  });

  it("POST and GET /users/{userId}/notes work like /notes", async () => {
    const { call } = setup();
    const created = await call("POST", `/api/v1/users/${BOB_ID}/notes`, "alice-token", {
      text: "Likes jazz",
    });
    expect(created.status).toBe(HTTP_CREATED);
    expect(created.body.aboutUserId).toBe(BOB_ID);
    const list = await call("GET", `/api/v1/users/${BOB_ID}/notes`, "alice-token");
    expect(list.body.notes).toEqual([created.body]);
  });

  it("NT08: bob sees only his own notes about alice", async () => {
    const { call } = setup();
    await call("POST", `/api/v1/users/${BOB_ID}/notes`, "alice-token", {
      text: "Alice wrote this about Bob",
    });
    const forBob = await call("GET", `/api/v1/users/${ALICE_ID}/notes`, "bob-token");
    expect(forBob.status).toBe(HTTP_OK);
    expect(forBob.body).toEqual({ notes: [] });
    const peopleForBob = await call("GET", "/api/v1/notes/people", "bob-token");
    expect(peopleForBob.body).toEqual({ people: [] });
  });
});
