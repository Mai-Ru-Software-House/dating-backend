/*
 * Photo functions (Tae): the temporary photo uploads of the sign up flow. The app uploads a
 * photo before the account exists (`POST /photo-uploads`); the object lives in RustFS under
 * `uploads/<uploadId>.jpg` for one hour, and a `deleteToken` (the HMAC of the upload ID with
 * the JWT secret) proves who may remove it, so the delete needs no session. Sign up turns the
 * upload into the profile photo (photoUploadClaimer.ts), and a sweep deletes the uploads that
 * expire unused (docs/decisions.md).
 */
import { isUuid } from "../../data/ids";
import { profilePhotoKey } from "../../data/photoKey";
import { ApiError, ERROR_CODES } from "../../plugins/errors";
import type { PhotoUploadClaimer } from "../profile/photoUploadClaimer";
import type { PhotoInfo, PhotoStore } from "./photoStore";

const HTTP_NOT_FOUND = 404;
/** The folder of the temporary uploads in the bucket. */
const UPLOADS_PREFIX = "uploads/";
const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
/** How long a temporary upload is usable (one hour). */
const UPLOAD_TTL_MS = SECONDS_PER_MINUTE * SECONDS_PER_MINUTE * MS_PER_SECOND;
/** A delete token is the hex of a 32 byte HMAC, two hex digits per byte. */
const HEX_DIGITS_PER_BYTE = 2;
/** The base of the hex digits of a delete token. */
const HEX_BASE = 16;

/** The answer of a stored temporary upload. */
export interface PhotoUpload {
  /** The ID the app sends back as `photoUploadId` at sign up. */
  uploadId: string;
  /** When the upload stops being usable (UTC). */
  expiresAt: Date;
  /** The token for `DELETE /photo-uploads/{uploadId}` (header `X-Delete-Token`). */
  deleteToken: string;
}

/** The temporary upload store on top of a PhotoStore. */
export interface RustFSPhotoUploads {
  /** The claimer the Profile Service calls during sign up. */
  claimer: PhotoUploadClaimer;
  /**
   * Store a processed photo as a temporary upload.
   * @param bytes - the photo bytes (already checked and transformed by the processor)
   * @param contentType - the content type to store with the object
   * @returns the upload with its expiry and delete token
   */
  saveUpload(bytes: Uint8Array, contentType: string): Promise<PhotoUpload>;
  /**
   * Remove a temporary upload with its delete token.
   * @param uploadId - the ID from the path
   * @param deleteToken - the token from the header, or undefined when the header is missing
   * @throws ApiError 404 UPLOAD_NOT_FOUND for an unknown or expired upload or a wrong token
   */
  deleteUpload(uploadId: string, deleteToken: string | undefined): Promise<void>;
  /**
   * Delete the uploads that are older than one hour.
   * @returns how many uploads were deleted
   */
  sweepExpired(): Promise<number>;
}

/** Settings for the temporary upload store. */
export interface RustFSPhotoUploadsOptions {
  /** The photo store the uploads live in. */
  store: PhotoStore;
  /** The secret for the delete tokens (the JWT secret). */
  secret: string;
  /** The clock. Replaceable in tests. */
  now?: () => Date;
}

/** The sweep runs this many minutes apart. */
const SWEEP_MINUTES = 5;
/** How often the background sweep looks for expired uploads. */
export const UPLOAD_SWEEP_INTERVAL_MS = SWEEP_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND;

/**
 * Start the background sweep that deletes the temporary uploads older than one hour. The
 * interval keeps running until the process exits (the sweep needs no shutdown step), and a
 * failing run is logged and retried on the next tick.
 * @param sweepExpired - the sweep of an upload store
 * @param options - the interval in milliseconds (replaceable in tests)
 * @returns a function that stops the sweep
 */
export function startUploadSweep(
  sweepExpired: () => Promise<number>,
  options: { intervalMs?: number } = {},
): () => void {
  const intervalMs = options.intervalMs ?? UPLOAD_SWEEP_INTERVAL_MS;
  let isRunning = false;
  const timer = setInterval(() => {
    if (isRunning) {
      return;
    }
    isRunning = true;
    void (async () => {
      try {
        await sweepExpired();
      } catch (error) {
        console.error("The expired upload sweep failed:", error);
      } finally {
        isRunning = false;
      }
    })();
  }, intervalMs);
  return () => clearInterval(timer);
}

function uploadNotFound(): ApiError {
  return new ApiError(
    HTTP_NOT_FOUND,
    ERROR_CODES.uploadNotFound,
    "The photo upload does not exist or has expired.",
  );
}

function isUploadExpired(info: PhotoInfo, moment: Date): boolean {
  return info.lastModified.getTime() + UPLOAD_TTL_MS <= moment.getTime();
}

/**
 * Build the delete token of an upload: the hex of the HMAC of the upload ID with the secret.
 * @param uploadId - the ID to sign
 * @param secret - the shared secret
 * @returns the token, 64 hex characters
 */
async function deleteTokenFor(uploadId: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(uploadId));
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(HEX_BASE).padStart(HEX_DIGITS_PER_BYTE, "0"))
    .join("");
}

/**
 * Compare two tokens so the position of the first difference does not change the running time.
 * @param expected - the token the server computed
 * @param actual - the token the client sent
 * @returns true when they are equal
 */
function tokensEqual(expected: string, actual: string): boolean {
  if (expected.length === 0 || expected.length !== actual.length) {
    return false;
  }
  let difference = 0;
  for (let i = 0; i < expected.length; i += 1) {
    difference |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  }
  return difference === 0;
}

/**
 * Create the temporary upload store of the sign up flow.
 * @param options - the photo store, the secret and an optional clock
 * @returns the store with its claimer
 */
export function createRustFSPhotoUploads(options: RustFSPhotoUploadsOptions): RustFSPhotoUploads {
  const { store, secret } = options;
  const now = options.now ?? (() => new Date());

  const uploadKeyOf = (uploadId: string) => `${UPLOADS_PREFIX}${uploadId}.jpg`;

  async function findUsableUpload(uploadId: string): Promise<PhotoInfo | null> {
    if (!isUuid(uploadId)) {
      return null;
    }
    const info = await store.headPhoto(uploadKeyOf(uploadId));
    if (info === null || isUploadExpired(info, now())) {
      return null;
    }
    return info;
  }

  async function saveUpload(bytes: Uint8Array, contentType: string): Promise<PhotoUpload> {
    const uploadId = Bun.randomUUIDv7();
    const objectKey = uploadKeyOf(uploadId);
    await store.putPhoto(objectKey, bytes, contentType);
    const info = await store.headPhoto(objectKey);
    const storedAt = info === null ? now() : info.lastModified;
    return {
      uploadId,
      expiresAt: new Date(storedAt.getTime() + UPLOAD_TTL_MS),
      deleteToken: await deleteTokenFor(uploadId, secret),
    };
  }

  async function deleteUpload(uploadId: string, token: string | undefined): Promise<void> {
    const expected = await deleteTokenFor(uploadId, secret);
    if (!tokensEqual(expected, token ?? "")) {
      throw uploadNotFound();
    }
    if ((await findUsableUpload(uploadId)) === null) {
      throw uploadNotFound();
    }
    await store.deletePhoto(uploadKeyOf(uploadId));
  }

  const claimer: PhotoUploadClaimer = {
    async prepareProfilePhoto(uploadId) {
      if ((await findUsableUpload(uploadId)) === null) {
        return null;
      }
      const photoKey = profilePhotoKey(Bun.randomUUIDv7(), "jpg");
      await store.copyPhoto(uploadKeyOf(uploadId), photoKey);
      return { photoKey };
    },

    async finishClaim(uploadId) {
      await store.deletePhoto(uploadKeyOf(uploadId));
    },

    async cancelClaim(photoKey) {
      await store.deletePhoto(photoKey);
    },
  };

  async function sweepExpired(): Promise<number> {
    const objects = await store.listPhotos(UPLOADS_PREFIX);
    let removed = 0;
    for (const object of objects) {
      if (isUploadExpired(object, now())) {
        await store.deletePhoto(object.key);
        removed += 1;
      }
    }
    return removed;
  }

  return { claimer, saveUpload, deleteUpload, sweepExpired };
}
