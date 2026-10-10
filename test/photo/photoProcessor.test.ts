/*
 * Tests for the Photo functions (Tae): processProfilePhoto turns an uploaded photo into the
 * square JPEG that is stored in RustFS, and rejects a file that breaks rule A5. The images are
 * built in memory with sharp, so no fixture files are needed.
 */
import { describe, expect, it } from "bun:test";
import sharp from "sharp";

import { ApiError } from "../../src/plugins/errors";
import {
  dimensionsAfterOrientation,
  processProfilePhoto,
} from "../../src/services/photo/photoProcessor";

/** One filled rectangle to paint on top of the background. */
interface Mark {
  left: number;
  top: number;
  width: number;
  height: number;
  color: string;
}

const WHITE = { r: 255, g: 255, b: 255 };
const RED = "#ff0000";
const BLACK = "#000000";

/**
 * Build a PNG with the given size and background, with filled rectangles painted on top.
 * @param width - pixels
 * @param height - pixels
 * @param background - the color of every pixel that no mark covers
 * @param marks - the rectangles, each painted as a solid color
 * @returns the PNG bytes
 */
async function createImage(
  width: number,
  height: number,
  background: { r: number; g: number; b: number },
  marks: Mark[] = [],
): Promise<Buffer> {
  const overlays = marks.map((mark) => ({
    input: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${mark.width}" height="${mark.height}">` +
        `<rect width="${mark.width}" height="${mark.height}" fill="${mark.color}"/></svg>`,
    ),
    left: mark.left,
    top: mark.top,
  }));
  return sharp({
    create: { width, height, channels: 3, background },
  })
    .composite(overlays)
    .png()
    .toBuffer();
}

/**
 * The RGB of one pixel of a processed (JPEG) image.
 * @param image - the stored image bytes
 * @param x - the pixel column, from the left
 * @param y - the pixel row, from the top
 * @returns the three channel values of that pixel
 */
async function pixelAt(image: Uint8Array, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return [data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0];
}

/**
 * Build a JPEG whose EXIF data says the photo is stored rotated. `sharp` writes a complete EXIF
 * block with withExif but does not follow the orientation value sent to it, so the block is
 * written and then the orientation value (tag 0x0112) is patched in place.
 * @param width - the width of the encoded file
 * @param height - the height of the encoded file
 * @param orientation - the EXIF orientation to store (1 to 8)
 * @returns the JPEG bytes with that EXIF orientation
 */
async function jpegWithExifOrientation(
  width: number,
  height: number,
  orientation: number,
): Promise<Buffer> {
  const base = await sharp({
    create: { width, height, channels: 3, background: WHITE },
  })
    .jpeg()
    .toBuffer();
  const withApp1 = await sharp(base)
    .withExif({ IFD0: { Orientation: "1" } })
    .toBuffer();

  let segmentStart = 2;
  while (
    segmentStart < withApp1.length &&
    !(byte(withApp1, segmentStart) === 0xff && byte(withApp1, segmentStart + 1) === 0xe1)
  ) {
    segmentStart += 2;
  }
  // The TIFF header starts after the 6 bytes `Exif\0\0`; the first IFD follows its 8 byte head.
  const ifdStart = segmentStart + 10 + 8;
  const entryCount = byte(withApp1, ifdStart) | (byte(withApp1, ifdStart + 1) << 8);
  for (let entry = 0; entry < entryCount; entry++) {
    const entryStart = ifdStart + 2 + entry * 12;
    const tag = byte(withApp1, entryStart) | (byte(withApp1, entryStart + 1) << 8);
    if (tag === 0x0112) {
      withApp1[entryStart + 8] = orientation;
      return withApp1;
    }
  }
  throw new Error("The generated EXIF block has no orientation tag.");
}

/** Read one byte of a buffer (indexed access is `number | undefined` under strict mode). */
function byte(buffer: Buffer, index: number): number {
  return buffer[index] ?? 0;
}

describe("dimensionsAfterOrientation", () => {
  it("keeps the stored dimensions for orientations that do not rotate", () => {
    for (const orientation of [1, 2, 3, 4, undefined]) {
      expect(dimensionsAfterOrientation(200, 100, orientation)).toEqual({
        width: 200,
        height: 100,
      });
    }
  });

  it("swaps the dimensions for orientations 5 to 8", () => {
    for (const orientation of [5, 6, 7, 8]) {
      expect(dimensionsAfterOrientation(200, 100, orientation)).toEqual({
        width: 100,
        height: 200,
      });
    }
  });
});

describe("processProfilePhoto", () => {
  it("keeps a square photo and re-encodes it as JPEG", async () => {
    const photo = await createImage(600, 600, WHITE);
    const result = await processProfilePhoto(photo);

    expect(result.contentType).toBe("image/jpeg");
    expect(result.extension).toBe("jpg");
    const meta = await sharp(result.bytes).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(600);
    expect(meta.height).toBe(600);
  });

  it("center-crops a landscape photo to the smallest side", async () => {
    // The red columns at both ends must be cut away; the black mark at the exact center must
    // survive at the center of the crop.
    const photo = await createImage(800, 600, WHITE, [
      { left: 0, top: 0, width: 100, height: 600, color: RED },
      { left: 700, top: 0, width: 100, height: 600, color: RED },
      { left: 395, top: 295, width: 10, height: 10, color: BLACK },
    ]);
    const result = await processProfilePhoto(photo);

    const meta = await sharp(result.bytes).metadata();
    expect(meta.width).toBe(600);
    expect(meta.height).toBe(600);
    const corner = await pixelAt(result.bytes, 0, 0);
    expect(corner[0]).toBeGreaterThan(200);
    const center = await pixelAt(result.bytes, 300, 300);
    expect(center[0]).toBeLessThan(100);
  });

  it("center-crops a portrait photo to the smallest side", async () => {
    const photo = await createImage(600, 800, WHITE);
    const result = await processProfilePhoto(photo);

    const meta = await sharp(result.bytes).metadata();
    expect(meta.width).toBe(600);
    expect(meta.height).toBe(600);
  });

  it("shrinks a photo with a side over 1024 pixels to 1024 by 1024", async () => {
    const photo = await createImage(2000, 1500, WHITE);
    const result = await processProfilePhoto(photo);

    const meta = await sharp(result.bytes).metadata();
    expect(meta.width).toBe(1024);
    expect(meta.height).toBe(1024);
  });

  it("does not enlarge a small square photo", async () => {
    const photo = await createImage(100, 100, WHITE);
    const result = await processProfilePhoto(photo);

    const meta = await sharp(result.bytes).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(100);
  });

  it("rotates an EXIF-rotated photo into place before the crop", async () => {
    // Stored as 200x100 with orientation 6 (rotate 90 degrees): it is a 100x200 photo, cropped
    // to 100x100 from the center.
    const photo = await jpegWithExifOrientation(200, 100, 6);
    const result = await processProfilePhoto(photo);

    const meta = await sharp(result.bytes).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(100);
  });

  it("rejects a file over 1 MB before it reads the image", async () => {
    const error = await processProfilePhoto(new Uint8Array(1_000_001).fill(1)).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(400);
    expect(apiError.code).toBe("INVALID_INPUT");
    expect(apiError.field).toBe("photo");
    expect(apiError.message).toContain("1 MB");
  });

  it("rejects a file that is not a readable image", async () => {
    const error = await processProfilePhoto(new Uint8Array([1, 2, 3, 4, 5])).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).field).toBe("photo");
    expect((error as ApiError).message).toContain("not a readable image");
  });

  it("rejects a file in a format that is not PNG, JPG or WebP", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    const error = await processProfilePhoto(svg).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).field).toBe("photo");
    expect((error as ApiError).message).toContain("PNG, JPG or WebP");
  });
});
