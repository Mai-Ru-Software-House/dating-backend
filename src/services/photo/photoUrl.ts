/*
 * The path of a profile photo in the API. The app sends it back with the session header, so the
 * backend is the only place that decides what the path looks like.
 */

const PHOTO_PATH_PREFIX = "/api/v1/photos/";

/**
 * Build the API path of a profile photo.
 * @param photoId - the photo ID (the file name of the stored object, without its extension)
 * @returns the path to send to the app, for example `/api/v1/photos/pho_b2`
 */
export function photoUrlFor(photoId: string): string {
  return `${PHOTO_PATH_PREFIX}${encodeURIComponent(photoId)}`;
}
