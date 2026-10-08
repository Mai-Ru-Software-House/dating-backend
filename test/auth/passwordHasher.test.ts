/*
 * Tests for the password hasher: Argon2id output (functional test CP12) and verification.
 */
import { describe, expect, it } from "bun:test";

import { cheapHasher } from "./fixtures";

describe("password hasher", () => {
  it("produces an Argon2id hash, never the plain password", async () => {
    const hash = await cheapHasher.hash("Alice2026");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(hash).not.toContain("Alice2026");
  });

  it("uses a different salt for each hash of the same password", async () => {
    const first = await cheapHasher.hash("Alice2026");
    const second = await cheapHasher.hash("Alice2026");
    expect(first).not.toBe(second);
  });

  it("accepts the right password and rejects a wrong one", async () => {
    const hash = await cheapHasher.hash("Alice2026");
    expect(await cheapHasher.verify("Alice2026", hash)).toBe(true);
    expect(await cheapHasher.verify("alice2026", hash)).toBe(false);
  });

  it("returns false for a hash that cannot be read", async () => {
    expect(await cheapHasher.verify("Alice2026", "not a hash")).toBe(false);
  });
});
