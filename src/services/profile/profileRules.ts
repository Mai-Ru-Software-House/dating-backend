/*
 * The Profile Service rules (test plan A1 to A3, the Create Profile use case and
 * docs/api-contract.md, POST /users). Each check returns the value to store, or throws
 * ApiError 400 INVALID_INPUT naming the field with the contract's dotted path (`location.lat`,
 * `preferences.minAge`). The route has already checked the types.
 */
import { ApiError, ERROR_CODES } from "../../plugins/errors";
import { MAX_PASSWORD_LENGTH } from "../auth/authRoutes";
import { ageOn } from "../match/mutualRule";
import type { LocationInput, Preferences } from "./profileTypes";

const HTTP_BAD_REQUEST = 400;

/** A1: 4 to 20 letters, digits and underscore. Stored in lowercase. */
const USERNAME_PATTERN = /^[A-Za-z0-9_]{4,20}$/;
const USERNAME_RULE = "The username must be 4 to 20 characters: letters, digits and underscore.";

/** A2: at least 8 characters with at least one letter and one digit. */
export const MIN_PASSWORD_LENGTH = 8;
const LETTER_PATTERN = /\p{L}/u;
const DIGIT_PATTERN = /[0-9]/;
const PASSWORD_RULE = `at least ${MIN_PASSWORD_LENGTH} characters, with at least one letter and one digit`;

/** The `users.display_name` column holds 50 characters. */
export const MAX_DISPLAY_NAME_LENGTH = 50;

/** A3: the minimum age, for the user and for the preferences. */
export const MIN_AGE = 18;
/** The oldest age a preference can ask for. */
export const MAX_AGE = 120;
/** Dates of birth before this year are treated as typing mistakes. */
const MIN_BIRTH_YEAR = 1900;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Search radius in whole km. The app's slider sends 1 to 100. */
export const MIN_RADIUS_KM = 1;
export const MAX_RADIUS_KM = 20_000;

const MIN_LATITUDE = -90;
const MAX_LATITUDE = 90;
const MIN_LONGITUDE = -180;
const MAX_LONGITUDE = 180;

function invalid(field: string, message: string): ApiError {
  return new ApiError(HTTP_BAD_REQUEST, ERROR_CODES.invalidInput, message, field);
}

/** Count Unicode characters, as PostgreSQL counts them for varchar. */
function characterCount(value: string): number {
  return [...value].length;
}

/**
 * Check a username (A1) and turn it into the stored form.
 * @param value - the username as typed
 * @returns the username in lowercase
 * @throws ApiError 400 (field `username`) when it is empty or breaks the rule
 */
export function checkUsername(value: string): string {
  if (value === "") {
    throw invalid("username", `A username is required. ${USERNAME_RULE}`);
  }
  if (!USERNAME_PATTERN.test(value)) {
    throw invalid("username", USERNAME_RULE);
  }
  return value.toLowerCase();
}

/**
 * Check a password (A2).
 * @param value - the plain password
 * @throws ApiError 400 (field `password`) that says which part of the rule failed
 */
export function checkPassword(value: string): void {
  const length = characterCount(value);
  if (length < MIN_PASSWORD_LENGTH) {
    throw invalid("password", `The password is too short. Use ${PASSWORD_RULE}.`);
  }
  if (length > MAX_PASSWORD_LENGTH) {
    throw invalid("password", `The password can have at most ${MAX_PASSWORD_LENGTH} characters.`);
  }
  if (!LETTER_PATTERN.test(value) || !DIGIT_PATTERN.test(value)) {
    throw invalid("password", `The password needs ${PASSWORD_RULE}.`);
  }
}

/**
 * Check a display name. Spaces at both ends are removed; the rest is kept exactly as typed.
 * @param value - the display name as typed
 * @returns the trimmed display name
 * @throws ApiError 400 (field `displayName`) when it is empty or longer than 50 characters
 */
export function checkDisplayName(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw invalid("displayName", "A display name is required.");
  }
  if (characterCount(trimmed) > MAX_DISPLAY_NAME_LENGTH) {
    throw invalid(
      "displayName",
      `The display name can have at most ${MAX_DISPLAY_NAME_LENGTH} characters.`,
    );
  }
  return trimmed;
}

/**
 * Check a date of birth: a real date, not in the future, and at least 18 years ago (A3), all
 * counted on UTC dates.
 * @param value - `YYYY-MM-DD`
 * @param now - the current moment
 * @returns midnight UTC of that date
 * @throws ApiError 400 (field `dateOfBirth`) that says which part of the rule failed
 */
export function checkDateOfBirth(value: string, now: Date): Date {
  const match = DATE_PATTERN.exec(value);
  const [year, month, day] = (match?.slice(1) ?? []).map(Number);
  if (year === undefined || month === undefined || day === undefined || year < MIN_BIRTH_YEAR) {
    throw invalid("dateOfBirth", "Enter a real date of birth as YYYY-MM-DD.");
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  if (!isRealDate) {
    throw invalid("dateOfBirth", "Enter a real date of birth as YYYY-MM-DD.");
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (date.getTime() > today) {
    throw invalid("dateOfBirth", "The date of birth cannot be in the future.");
  }
  if (ageOn(date, now) < MIN_AGE) {
    throw invalid("dateOfBirth", `You must be at least ${MIN_AGE} years old.`);
  }
  return date;
}

/**
 * Check a gender code against the `genders` table.
 * @param value - the code the app sent
 * @param genderCodes - the codes that exist
 * @param field - the field name to report, `gender` by default
 * @returns the code
 * @throws ApiError 400 when the code is not in the list
 */
export function checkGender(value: string, genderCodes: string[], field = "gender"): string {
  if (!genderCodes.includes(value)) {
    throw invalid(field, `Choose a gender from the list: ${genderCodes.join(", ")}.`);
  }
  return value;
}

/**
 * Check a location: latitude -90 to 90, longitude -180 to 180.
 * @param location - the point the app sent
 * @returns the same point
 * @throws ApiError 400 (field `location.lat` or `location.lon`)
 */
export function checkLocation(location: LocationInput): LocationInput {
  // Written so that NaN and Infinity also fail.
  if (!(location.lat >= MIN_LATITUDE && location.lat <= MAX_LATITUDE)) {
    throw invalid("location.lat", `lat must be a number from ${MIN_LATITUDE} to ${MAX_LATITUDE}.`);
  }
  if (!(location.lon >= MIN_LONGITUDE && location.lon <= MAX_LONGITUDE)) {
    throw invalid(
      "location.lon",
      `lon must be a number from ${MIN_LONGITUDE} to ${MAX_LONGITUDE}.`,
    );
  }
  return { lat: location.lat, lon: location.lon };
}

function checkWholeNumber(field: string, value: number, min: number, max: number): number {
  if (!(Number.isInteger(value) && value >= min && value <= max)) {
    throw invalid(
      field,
      `${field.split(".").at(-1)} must be a whole number from ${min} to ${max}.`,
    );
  }
  return value;
}

/**
 * Check the target preferences: ages 18 to 120 with minAge not above maxAge, one or more
 * known genders (a repeated code is kept once), radius 1 to 20000 whole km.
 * @param preferences - the preferences the app sent
 * @param genderCodes - the codes that exist
 * @returns the preferences to store, target genders sorted A to Z
 * @throws ApiError 400 (field `preferences.minAge`, `preferences.maxAge`,
 *   `preferences.targetGenders` or `preferences.radiusKm`)
 */
export function checkPreferences(preferences: Preferences, genderCodes: string[]): Preferences {
  const minAge = checkWholeNumber("preferences.minAge", preferences.minAge, MIN_AGE, MAX_AGE);
  const maxAge = checkWholeNumber("preferences.maxAge", preferences.maxAge, MIN_AGE, MAX_AGE);
  if (minAge > maxAge) {
    throw invalid(
      "preferences.minAge",
      "The age range is not valid: the minimum age cannot be above the maximum age.",
    );
  }
  if (preferences.targetGenders.length === 0) {
    throw invalid("preferences.targetGenders", "Choose at least one gender.");
  }
  const targetGenders = [...new Set(preferences.targetGenders)]
    .map((code) => checkGender(code, genderCodes, "preferences.targetGenders"))
    .sort();
  const radiusKm = checkWholeNumber(
    "preferences.radiusKm",
    preferences.radiusKm,
    MIN_RADIUS_KM,
    MAX_RADIUS_KM,
  );
  return { minAge, maxAge, targetGenders, radiusKm };
}
