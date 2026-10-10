/*
 * Tests for the temporary photo upload store (photoUploads.ts): the one-hour expiry, the
 * delete token, the claim flow sign up uses, and the sweep that deletes the uploads nobody
 * used. The clock is a mutable date so expiry is testable without waiting.
 */
import { describe, expect, it } from "bun:test";

import { isUuid } from "../../src/data/ids";
import {
  createInMemoryPhotoStore,
  type InMemoryPhotoStore,
} from "../../src/services/photo/inMemoryPhotoStore";
import {
  createRustFSPhotoUploads,
  startUploadSweep,
  UPLOAD_SWEEP_INTERVAL_MS,
} from "../../src/services/photo/photoUploads";

const MS_PER_HOUR = 3_600_000;
const MS_PER_SECOND = 1_000;

function createClock() {
  let moment = new Date("2026-10-10T10:00:00Z");
  return {
    now: () => moment,
    set(value: Date) {
      moment = value;
    },
    advance(ms: number) {
      moment = new Date(moment.getTime() + ms);
    },
  };
}

function createUploads(clock: ReturnType<typeof createClock>): {
  uploads: ReturnType<typeof createRustFSPhotoUploads>;
  store: InMemoryPhotoStore;
} {
  const store = createInMemoryPhotoStore({ now: clock.now });
  const uploads = createRustFSPhotoUploads({ store, secret: "test-secret", now: clock.now });
  return { uploads, store };
}

describe("saveUpload", () => {
  it("stores the photo under the uploads folder and answers id, expiry and token", async () => {
    const clock = createClock();
    const { uploads, store } = createUploads(clock);

    const upload = await uploads.saveUpload(new Uint8Array([1, 2, 3]), "image/jpeg");

    expect(isUuid(upload.uploadId)).toBe(true);
    expect(upload.expiresAt).toEqual(new Date(clock.now().getTime() + MS_PER_HOUR));
    expect(upload.deleteToken).toHaveLength(64);
    expect(store.listKeys()).toEqual([`uploads/${upload.uploadId}.jpg`]);
  });

  it("a token made with one secret does not work with another", async () => {
    const clock = createClock();
    const store = createInMemoryPhotoStore({ now: clock.now });
    const withSecretOne = createRustFSPhotoUploads({ store, secret: "one", now: clock.now });
    const withSecretTwo = createRustFSPhotoUploads({ store, secret: "two", now: clock.now });

    const upload = await withSecretOne.saveUpload(new Uint8Array([1]), "image/jpeg");

    // The same upload seen through the other secret: its token does not match, so the delete
    // answers UPLOAD_NOT_FOUND. The right secret still works.
    await expect(
      withSecretTwo.deleteUpload(upload.uploadId, upload.deleteToken),
    ).rejects.toMatchObject({ status: 404, code: "UPLOAD_NOT_FOUND" });
    await withSecretOne.deleteUpload(upload.uploadId, upload.deleteToken);
    expect(store.listKeys()).toEqual([]);
  });
});

describe("deleteUpload", () => {
  it("removes the object with the right token", async () => {
    const clock = createClock();
    const { uploads, store } = createUploads(clock);
    const upload = await uploads.saveUpload(new Uint8Array([1]), "image/jpeg");

    await uploads.deleteUpload(upload.uploadId, upload.deleteToken);

    expect(store.listKeys()).toEqual([]);
  });

  it("answers UPLOAD_NOT_FOUND for a wrong token", async () => {
    const clock = createClock();
    const { uploads } = createUploads(clock);
    const upload = await uploads.saveUpload(new Uint8Array([1]), "image/jpeg");

    await expect(uploads.deleteUpload(upload.uploadId, "0".repeat(64))).rejects.toMatchObject({
      status: 404,
      code: "UPLOAD_NOT_FOUND",
    });
  });

  it("answers UPLOAD_NOT_FOUND for an unknown or non-UUID ID", async () => {
    const clock = createClock();
    const { uploads } = createUploads(clock);
    await expect(uploads.deleteUpload("nope", "0".repeat(64))).rejects.toMatchObject({
      status: 404,
      code: "UPLOAD_NOT_FOUND",
    });
  });

  it("answers UPLOAD_NOT_FOUND for an expired upload even with the right token", async () => {
    const clock = createClock();
    const { uploads } = createUploads(clock);
    const upload = await uploads.saveUpload(new Uint8Array([1]), "image/jpeg");
    clock.advance(MS_PER_HOUR + MS_PER_SECOND);

    await expect(uploads.deleteUpload(upload.uploadId, upload.deleteToken)).rejects.toMatchObject({
      status: 404,
      code: "UPLOAD_NOT_FOUND",
    });
  });
});

describe("the claimer sign up uses", () => {
  it("copies a usable upload to a new profile key and keeps the upload", async () => {
    const clock = createClock();
    const { uploads, store } = createUploads(clock);
    const upload = await uploads.saveUpload(new Uint8Array([7]), "image/jpeg");

    const prepared = await uploads.claimer.prepareProfilePhoto(upload.uploadId);

    expect(prepared).not.toBeNull();
    const key = prepared?.photoKey ?? "";
    expect(key.startsWith("profile-photos/")).toBe(true);
    expect(key.endsWith(".jpg")).toBe(true);
    expect(store.listKeys()).toEqual([`uploads/${upload.uploadId}.jpg`, key].sort());
    expect((await store.getPhoto(key))?.bytes).toEqual(new Uint8Array([7]));
  });

  it("answers null for an unknown, non-UUID or expired upload", async () => {
    const clock = createClock();
    const { uploads } = createUploads(clock);
    expect(await uploads.claimer.prepareProfilePhoto("nope")).toBeNull();

    const upload = await uploads.saveUpload(new Uint8Array([1]), "image/jpeg");
    clock.advance(MS_PER_HOUR + MS_PER_SECOND);
    expect(await uploads.claimer.prepareProfilePhoto(upload.uploadId)).toBeNull();
  });

  it("finishClaim deletes the upload; a second claim then fails", async () => {
    const clock = createClock();
    const { uploads } = createUploads(clock);
    const upload = await uploads.saveUpload(new Uint8Array([1]), "image/jpeg");
    const prepared = await uploads.claimer.prepareProfilePhoto(upload.uploadId);
    expect(prepared).not.toBeNull();

    await uploads.claimer.finishClaim(upload.uploadId);
    expect(await uploads.claimer.prepareProfilePhoto(upload.uploadId)).toBeNull();
  });

  it("cancelClaim deletes the prepared profile object", async () => {
    const clock = createClock();
    const { uploads, store } = createUploads(clock);
    const upload = await uploads.saveUpload(new Uint8Array([1]), "image/jpeg");
    const prepared = await uploads.claimer.prepareProfilePhoto(upload.uploadId);
    expect(prepared).not.toBeNull();

    await uploads.claimer.cancelClaim(prepared!.photoKey);
    expect(store.listKeys()).toEqual([`uploads/${upload.uploadId}.jpg`]);
  });
});

describe("sweepExpired", () => {
  it("deletes only the uploads older than one hour", async () => {
    const clock = createClock();
    const { uploads } = createUploads(clock);
    const old = await uploads.saveUpload(new Uint8Array([1]), "image/jpeg");
    clock.advance(MS_PER_HOUR + MS_PER_SECOND);
    const fresh = await uploads.saveUpload(new Uint8Array([2]), "image/jpeg");

    expect(await uploads.sweepExpired()).toBe(1);
    expect((await uploads.claimer.prepareProfilePhoto(old.uploadId)) === null).toBe(true);
    expect(await uploads.claimer.prepareProfilePhoto(fresh.uploadId)).not.toBeNull();
  });
});

describe("startUploadSweep", () => {
  it("calls the sweep on the interval and stops when asked", async () => {
    const clock = createClock();
    const { uploads } = createUploads(clock);
    let runs = 0;
    const stop = startUploadSweep(
      async () => {
        runs += 1;
        return uploads.sweepExpired();
      },
      { intervalMs: 10 },
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    stop();
    const runsAfterStop = runs;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(runsAfterStop).toBeGreaterThanOrEqual(2);
    expect(runs).toBe(runsAfterStop);
  });

  it("uses a five minute interval by default", () => {
    expect(UPLOAD_SWEEP_INTERVAL_MS).toBe(5 * MS_PER_SECOND * 60);
  });
});
