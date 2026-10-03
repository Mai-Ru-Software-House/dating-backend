/*
 * Photo Service stub (owner: Tae). Describes the storage operations other services expect.
 * Photo bytes live in RustFS and the database stores only the object key.
 */

/** Operations the Photo Service must offer. Fill in with Tae before coding. */
export interface PhotoStorage {
  /**
   * Store photo bytes in RustFS.
   * @param bytes - the image data after the format and size check
   * @param contentType - MIME type, for example "image/jpeg"
   * @returns the object key to save in the database
   */
  savePhoto(bytes: Uint8Array, contentType: string): Promise<string>;

  /**
   * Delete a photo from RustFS.
   * @param objectKey - key returned by savePhoto
   */
  deletePhoto(objectKey: string): Promise<void>;
}
