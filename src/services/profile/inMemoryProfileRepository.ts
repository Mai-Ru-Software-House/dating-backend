/*
 * In-memory Profile repository. Unit tests use it. Data is lost when the process stops, so the
 * real app uses the Prisma version in src/data/prismaProfileRepository.ts.
 */
import { photoIdFromKey } from "../../data/photoKey";
import type {
  CreateProfileResult,
  NewProfile,
  ProfileChanges,
  ProfileRepository,
  StoredProfile,
} from "./profileRepository";

/** The gender rows the migrations create. */
export const DEFAULT_GENDER_CODES = ["female", "male", "non_binary", "prefer_not_to_say"];

interface StoredUser {
  profile: StoredProfile;
  photoKey: string;
  passwordHash: string;
}

/** Starting data for the in-memory repository. */
export interface InMemoryProfileOptions {
  /** Profiles that exist from the start, with their photo key. */
  profiles?: { profile: StoredProfile; photoKey: string }[];
  /** The gender codes, default DEFAULT_GENDER_CODES. */
  genderCodes?: string[];
}

/** An in-memory repository plus a way to read the stored password hash, for tests. */
export interface InMemoryProfileRepository extends ProfileRepository {
  /**
   * @param userId - a user created with `createProfile`
   * @returns the stored password hash, or null for an unknown user or a starting profile
   */
  passwordHashOf(userId: string): string | null;
}

function copyProfile(profile: StoredProfile): StoredProfile {
  return {
    ...profile,
    dateOfBirth: new Date(profile.dateOfBirth),
    preferences: {
      ...profile.preferences,
      targetGenders: [...profile.preferences.targetGenders].sort(),
    },
  };
}

/**
 * Create an in-memory Profile repository.
 * @param options - optional starting profiles and gender codes
 * @returns the repository
 */
export function createInMemoryProfileRepository(
  options: InMemoryProfileOptions = {},
): InMemoryProfileRepository {
  const genderCodes = [...(options.genderCodes ?? DEFAULT_GENDER_CODES)].sort();
  const users = new Map<string, StoredUser>();
  for (const { profile, photoKey } of options.profiles ?? []) {
    users.set(profile.userId, { profile: copyProfile(profile), photoKey, passwordHash: "" });
  }

  function isTaken(field: "username" | "photoKey", value: string): boolean {
    return [...users.values()].some((user) =>
      field === "username" ? user.profile.username === value : user.photoKey === value,
    );
  }

  return {
    passwordHashOf(userId) {
      const hash = users.get(userId)?.passwordHash;
      return hash === undefined || hash === "" ? null : hash;
    },

    listGenderCodes() {
      return Promise.resolve([...genderCodes]);
    },

    isUsernameTaken(username) {
      return Promise.resolve(isTaken("username", username));
    },

    // The check and the insert run without an `await` between them, so two calls at the same
    // time cannot both pass the check.
    createProfile(newProfile: NewProfile): Promise<CreateProfileResult> {
      if (isTaken("username", newProfile.username)) {
        return Promise.resolve({ status: "usernameTaken" });
      }
      if (isTaken("photoKey", newProfile.photoKey)) {
        return Promise.resolve({ status: "photoKeyTaken" });
      }
      const { photoKey, passwordHash, ...fields } = newProfile;
      const profile: StoredProfile = copyProfile({
        ...fields,
        userId: Bun.randomUUIDv7(),
        photoId: photoIdFromKey(photoKey),
      });
      users.set(profile.userId, { profile, photoKey, passwordHash });
      return Promise.resolve({ status: "created", profile: copyProfile(profile) });
    },

    findProfileById(userId) {
      const user = users.get(userId);
      return Promise.resolve(user === undefined ? null : copyProfile(user.profile));
    },

    updateProfile(userId, changes: ProfileChanges) {
      const user = users.get(userId);
      if (user === undefined) {
        return Promise.resolve(null);
      }
      // Like Prisma, a field that is missing or undefined keeps its value.
      const updated: StoredProfile = {
        ...user.profile,
        displayName: changes.displayName ?? user.profile.displayName,
        dateOfBirth: changes.dateOfBirth ?? user.profile.dateOfBirth,
        gender: changes.gender ?? user.profile.gender,
        preferences: changes.preferences ?? user.profile.preferences,
      };
      if (changes.location !== undefined) {
        updated.latitude = changes.location.latitude;
        updated.longitude = changes.location.longitude;
        updated.placeName = changes.location.placeName;
      }
      user.profile = copyProfile(updated);
      return Promise.resolve(copyProfile(user.profile));
    },
  };
}
