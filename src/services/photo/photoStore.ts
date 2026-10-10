/*
 * Photo functions (Tae): the Photo Store, the one place that talks to RustFS (S3-compatible)
 * for photo bytes. It stores profile photos (`profile-photos/<photoId>.jpg`) and the temporary
 * sign up uploads (`uploads/<uploadId>.jpg`); the database keeps only the object keys. The
 * in-memory version is in inMemoryPhotoStore.ts and is used by the tests.
 */
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { Config } from "../../config/env";

/** The HTTP status RustFS answers when an object is not there. */
const HTTP_NOT_FOUND = 404;
/** The content type an object gets when the store was not told one. */
const FALLBACK_CONTENT_TYPE = "application/octet-stream";

/** One photo object in the bucket, as the routes need it. */
export interface StoredPhoto {
  /** The image bytes. */
  bytes: Uint8Array;
  /** The content type stored with the object, for example `image/jpeg`. */
  contentType: string;
}

/** When an object was last written. */
export interface PhotoInfo {
  lastModified: Date;
}

/** The photo objects the backend stores: profile photos and temporary uploads. */
export interface PhotoStore {
  /**
   * Store (or replace) one object.
   * @param objectKey - the key in the bucket, for example `profile-photos/<photoId>.jpg`
   * @param bytes - the image bytes
   * @param contentType - the content type to store with the object
   */
  putPhoto(objectKey: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /**
   * Read one object.
   * @param objectKey - the key to read
   * @returns the object, or null when it does not exist
   */
  getPhoto(objectKey: string): Promise<StoredPhoto | null>;
  /**
   * Ask for the write time of one object without reading it.
   * @param objectKey - the key to check
   * @returns the write time, or null when the object does not exist
   */
  headPhoto(objectKey: string): Promise<PhotoInfo | null>;
  /**
   * Delete one object. Deleting a missing object does nothing.
   * @param objectKey - the key to delete
   */
  deletePhoto(objectKey: string): Promise<void>;
  /**
   * Copy one object inside the bucket (the temporary upload becomes the profile photo without
   * downloading it).
   * @param fromKey - the key to copy
   * @param toKey - the key to copy it to
   */
  copyPhoto(fromKey: string, toKey: string): Promise<void>;
  /**
   * List the objects under a prefix.
   * @param prefix - the key prefix, for example `uploads/`
   * @returns each key with its write time, sorted by key
   */
  listPhotos(prefix: string): Promise<{ key: string; lastModified: Date }[]>;
}

/** The error parts the S3 client fills in when a request fails. */
interface S3RequestError {
  $metadata?: { httpStatusCode?: number };
}

function isNotFound(error: unknown): boolean {
  return (error as S3RequestError | null)?.$metadata?.httpStatusCode === HTTP_NOT_FOUND;
}

/**
 * Create the RustFS photo store from the environment configuration.
 * @param config - the validated settings (`RUSTFS_*` variables)
 * @returns the store
 */
export function createRustFSPhotoStore(config: Config): PhotoStore {
  const s3 = new S3Client({
    endpoint: config.rustfsEndpoint,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.rustfsAccessKey,
      secretAccessKey: config.rustfsSecretKey,
    },
  });
  const bucket = config.rustfsBucket;

  return {
    async putPhoto(objectKey, bytes, contentType) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Body: bytes,
          ContentType: contentType,
        }),
      );
    },

    async getPhoto(objectKey) {
      try {
        const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
        if (response.Body === undefined) {
          throw new Error(`RustFS answered without a body for ${objectKey}.`);
        }
        return {
          bytes: new Uint8Array(await response.Body.transformToByteArray()),
          contentType: response.ContentType ?? FALLBACK_CONTENT_TYPE,
        };
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
    },

    async headPhoto(objectKey) {
      try {
        const response = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
        const lastModified = response.LastModified;
        return lastModified === undefined ? null : { lastModified };
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
    },

    async deletePhoto(objectKey) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
    },

    async copyPhoto(fromKey, toKey) {
      await s3.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: toKey,
          CopySource: `${bucket}/${fromKey}`,
        }),
      );
    },

    async listPhotos(prefix) {
      const objects: { key: string; lastModified: Date }[] = [];
      let token: string | undefined;
      do {
        const response = await s3.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
        );
        for (const object of response.Contents ?? []) {
          if (object.Key === undefined || object.LastModified === undefined) {
            continue;
          }
          objects.push({ key: object.Key, lastModified: object.LastModified });
        }
        token = response.IsTruncated === true ? response.NextContinuationToken : undefined;
      } while (token !== undefined);
      return objects.sort((a, b) => (a.key < b.key ? -1 : 1));
    },
  };
}
