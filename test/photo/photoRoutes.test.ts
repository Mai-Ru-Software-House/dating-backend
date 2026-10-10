/*
 * Route tests for the photo endpoints through the whole app: the temporary upload and its
 * delete, the photo change, the photo serving, and the full sign up flow (upload, then
 * `photoUploadId` in POST /users) that used to need a real RustFS. All storage is in memory.
 */
import { describe, expect, it } from "bun:test";
import sharp from "sharp";

import { createApp } from "../../src/app";
import type { SessionValidator } from "../../src/services/auth/sessionValidator";
import { createMatchEngineClient } from "../../src/services/match/engineClient";
import { createInMemoryFavoritesReader } from "../../src/services/messaging/inMemoryMessageRepository";
import { createInMemoryProfilePhotoRepository } from "../../src/services/photo/inMemoryProfilePhotoRepository";
import { createInMemoryPhotoStore } from "../../src/services/photo/inMemoryPhotoStore";
import { createPhotoService } from "../../src/services/photo/photoService";
import { createRustFSPhotoUploads } from "../../src/services/photo/photoUploads";
import {
  createInMemoryProfileRepository,
  type InMemoryProfileRepository,
} from "../../src/services/profile/inMemoryProfileRepository";
import { createEngineMatchScorer } from "../../src/services/profile/matchScorer";
import { createProfileService } from "../../src/services/profile/profileService";
import type { SignUpInput } from "../../src/services/profile/profileTypes";
import { cheapHasher, createTestAuth } from "../auth/fixtures";
import { ALICE, createFakeEngine } from "../match/fixtures";
import { testConfig } from "../messaging/fixtures";
import { mintSignUp } from "../profile/fixtures";

const MS_PER_HOUR = 3_600_000;
const MS_PER_SECOND = 1_000;

/** A 400x300 PNG in memory: wide enough to force the center crop. */
async function widePng(): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await sharp({
    create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 100, b: 50 } },
  })
    .png()
    .toBuffer();
  // Copy onto a plain ArrayBuffer so the result is a valid Blob part.
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return bytes;
}

function createClock() {
  let moment = new Date("2026-10-10T10:00:00Z");
  return {
    now: () => moment,
    advance(ms: number) {
      moment = new Date(moment.getTime() + ms);
    },
  };
}

async function setup() {
  const clock = createClock();
  const store = createInMemoryPhotoStore({ now: clock.now });
  const uploads = createRustFSPhotoUploads({ store, secret: "test-secret", now: clock.now });
  const photos = createInMemoryProfilePhotoRepository([
    { userId: ALICE.userId, photoKey: "profile-photos/pho_old.jpg" },
  ]);
  await store.putPhoto("profile-photos/pho_old.jpg", new Uint8Array([9, 9]), "image/jpeg");

  const auth = await createTestAuth();
  const engine = createFakeEngine();
  const baseProfiles = createInMemoryProfileRepository({ profiles: [] });
  // Sign up also registers the user in the in-memory Auth repository, so the new access token
  // works (the app-level tests log in as the signed up user).
  const profiles: InMemoryProfileRepository = {
    ...baseProfiles,
    async createProfile(profile) {
      const result = await baseProfiles.createProfile(profile);
      if (result.status === "created") {
        auth.repository.addUser(profile.username, {
          userId: result.profile.userId,
          passwordHash: profile.passwordHash,
        });
      }
      return result;
    },
  };
  const places = {
    async findPlaceName(): Promise<string | null> {
      return "Bangkok, Pathum Wan";
    },
  };

  const photoService = createPhotoService({ store, uploads, photos });
  const profileService = createProfileService({
    profiles,
    hasher: cheapHasher,
    auth: auth.service,
    places,
    photoUploads: uploads.claimer,
    favorites: createInMemoryFavoritesReader({ [ALICE.userId]: [] }),
    scorer: createEngineMatchScorer({
      engine: createMatchEngineClient({
        baseUrl: "http://match-engine.test:8000",
        timeoutMs: 1000,
        fetch: engine.fetch,
      }),
      now: clock.now,
    }),
    now: clock.now,
  });

  const tokens: Record<string, string> = { "alice-token": ALICE.userId };
  const validator: SessionValidator = (token) =>
    tokens[token] !== undefined
      ? Promise.resolve({ userId: tokens[token] })
      : auth.service.validateSession(token);

  const app = createApp(testConfig, {
    photoService,
    profileService,
    sessionValidator: validator,
  });

  /** Send a multipart request with one file part named `photo` (or none). */
  async function upload(path: string, file?: BlobPart, token?: string, method = "POST") {
    const form = new FormData();
    if (file !== undefined) {
      form.append("photo", new File([file], "photo.png", { type: "image/png" }));
    }
    const headers: Record<string, string> = {};
    if (token !== undefined) {
      headers.authorization = `Bearer ${token}`;
    }
    const response = await app.handle(
      new Request(`http://localhost${path}`, { method, headers, body: form }),
    );
    const text = await response.text();
    return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
  }

  /** Send a request with the given headers and an optional JSON body. */
  async function call(
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: unknown,
  ) {
    if (body !== undefined) {
      headers = { ...headers, "content-type": "application/json" };
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

  /** Send a request as a logged in user. */
  async function callAs(method: string, path: string, token: string, body?: unknown) {
    return call(method, path, { authorization: `Bearer ${token}` }, body);
  }

  return { store, uploads, photos, clock, app, upload, call, callAs };
}

describe("POST /photo-uploads", () => {
  it("answers 201 with the upload and stores the cropped photo under uploads/", async () => {
    const ctx = await setup();
    const png = await widePng();
    const response = await ctx.upload("/api/v1/photo-uploads", png);
    expect(response.status).toBe(201);
    const uploadId = response.body.uploadId as string;
    expect(uploadId).toMatch(/^[0-9a-f-]{36}$/);
    // The 400x300 PNG comes back as a 300x300 JPEG: cropped, re-encoded, one hour from now.
    expect(response.body.expiresAt).toBe("2026-10-10T11:00:00.000Z");
    expect(response.body.deleteToken).toHaveLength(64);
    // The store also holds the seeded profile photo of alice from the setup.
    expect(ctx.store.listKeys()).toEqual(
      [`uploads/${uploadId}.jpg`, "profile-photos/pho_old.jpg"].sort(),
    );
    const stored = await ctx.store.getPhoto(`uploads/${uploadId}.jpg`);
    const meta = await sharp(stored!.bytes).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(300);
    expect(meta.height).toBe(300);
  });

  it("answers 400 with field photo when the file part is missing", async () => {
    const ctx = await setup();
    const response = await ctx.upload("/api/v1/photo-uploads");
    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: "INVALID_INPUT", field: "photo" });
  });

  it("answers 400 with field photo for a file that is not an image", async () => {
    const ctx = await setup();
    const response = await ctx.upload("/api/v1/photo-uploads", new TextEncoder().encode("nope"));
    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: "INVALID_INPUT", field: "photo" });
  });

  it("answers 400 with field photo for a file over 1 MB", async () => {
    const ctx = await setup();
    const tooBig = new Uint8Array(1_000_001);
    const response = await ctx.upload("/api/v1/photo-uploads", tooBig);
    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: "INVALID_INPUT", field: "photo" });
    // Nothing was stored: only the seeded profile photo of alice from the setup remains.
    expect(ctx.store.listKeys()).toEqual(["profile-photos/pho_old.jpg"]);
  });
});

describe("DELETE /photo-uploads/{uploadId}", () => {
  it("answers 204 and deletes the object with the right token", async () => {
    const ctx = await setup();
    const saved = await ctx.uploads.saveUpload(await widePng(), "image/jpeg");
    const path = `/api/v1/photo-uploads/${saved.uploadId}`;

    // Without the token header the delete answers 404, the same as a wrong token.
    expect((await ctx.call("DELETE", path)).status).toBe(404);
    const ok = await ctx.call("DELETE", path, { "x-delete-token": saved.deleteToken });
    expect(ok.status).toBe(204);
    expect(ctx.store.listKeys()).toEqual(["profile-photos/pho_old.jpg"]);
  });

  it("answers 404 UPLOAD_NOT_FOUND for an unknown ID and keeps the object on a wrong token", async () => {
    const ctx = await setup();
    const unknown = await ctx.call("DELETE", "/api/v1/photo-uploads/not-a-uuid");
    expect(unknown.body.error.code).toBe("UPLOAD_NOT_FOUND");

    const saved = await ctx.uploads.saveUpload(await widePng(), "image/jpeg");
    const wrong = await ctx.call("DELETE", `/api/v1/photo-uploads/${saved.uploadId}`, {
      "x-delete-token": "0".repeat(64),
    });
    expect(wrong.body.error.code).toBe("UPLOAD_NOT_FOUND");
    expect(ctx.store.listKeys()).toHaveLength(2); // the upload survives, plus the seeded photo
  });
});

describe("PUT /users/me/photo", () => {
  it("answers 401 without a token", async () => {
    const ctx = await setup();
    const png = await widePng();
    const response = await ctx.upload("/api/v1/users/me/photo", png, undefined, "PUT");
    expect(response.status).toBe(401);
  });

  it("swaps the photo: new object stored, old one deleted, key replaced", async () => {
    const ctx = await setup();
    const png = await widePng();
    const response = await ctx.upload("/api/v1/users/me/photo", png, "alice-token", "PUT");
    expect(response.status).toBe(200);
    const photoUrl = response.body.photoUrl as string;
    expect(photoUrl).toMatch(/^\/api\/v1\/photos\/[0-9a-f-]{36}$/);
    const newKey = `profile-photos/${photoUrl.split("/").pop()}.jpg`;

    expect(ctx.store.listKeys()).toEqual([newKey]); // the old object is gone
    expect(await ctx.photos.findPhotoKeyByPhotoId(photoUrl.split("/").pop()!)).toBe(newKey);
    const stored = await ctx.store.getPhoto(newKey);
    const meta = await sharp(stored!.bytes).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(300);
  });
});

describe("GET /photos/{photoId}", () => {
  it("answers 401 without a token", async () => {
    const ctx = await setup();
    const response = await ctx.call("GET", "/api/v1/photos/pho_old");
    expect(response.status).toBe(401);
  });

  it("serves the stored bytes with the stored content type and private caching", async () => {
    const ctx = await setup();
    const response = await ctx.app.handle(
      new Request("http://localhost/api/v1/photos/pho_old", {
        headers: { authorization: "Bearer alice-token" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("private");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([9, 9]));
  });

  it("answers 404 PHOTO_NOT_FOUND for an unknown photo", async () => {
    const ctx = await setup();
    const response = await ctx.callAs("GET", "/api/v1/photos/not-a-photo", "alice-token");
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("PHOTO_NOT_FOUND");
  });
});

describe("the full sign up flow", () => {
  it("upload, then POST /users with the photoUploadId, answers 201", async () => {
    const ctx = await setup();
    const uploaded = await ctx.upload("/api/v1/photo-uploads", await widePng());
    expect(uploaded.status).toBe(201);

    const signUp: Partial<SignUpInput> = mintSignUp();
    delete signUp.photoUploadId;
    const created = await ctx.call("POST", "/api/v1/users", undefined, {
      ...signUp,
      photoUploadId: uploaded.body.uploadId,
    });
    expect(created.status).toBe(201);
    expect(created.body.profile).toMatchObject({ username: "mint_01", displayName: "Mint" });
    expect(created.body.profile.photoUrl).toMatch(/^\/api\/v1\/photos\/[0-9a-f-]{36}$/);

    // The upload is claimed: the temporary object is gone, the profile photo object is stored
    // (plus the seeded photo of alice), and the signed up user can log in with the access
    // token the sign up answered.
    expect(ctx.store.listKeys()).toHaveLength(2);
    expect(ctx.store.listKeys()).toContain(
      `profile-photos/${created.body.profile.photoUrl.split("/").pop()}.jpg`,
    );
    expect(ctx.store.listKeys()).not.toContain(`uploads/${uploaded.body.uploadId}.jpg`);
    const me = await ctx.callAs("GET", "/api/v1/users/me", created.body.accessToken);
    expect(me.status).toBe(200);
    expect(me.body.photoUrl).toBe(created.body.profile.photoUrl);
  });

  it("an expired upload cannot be used for the sign up", async () => {
    const ctx = await setup();
    const uploaded = await ctx.upload("/api/v1/photo-uploads", await widePng());
    expect(uploaded.status).toBe(201);
    ctx.clock.advance(MS_PER_HOUR + MS_PER_SECOND);

    const signUp: Partial<SignUpInput> = mintSignUp();
    delete signUp.photoUploadId;
    const created = await ctx.call("POST", "/api/v1/users", undefined, {
      ...signUp,
      photoUploadId: uploaded.body.uploadId,
    });
    expect(created.status).toBe(400);
    expect(created.body.error).toMatchObject({ code: "INVALID_INPUT", field: "photoUploadId" });
  });
});
