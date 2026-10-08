/*
 * In-memory photo upload claimer. Unit tests use it to pretend that `POST /photo-uploads` ran.
 * With no uploads added it knows no upload, which is what the running app uses until Tae's
 * RustFS version exists: every sign up then answers 400 on `photoUploadId`.
 */
import { profilePhotoKey, type ProfilePhotoExtension } from "../../data/photoKey";
import type { PhotoUploadClaimer } from "./photoUploadClaimer";

interface StoredUpload {
  extension: ProfilePhotoExtension;
  expiresAt: Date;
}

/** Settings for the in-memory claimer. `now` is replaceable in tests. */
export interface InMemoryPhotoUploadClaimerOptions {
  now?: () => Date;
}

/** The claimer plus ways to add uploads and look inside, for tests. */
export interface InMemoryPhotoUploadClaimer extends PhotoUploadClaimer {
  /**
   * Pretend that an upload was made.
   * @param uploadId - the upload ID the app will send
   * @param extension - the file extension of the photo
   * @param expiresAt - when the upload stops being usable
   */
  addUpload(uploadId: string, extension: ProfilePhotoExtension, expiresAt: Date): void;

  /** @returns true while the upload exists (not yet claimed) */
  hasUpload(uploadId: string): boolean;

  /** @returns the keys of the profile photo objects that exist, sorted */
  listProfilePhotoKeys(): string[];
}

/**
 * Create an in-memory photo upload claimer with no uploads.
 * @param options - an optional clock
 * @returns the claimer
 */
export function createInMemoryPhotoUploadClaimer(
  options: InMemoryPhotoUploadClaimerOptions = {},
): InMemoryPhotoUploadClaimer {
  const now = options.now ?? (() => new Date());
  const uploads = new Map<string, StoredUpload>();
  const profilePhotos = new Set<string>();

  return {
    addUpload(uploadId, extension, expiresAt) {
      uploads.set(uploadId, { extension, expiresAt });
    },

    hasUpload(uploadId) {
      return uploads.has(uploadId);
    },

    listProfilePhotoKeys() {
      return [...profilePhotos].sort();
    },

    async prepareProfilePhoto(uploadId) {
      const upload = uploads.get(uploadId);
      if (upload === undefined || upload.expiresAt <= now()) {
        return null;
      }
      const photoKey = profilePhotoKey(Bun.randomUUIDv7(), upload.extension);
      profilePhotos.add(photoKey);
      return { photoKey };
    },

    async finishClaim(uploadId) {
      uploads.delete(uploadId);
    },

    async cancelClaim(photoKey) {
      profilePhotos.delete(photoKey);
    },
  };
}
