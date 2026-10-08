/*
 * The matching rules that do not need the Match Engine: age from date of birth, and the mutual
 * rule (test plan A11): two users are shown to each other only when each one fits what the other
 * wants (age, gender and distance).
 */
import { distanceKm } from "../location/distance";
import type { MatchPreference, MatchProfile } from "./matchTypes";

/**
 * Compute an age in whole years, using the UTC dates (the contract says age is computed in UTC).
 * @param dateOfBirth - the date of birth; only its UTC date counts
 * @param now - the moment to compute the age at
 * @returns the age in whole years; a person is a year older at 00:00 UTC on the birthday
 */
export function ageOn(dateOfBirth: Date, now: Date): number {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const monthDifference = now.getUTCMonth() - dateOfBirth.getUTCMonth();
  const hasHadBirthday =
    monthDifference > 0 || (monthDifference === 0 && now.getUTCDate() >= dateOfBirth.getUTCDate());
  if (!hasHadBirthday) {
    age -= 1;
  }
  return age;
}

/**
 * Check one side of the mutual rule: does a person fit what someone wants?
 * @param wants - the preferences of the person who looks
 * @param person - age, gender and the distance to the person who looks
 * @returns true when the age is in range, the gender is wanted and the distance is not above
 *   the radius
 */
export function fitsPreference(
  wants: MatchPreference,
  person: { age: number; gender: string; distanceKm: number },
): boolean {
  const isAgeInRange = person.age >= wants.ageMin && person.age <= wants.ageMax;
  const isGenderWanted = wants.genders.includes(person.gender);
  const isCloseEnough = person.distanceKm <= wants.radiusKm;
  return isAgeInRange && isGenderWanted && isCloseEnough;
}

/** A candidate with the numbers the Match Service needs again later. */
export interface PoolEntry {
  profile: MatchProfile;
  age: number;
  /** Exact distance in km from the user who asks to this candidate. */
  distanceKm: number;
}

/**
 * Keep the candidates whose own preferences accept the user (the candidate side of the rule),
 * and add their age and distance. The user's side is checked by the Match Engine for
 * recommendations, and by the search criteria for a search.
 * @param user - the user who asks
 * @param pool - everyone who could be shown
 * @param now - the moment to compute ages at
 * @returns the candidates who want the user, with age and distance
 */
export function keepCandidatesWhoWantUser(
  user: MatchProfile,
  pool: MatchProfile[],
  now: Date,
): PoolEntry[] {
  const userAge = ageOn(user.dateOfBirth, now);
  const entries: PoolEntry[] = [];
  for (const profile of pool) {
    if (profile.userId === user.userId) {
      continue;
    }
    const distance = distanceKm(
      { lat: user.latitude, lon: user.longitude },
      { lat: profile.latitude, lon: profile.longitude },
    );
    const wantsUser = fitsPreference(profile.preference, {
      age: userAge,
      gender: user.gender,
      distanceKm: distance,
    });
    if (wantsUser) {
      entries.push({ profile, age: ageOn(profile.dateOfBirth, now), distanceKm: distance });
    }
  }
  return entries;
}

/**
 * Keep the candidates that fit both ways: they fit the user's own preferences, and their own
 * preferences accept the user.
 * @param user - the user who asks
 * @param pool - everyone who could be shown
 * @param now - the moment to compute ages at
 * @returns the mutually eligible candidates, with age and distance
 */
export function keepMutualCandidates(
  user: MatchProfile,
  pool: MatchProfile[],
  now: Date,
): PoolEntry[] {
  return keepCandidatesWhoWantUser(user, pool, now).filter((entry) =>
    fitsPreference(user.preference, {
      age: entry.age,
      gender: entry.profile.gender,
      distanceKm: entry.distanceKm,
    }),
  );
}
