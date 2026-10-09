/*
 * Tests for the ID helpers of the Data Access Layer: a text that is not a valid ID is "not
 * found", never an error from PostgreSQL.
 */
import { describe, expect, it } from "bun:test";

import { isUuid, parseNoteId } from "../../src/data/ids";

const LARGEST_INTEGER_ID = 2_147_483_647;

describe("parseNoteId", () => {
  it("reads a whole number from 1 to 2147483647", () => {
    expect(parseNoteId("1")).toBe(1);
    expect(parseNoteId("42")).toBe(42);
    expect(parseNoteId(String(LARGEST_INTEGER_ID))).toBe(LARGEST_INTEGER_ID);
  });

  it("gives null for anything else", () => {
    const notIds = ["", " ", "0", "-1", "01", "1.5", "1e3", "abc", "12a", "+5", "2147483648"];
    for (const value of notIds) {
      expect(parseNoteId(value)).toBeNull();
    }
    expect(parseNoteId("99999999999999999999")).toBeNull();
  });
});

describe("isUuid", () => {
  it("accepts the shape of a UUID and refuses other text", () => {
    expect(isUuid("0194a1b2-8d11-7a22-9b33-c4d5e6f7a8b9")).toBe(true);
    expect(isUuid("99999")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});
