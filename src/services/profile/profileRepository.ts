/*
 * What the Profile Service needs from the Data Access Layer (Chuan): the `users` row with its
 * password sign-in method and target genders. The in-memory version is in
 * inMemoryProfileRepository.ts and the Prisma version in src/data/prismaProfileRepository.ts.
 * The repository only stores and reads; the service checks every rule first.
 */
import type { Preferences } from "./profileTypes";

/** A user's profile as stored. Times are Date objects in UTC. */
export interface StoredProfile {
  userId: string;
  /** Already in lowercase. */
  username: string;
  displayName: string;
  /** Midnight UTC of the date of birth. */
  dateOfBirth: Date;
  gender: string;
  latitude: number;
  longitude: number;
  placeName: string | null;
  /** The file name of the profile photo, without its extension. */
  photoId: string;
  /** `targetGenders` are sorted A to Z. */
  preferences: Preferences;
}

/** Everything sign up stores. The repository creates the user ID. */
export interface NewProfile {
  username: string;
  displayName: string;
  dateOfBirth: Date;
  gender: string;
  latitude: number;
  longitude: number;
  placeName: string | null;
  /** The RustFS object key, `profile-photos/<photoId>.<extension>`. */
  photoKey: string;
  /** Argon2id hash, stored in `user_auth_methods`. */
  passwordHash: string;
  /** `targetGenders` must not repeat a code. */
  preferences: Preferences;
}

/** What Edit Profile can change. A missing field stays as it is. */
export interface ProfileChanges {
  displayName?: string;
  dateOfBirth?: Date;
  gender?: string;
  /** A new point always comes with its new place name (null clears the old one). */
  location?: { latitude: number; longitude: number; placeName: string | null };
  /** Replaces all the preferences, including every target gender. */
  preferences?: Preferences;
}

/** The answer of `createProfile`. A taken username or photo key is not an error. */
export type CreateProfileResult =
  | { status: "created"; profile: StoredProfile }
  | { status: "usernameTaken" }
  | { status: "photoKeyTaken" };

/** Reads and writes profiles. */
export interface ProfileRepository {
  /** @returns the gender codes of the `genders` table, sorted A to Z */
  listGenderCodes(): Promise<string[]>;

  /**
   * @param username - the username to check, already in lowercase
   * @returns true when a user has that username
   */
  isUsernameTaken(username: string): Promise<boolean>;

  /**
   * Store a new user, their password sign-in method and their target genders, all or nothing.
   * Two calls with the same username at the same time give one "created" and one
   * "usernameTaken".
   * @param profile - the checked profile, with the password hash and the photo key
   * @returns the stored profile, or why nothing was stored
   */
  createProfile(profile: NewProfile): Promise<CreateProfileResult>;

  /**
   * @param userId - the user to read
   * @returns the profile, or null for an unknown user or an ID that is not a UUID
   */
  findProfileById(userId: string): Promise<StoredProfile | null>;

  /**
   * Change some fields of a profile, all or nothing.
   * @param userId - the logged in user
   * @param changes - the fields to change
   * @returns the updated profile, or null when the user does not exist
   */
  updateProfile(userId: string, changes: ProfileChanges): Promise<StoredProfile | null>;
}
