/*
 * Photo functions (Tae): the service behind the four photo routes. It turns an uploaded file
 * into the stored photo (photoProcessor.ts), keeps the temporary sign up uploads
 * (photoUploads.ts), swaps the photo key of a user through the Data Access Layer and serves
 * the stored bytes of `GET /photos/{photoId}`.
 */
import { photoIdFromKey, profilePhotoKey } from "../../data/photoKey";
import { ApiError, ERROR_CODES } from "../../plugins/errors";
import { processProfilePhoto } from "./photoProcessor";
import type { PhotoStore } from "./photoStore";
import type { PhotoUpload, RustFSPhotoUploads } from "./photoUploads";
import { photoUrlFor } from "./photoUrl";
import type { ProfilePhotoRepository } from "./profilePhotoRepository";

const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;

/** A photo a route sends to the app, with the content type to answer with. */
export interface PhotoToServe {
  bytes: Uint8Array;
  contentType: string;
}

/** What the photo routes need from the service. */
export interface PhotoService {
  /**
   * Store an uploaded file as a temporary upload (checked and transformed first).
   * @param file - the `photo` part of the multipart body
   * @returns the upload with its expiry and delete token
   * @throws ApiError 400 INVALID_INPUT (field `photo`) when a rule fails
   */
  saveUpload(file: File): Promise<PhotoUpload>;
  /**
   * Remove a temporary upload with its delete token.
   * @param uploadId - the ID from the path
   * @param deleteToken - the token from the header, or undefined when the header is missing
   * @throws ApiError 404 UPLOAD_NOT_FOUND for an unknown or expired upload or a wrong token
   */
  deleteUpload(uploadId: string, deleteToken: string | undefined): Promise<void>;
  /**
   * Replace the profile photo of a user: store the new photo, swap the key in the database,
   * delete the old object after the swap.
   * @param userId - the logged in user
   * @param file - the `photo` part of the multipart body
   * @returns the new photo URL, for example `/api/v1/photos/0194a1b2`
   * @throws ApiError 400 INVALID_INPUT (field `photo`) when a rule fails, 401 UNAUTHENTICATED
   *   when the user no longer exists
   */
  changePhoto(userId: string, file: File): Promise<string>;
  /**
   * Read a profile photo for the app.
   * @param photoId - the ID from the path
   * @returns the stored bytes with their content type
   * @throws ApiError 404 PHOTO_NOT_FOUND for an unknown photo
   */
  getPhoto(photoId: string): Promise<PhotoToServe>;
}

/** What the Photo Service needs. */
export interface PhotoServiceOptions {
  /** The photo objects in RustFS. */
  store: PhotoStore;
  /** The temporary upload store (sign up flow). */
  uploads: RustFSPhotoUploads;
  /** The Data Access Layer (Chuan) for `users.photo_key`. */
  photos: ProfilePhotoRepository;
}

function photoNotFound(): ApiError {
  return new ApiError(HTTP_NOT_FOUND, ERROR_CODES.photoNotFound, "The photo does not exist.");
}

function sessionEnded(): ApiError {
  return new ApiError(
    HTTP_UNAUTHORIZED,
    ERROR_CODES.unauthenticated,
    "You need to log in to do this.",
  );
}

/**
 * Create the Photo Service.
 * @param options - the photo store, the upload store and the photo repository
 * @returns the service
 */
export function createPhotoService(options: PhotoServiceOptions): PhotoService {
  const { store, uploads, photos } = options;

  async function fileBytes(file: File): Promise<Uint8Array> {
    return new Uint8Array(await file.arrayBuffer());
  }

  return {
    async saveUpload(file) {
      const processed = await processProfilePhoto(await fileBytes(file));
      return uploads.saveUpload(processed.bytes, processed.contentType);
    },

    async deleteUpload(uploadId, deleteToken) {
      await uploads.deleteUpload(uploadId, deleteToken);
    },

    async changePhoto(userId, file) {
      const processed = await processProfilePhoto(await fileBytes(file));
      const newKey = profilePhotoKey(Bun.randomUUIDv7(), processed.extension);
      await store.putPhoto(newKey, processed.bytes, processed.contentType);
      const oldKey = await photos.replacePhotoKey(userId, newKey);
      if (oldKey === null) {
        // The user is gone (deleted between the session check and now): do not leave an object
        // nobody points at.
        await store.deletePhoto(newKey);
        throw sessionEnded();
      }
      if (oldKey !== newKey) {
        try {
          await store.deletePhoto(oldKey);
        } catch (error) {
          console.error("Could not delete the old photo after the swap:", error);
        }
      }
      return photoUrlFor(photoIdFromKey(newKey));
    },

    async getPhoto(photoId) {
      const key = await photos.findPhotoKeyByPhotoId(photoId);
      if (key === null) {
        throw photoNotFound();
      }
      const stored = await store.getPhoto(key);
      if (stored === null) {
        throw photoNotFound();
      }
      return stored;
    },
  };
}
