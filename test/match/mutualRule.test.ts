/*
 * Tests for the age calculation and the mutual rule (test plan A11, FM02 to FM05).
 */
import { describe, expect, it } from "bun:test";

import {
  ageOn,
  fitsPreference,
  keepCandidatesWhoWantUser,
  keepMutualCandidates,
} from "../../src/services/match/mutualRule";
import { ALICE, BOB, CHAI, DAN, EKK, FAH, GUN, HANA, JOE, NOW, TEST_USERS } from "./fixtures";

function ids(entries: { profile: { username: string } }[]): string[] {
  return entries.map((entry) => entry.profile.username).sort();
}

describe("ageOn", () => {
  const born = new Date("2008-10-08T00:00:00.000Z");

  it("counts a person as older at 00:00 UTC on the birthday", () => {
    expect(ageOn(born, new Date("2026-10-08T00:00:00.000Z"))).toBe(18);
  });

  it("is still the younger age on the day before the birthday", () => {
    expect(ageOn(born, new Date("2026-10-07T23:59:59.999Z"))).toBe(17);
  });

  it("handles an earlier month and a later month", () => {
    expect(ageOn(new Date("1999-12-31T00:00:00.000Z"), NOW)).toBe(26);
    expect(ageOn(new Date("1999-01-01T00:00:00.000Z"), NOW)).toBe(27);
  });

  it("gives the ages the test plan expects on 8 October 2026", () => {
    expect([ALICE, BOB, CHAI, DAN, GUN, JOE].map((user) => ageOn(user.dateOfBirth, NOW))).toEqual([
      27, 28, 25, 41, 30, 76,
    ]);
  });
});

describe("fitsPreference", () => {
  const wants = { ageMin: 24, ageMax: 32, genders: ["male"], radiusKm: 50 };

  it("accepts the edges of the age range and of the radius", () => {
    expect(fitsPreference(wants, { age: 24, gender: "male", distanceKm: 50 })).toBe(true);
    expect(fitsPreference(wants, { age: 32, gender: "male", distanceKm: 0 })).toBe(true);
  });

  it("rejects one value outside the range", () => {
    expect(fitsPreference(wants, { age: 23, gender: "male", distanceKm: 1 })).toBe(false);
    expect(fitsPreference(wants, { age: 33, gender: "male", distanceKm: 1 })).toBe(false);
    expect(fitsPreference(wants, { age: 30, gender: "female", distanceKm: 1 })).toBe(false);
    expect(fitsPreference(wants, { age: 30, gender: "male", distanceKm: 50.1 })).toBe(false);
  });
});

describe("mutual rule on the test plan users", () => {
  it("keeps exactly bob and chai for alice (FM01 to FM05)", () => {
    const entries = keepMutualCandidates(ALICE, TEST_USERS, NOW);
    expect(ids(entries)).toEqual(["bob", "chai"]);
  });

  it("leaves dan out for age, ekk for distance, fah and hana for gender, gun for the mutual rule", () => {
    const wantsAlice = ids(keepCandidatesWhoWantUser(ALICE, TEST_USERS, NOW));
    // gun does not want alice (she is 27, his maximum is 26), and fah and hana want men.
    expect(wantsAlice).not.toContain("gun");
    expect(wantsAlice).not.toContain("fah");
    expect(wantsAlice).not.toContain("hana");
    const mutual = ids(keepMutualCandidates(ALICE, TEST_USERS, NOW));
    expect(mutual).not.toContain("dan");
    expect(mutual).not.toContain("ekk");
    expect(mutual).not.toContain("gun");
  });

  it("never returns the user", () => {
    expect(ids(keepMutualCandidates(ALICE, TEST_USERS, NOW))).not.toContain("alice");
    expect(ids(keepCandidatesWhoWantUser(ALICE, TEST_USERS, NOW))).not.toContain("alice");
  });

  it("gives bob alice and fah, the two women who fit him and want him", () => {
    expect(ids(keepMutualCandidates(BOB, TEST_USERS, NOW))).toEqual(["alice", "fah"]);
  });

  it("gives joe nobody (FM16)", () => {
    expect(keepMutualCandidates(JOE, TEST_USERS, NOW)).toEqual([]);
  });

  it("measures the distance from the user, with exact kilometres", () => {
    const entries = keepMutualCandidates(ALICE, TEST_USERS, NOW);
    const bob = entries.find((entry) => entry.profile.username === "bob");
    const chai = entries.find((entry) => entry.profile.username === "chai");
    expect(bob?.distanceKm).toBeGreaterThan(2);
    expect(bob?.distanceKm).toBeLessThan(4);
    expect(chai?.distanceKm).toBeGreaterThan(12);
    expect(chai?.distanceKm).toBeLessThan(14);
  });

  it("keeps ekk out only because of the radius", () => {
    const wantsAlice = ids(keepCandidatesWhoWantUser(ALICE, [EKK, FAH, HANA], NOW));
    expect(wantsAlice).toEqual(["ekk"]);
    expect(ids(keepMutualCandidates(ALICE, [EKK], NOW))).toEqual([]);
  });
});
