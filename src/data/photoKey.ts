/*
 * The link between the RustFS object key of a profile photo (`users.photo_key`) and the photo ID
 * that the API shows. The key is `profile-photos/<photoId>.<extension>` (Chuan, with Tae): the
 * photo ID is a UUID, and `users.photo_key` is unique, so one photo belongs to one user.
 */
import { photoUrlFor } from "../services/photo/photoUrl";

/** Folder of the profile photos in the RustFS bucket. */
export const PROFILE_PHOTO_PREFIX = "profile-photos/";

/** The file extensions a stored profile photo can have (test plan A5), always in lowercase. */
export const PROFILE_PHOTO_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const;

/** One of the allowed profile photo extensions. */
export type ProfilePhotoExtension = (typeof PROFILE_PHOTO_EXTENSIONS)[number];

/**
 * Build the object key of a profile photo.
 * @param photoId - the photo ID (a UUID)
 * @param extension - the file extension, without the dot
 * @returns for example `profile-photos/0194a1b2-8d11-7a22-9b33-c4d5e6f7a8b9.jpg`
 */
export function profilePhotoKey(photoId: string, extension: ProfilePhotoExtension): string {
  return `${PROFILE_PHOTO_PREFIX}${photoId.toLowerCase()}.${extension}`;
}

/**
 * List every key a photo ID can have, one per allowed extension. Looking these up as exact
 * values uses the unique index on `users.photo_key`.
 * @param photoId - the photo ID (a UUID)
 * @returns the four possible keys
 */
export function possibleProfilePhotoKeys(photoId: string): string[] {
  return PROFILE_PHOTO_EXTENSIONS.map((extension) => profilePhotoKey(photoId, extension));
}

/**
 * Turn the RustFS object key of a profile photo into its photo ID.
 * @param photoKey - the object key stored in `users.photo_key`
 * @returns the file name without its extension
 */
export function photoIdFromKey(photoKey: string): string {
  const fileName = photoKey.slice(photoKey.lastIndexOf("/") + 1);
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/**
 * Turn the RustFS object key of a profile photo into the path the API sends.
 * @param photoKey - the object key stored in `users.photo_key`
 * @returns the path, for example `/api/v1/photos/0194f1c2`
 */
export function photoUrlFromKey(photoKey: string): string {
  return photoUrlFor(photoIdFromKey(photoKey));
}
