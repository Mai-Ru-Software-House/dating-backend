/*
 * Tests for the in-memory photo store: the behaviour every PhotoStore must have, so the
 * RustFS version can be checked against it.
 */
import { describe, expect, it } from "bun:test";

import { createInMemoryPhotoStore } from "../../src/services/photo/inMemoryPhotoStore";

const NOW = new Date("2026-10-10T10:00:00Z");
const LATER = new Date("2026-10-10T10:01:00Z");

describe("createInMemoryPhotoStore", () => {
  it("stores an object and reads it back", async () => {
    const store = createInMemoryPhotoStore();
    await store.putPhoto("profile-photos/a.jpg", new Uint8Array([1, 2, 3]), "image/jpeg");

    expect(await store.getPhoto("profile-photos/a.jpg")).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/jpeg",
    });
    expect(store.listKeys()).toEqual(["profile-photos/a.jpg"]);
  });

  it("answers null for an object that does not exist", async () => {
    const store = createInMemoryPhotoStore();
    expect(await store.getPhoto("profile-photos/none.jpg")).toBeNull();
    expect(await store.headPhoto("profile-photos/none.jpg")).toBeNull();
  });

  it("stamps a new object with the clock and replaces it on a second put", async () => {
    let moment = NOW;
    const store = createInMemoryPhotoStore({ now: () => moment });
    await store.putPhoto("uploads/a.jpg", new Uint8Array([1]), "image/jpeg");
    expect((await store.headPhoto("uploads/a.jpg"))?.lastModified).toEqual(NOW);

    moment = LATER;
    await store.putPhoto("uploads/a.jpg", new Uint8Array([2]), "image/jpeg");
    expect((await store.headPhoto("uploads/a.jpg"))?.lastModified).toEqual(LATER);
    expect((await store.getPhoto("uploads/a.jpg"))?.bytes).toEqual(new Uint8Array([2]));
  });

  it("deletes an object; deleting again does nothing", async () => {
    const store = createInMemoryPhotoStore();
    await store.putPhoto("uploads/a.jpg", new Uint8Array([1]), "image/jpeg");
    await store.deletePhoto("uploads/a.jpg");
    expect(await store.getPhoto("uploads/a.jpg")).toBeNull();
    await expect(store.deletePhoto("uploads/a.jpg")).resolves.toBeUndefined();
  });

  it("copies an object under a new key, stamped with the clock", async () => {
    let moment = NOW;
    const store = createInMemoryPhotoStore({ now: () => moment });
    await store.putPhoto("uploads/a.jpg", new Uint8Array([9]), "image/jpeg");
    moment = LATER;
    await store.copyPhoto("uploads/a.jpg", "profile-photos/b.jpg");

    expect(await store.getPhoto("profile-photos/b.jpg")).toEqual({
      bytes: new Uint8Array([9]),
      contentType: "image/jpeg",
    });
    expect((await store.headPhoto("profile-photos/b.jpg"))?.lastModified).toEqual(LATER);
    expect(store.listKeys()).toEqual(["profile-photos/b.jpg", "uploads/a.jpg"]);
  });

  it("refuses to copy an object that is not there", async () => {
    const store = createInMemoryPhotoStore();
    await expect(store.copyPhoto("uploads/none.jpg", "profile-photos/b.jpg")).rejects.toThrow();
  });

  it("lists only the objects under the prefix, sorted by key", async () => {
    const store = createInMemoryPhotoStore();
    await store.putPhoto("uploads/b.jpg", new Uint8Array([1]), "image/jpeg");
    await store.putPhoto("uploads/a.jpg", new Uint8Array([2]), "image/jpeg");
    await store.putPhoto("profile-photos/c.jpg", new Uint8Array([3]), "image/jpeg");

    expect(await store.listPhotos("uploads/")).toEqual([
      { key: "uploads/a.jpg", lastModified: expect.any(Date) },
      { key: "uploads/b.jpg", lastModified: expect.any(Date) },
    ]);
  });
});
