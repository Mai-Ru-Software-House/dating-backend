/*
 * Photo functions (Tae): the check and transform every profile photo goes through before it is
 * stored in RustFS. The rules (test plan A5, docs/api-contract.md): the file is png, jpg, jpeg or
 * webp and at most 1 MB. A photo that is not 1:1 is center-cropped to a square. The stored result
 * is always a JPEG of at most 1024 pixels per side, so a stored photo is always square and small.
 */
import sharp, { type Metadata } from "sharp";
import { ApiError, ERROR_CODES } from "../../plugins/errors";

const HTTP_BAD_REQUEST = 400;

/** A5: the uploaded photo is at most 1 MB (checked before any processing). */
const MAX_PHOTO_BYTES = 1_000_000;
const SIZE_RULE = `The photo is too large. A photo can be at most 1 MB.`;

/** The stored JPEG never has an edge longer than this. Smaller photos are not enlarged. */
const MAX_PHOTO_EDGE = 1024;

const JPEG_QUALITY = 85;

/**
 * The EXIF orientations that store a photo rotated 90 or 270 degrees, so the stored width and
 * height are swapped once the rotation is applied.
 */
const MIN_ROTATED_ORIENTATION = 5;
const MAX_ROTATED_ORIENTATION = 8;

/** The pixels that surround the center crop form this many equal parts (one per side). */
const CROP_PARTS = 2;

/** Field name every photo rule error carries, as the contract requires. */
const PHOTO_FIELD = "photo";

/**
 * The image formats the upload can be in (test plan A5). `sharp` reports a jpg or jpeg file as
 * the format `jpeg`.
 */
const ALLOWED_FORMATS = new Set(["png", "jpeg", "webp"]);
const FORMAT_RULE = "The photo must be an image in PNG, JPG or WebP format.";
const READABLE_RULE = "The photo is not a readable image.";

/**
 * The width and height a photo has once its EXIF orientation is applied. Orientations 5 to 8
 * store a photo rotated 90 or 270 degrees, so the stored width and height are swapped; the other
 * orientations keep them.
 * @param width - the width of the encoded file
 * @param height - the height of the encoded file
 * @param orientation - the EXIF orientation of the file (1 to 8), or undefined when there is none
 * @returns the dimensions after the rotation, always with both values at least 1
 */
export function dimensionsAfterOrientation(
  width: number,
  height: number,
  orientation: number | undefined,
): { width: number; height: number } {
  const isRotated =
    orientation !== undefined &&
    orientation >= MIN_ROTATED_ORIENTATION &&
    orientation <= MAX_ROTATED_ORIENTATION;
  return isRotated ? { width: height, height: width } : { width, height };
}

/** What the storage and the claimer receive: the bytes to store, and how to name the object. */
export interface ProcessedProfilePhoto {
  /** The JPEG bytes to store in RustFS. */
  bytes: Uint8Array;
  /** The MIME type of the stored object, always `image/jpeg`. */
  contentType: string;
  /** The file extension of the stored object, without the dot. */
  extension: "jpg";
}

function invalid(message: string): ApiError {
  return new ApiError(HTTP_BAD_REQUEST, ERROR_CODES.invalidInput, message, PHOTO_FIELD);
}

/**
 * Check a profile photo upload and turn it into the form that is stored in RustFS: a square JPEG
 * of at most 1024 pixels per side. A photo whose width and height differ is center-cropped to the
 * smallest side first; a photo with EXIF orientation metadata is rotated into place before the
 * crop.
 * @param bytes - the raw bytes of the uploaded file
 * @returns the JPEG bytes with their content type and extension
 * @throws ApiError 400 INVALID_INPUT (field `photo`) with a message that names the failed rule
 */
export async function processProfilePhoto(bytes: Uint8Array): Promise<ProcessedProfilePhoto> {
  if (bytes.byteLength > MAX_PHOTO_BYTES) {
    throw invalid(SIZE_RULE);
  }

  let meta: Metadata;
  try {
    meta = await sharp(bytes).metadata();
  } catch {
    throw invalid(READABLE_RULE);
  }
  const width = meta.width;
  const height = meta.height;
  if (width === undefined || height === undefined || width === 0 || height === 0) {
    throw invalid(READABLE_RULE);
  }
  const format = meta.format;
  if (format === undefined || !ALLOWED_FORMATS.has(format)) {
    throw invalid(FORMAT_RULE);
  }

  // The crop must use the dimensions after the EXIF rotation, but metadata() reports the file
  // before it, so swap them here for orientations 5 to 8.
  const { width: storedWidth, height: storedHeight } = dimensionsAfterOrientation(
    width,
    height,
    meta.orientation,
  );

  // rotate() applies the EXIF orientation before anything else touches the pixels.
  let image = sharp(bytes).rotate();
  if (storedWidth !== storedHeight) {
    const side = Math.min(storedWidth, storedHeight);
    image = image.extract({
      left: Math.floor((storedWidth - side) / CROP_PARTS),
      top: Math.floor((storedHeight - side) / CROP_PARTS),
      width: side,
      height: side,
    });
  }
  if (sideExceedsLimit(storedWidth, storedHeight)) {
    image = image.resize(MAX_PHOTO_EDGE);
  }

  const out = await image.jpeg({ quality: JPEG_QUALITY }).toBuffer();
  return { bytes: out, contentType: "image/jpeg", extension: "jpg" };
}

function sideExceedsLimit(width: number, height: number): boolean {
  return Math.max(width, height) > MAX_PHOTO_EDGE;
}
