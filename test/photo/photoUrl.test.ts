/*
 * Tests for photoUrlFor: the one place that decides the API path of a profile photo.
 */
import { describe, expect, it } from "bun:test";

import { photoUrlFor } from "../../src/services/photo/photoUrl";

describe("photoUrlFor", () => {
  it("builds the API path from a photo ID", () => {
    expect(photoUrlFor("pho_b2")).toBe("/api/v1/photos/pho_b2");
    expect(photoUrlFor("0194f1c2-7a3b-7c11-8e55-3d2f6a1b9c04")).toBe(
      "/api/v1/photos/0194f1c2-7a3b-7c11-8e55-3d2f6a1b9c04",
    );
  });

  it("encodes characters that do not belong in a path", () => {
    expect(photoUrlFor("a b/c")).toBe("/api/v1/photos/a%20b%2Fc");
  });
});
