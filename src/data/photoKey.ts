/*
 * The link between the RustFS object key of a profile photo (`users.photo_key`) and the photo ID
 * that the API shows. Proposal (Chuan and Tae to confirm): the key is
 * `profile-photos/<photoId>.<extension>`.
 */
import { photoUrlFor } from "../services/photo/photoUrl";

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
