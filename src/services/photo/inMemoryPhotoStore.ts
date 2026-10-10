/*
 * In-memory photo store (Tae). Unit and route tests use it; the running app uses the RustFS
 * version in photoStore.ts. Objects live for the whole test, and the clock is replaceable so
 * the one-hour upload expiry is testable.
 */
import type { PhotoInfo, PhotoStore, StoredPhoto } from "./photoStore";

interface InMemoryObject {
  bytes: Uint8Array;
  contentType: string;
  lastModified: Date;
}

/** The photo store plus a way to look inside it, for tests. */
export interface InMemoryPhotoStore extends PhotoStore {
  /** @returns the object keys that exist, sorted */
  listKeys(): string[];
}

/** Settings for the in-memory store. */
export interface InMemoryPhotoStoreOptions {
  /** The clock that stamps new objects. Replaceable in tests. */
  now?: () => Date;
}

/**
 * Create an in-memory photo store.
 * @param options - an optional clock
 * @returns the store
 */
export function createInMemoryPhotoStore(
  options: InMemoryPhotoStoreOptions = {},
): InMemoryPhotoStore {
  const now = options.now ?? (() => new Date());
  const objects = new Map<string, InMemoryObject>();

  return {
    async putPhoto(objectKey, bytes, contentType) {
      objects.set(objectKey, {
        bytes: new Uint8Array(bytes),
        contentType,
        lastModified: now(),
      });
    },

    async getPhoto(objectKey): Promise<StoredPhoto | null> {
      const object = objects.get(objectKey);
      if (object === undefined) {
        return null;
      }
      return { bytes: new Uint8Array(object.bytes), contentType: object.contentType };
    },

    async headPhoto(objectKey): Promise<PhotoInfo | null> {
      const object = objects.get(objectKey);
      if (object === undefined) {
        return null;
      }
      return { lastModified: new Date(object.lastModified.getTime()) };
    },

    async deletePhoto(objectKey) {
      objects.delete(objectKey);
    },

    async copyPhoto(fromKey, toKey) {
      const object = objects.get(fromKey);
      if (object === undefined) {
        throw new Error(`The photo store has no object ${fromKey} to copy.`);
      }
      objects.set(toKey, {
        bytes: new Uint8Array(object.bytes),
        contentType: object.contentType,
        lastModified: now(),
      });
    },

    async listPhotos(prefix) {
      return [...objects.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, object]) => ({
          key,
          lastModified: new Date(object.lastModified.getTime()),
        }))
        .sort((a, b) => (a.key < b.key ? -1 : 1));
    },

    listKeys() {
      return [...objects.keys()].sort();
    },
  };
}
