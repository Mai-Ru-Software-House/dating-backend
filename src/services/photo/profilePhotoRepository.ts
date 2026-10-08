/*
 * What the Photo functions (Tae) need from the Data Access Layer (Chuan): find the stored key of
 * a profile photo for `GET /photos/{photoId}`, and swap a user's photo for `PUT /users/me/photo`.
 * Keys are `profile-photos/<photoId>.<extension>` (src/data/photoKey.ts). The in-memory version
 * is in inMemoryProfilePhotoRepository.ts and the Prisma version in
 * src/data/prismaProfilePhotoRepository.ts.
 */

/** Reads and replaces `users.photo_key`. */
export interface ProfilePhotoRepository {
  /**
   * Find the object key of a profile photo by its photo ID. Only the allowed extensions (png,
   * jpg, jpeg, webp) are looked up, as exact keys, so the unique index is used.
   * @param photoId - the ID from the photo path
   * @returns the object key, or null for an unknown photo or an ID that is not a UUID
   */
  findPhotoKeyByPhotoId(photoId: string): Promise<string | null>;

  /**
   * Give a user a new profile photo key, in one locked step: two replaces at the same time each
   * get the key they really replaced. Delete the old object from RustFS only after this returns.
   * @param userId - the logged in user
   * @param newPhotoKey - the key of the new object, already saved in RustFS
   * @returns the old key, or null when the user does not exist (nothing changed)
   */
  replacePhotoKey(userId: string, newPhotoKey: string): Promise<string | null>;
}
