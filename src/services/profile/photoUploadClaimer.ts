/*
 * What sign up needs from the Photo functions (Tae builds the RustFS version). The photo is
 * uploaded before the account exists (`POST /photo-uploads`) and kept under a temporary key.
 * Sign up turns it into the profile photo in three steps, so the user row never points at a
 * missing object and a failed sign up leaves the upload usable until it expires:
 *
 *   1. prepareProfilePhoto: copy the upload to `profile-photos/<photoId>.<extension>`
 *   2. the Profile Service saves the user with that key (one database transaction)
 *   3. finishClaim after the save, or cancelClaim when the save failed
 *
 * The in-memory version is in inMemoryPhotoUploadClaimer.ts.
 */

/** A profile photo object made from an upload, not yet linked to a user. */
export interface PreparedProfilePhoto {
  /** The final RustFS object key, `profile-photos/<photoId>.<extension>`, photoId a UUID. */
  photoKey: string;
}

/** Turns a temporary photo upload into a profile photo at sign up. */
export interface PhotoUploadClaimer {
  /**
   * Make the profile photo object for an upload. The upload itself stays until finishClaim.
   * @param uploadId - the `uploadId` the app sent as `photoUploadId`
   * @returns the final object key, or null when the upload is unknown, expired or already used
   *   (also for an ID that is not a UUID)
   */
  prepareProfilePhoto(uploadId: string): Promise<PreparedProfilePhoto | null>;

  /**
   * Called after the user is saved: remove the temporary upload, so it cannot be used again.
   * A failure here is logged; the user is already created and the upload expires anyway.
   * @param uploadId - the upload that was prepared
   */
  finishClaim(uploadId: string): Promise<void>;

  /**
   * Called when saving the user failed: delete the prepared object. The upload stays usable
   * until it expires. Must not delete an object that a saved user already uses.
   * @param photoKey - the key from prepareProfilePhoto
   */
  cancelClaim(photoKey: string): Promise<void>;
}
