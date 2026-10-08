/*
 * Profile Service (Chuan): username check, sign up, the own profile (read and edit) and the
 * candidate profile (docs/api-contract.md, Profile section). The service checks every rule
 * (profileRules.ts) before it writes. Sign up saves the user, the password sign-in and the
 * target genders in one transaction (the repository), with the place name from the Location
 * Service (null when the lookup fails, A8) and the photo claimed from its temporary upload.
 */
import { ApiError, ERROR_CODES } from "../../plugins/errors";
import type { TokenPair } from "../auth/authService";
import type { PasswordHasher } from "../auth/passwordHasher";
import { distanceKm, roundDistanceKm } from "../location/distance";
import type { LocationService } from "../location/locationService";
import type { MatchProfile } from "../match/matchTypes";
import { ageOn } from "../match/mutualRule";
import type { FavoritesReader } from "../messaging/messageRepository";
import { photoUrlFor } from "../photo/photoUrl";
import type { MatchScorer } from "./matchScorer";
import type { PhotoUploadClaimer } from "./photoUploadClaimer";
import type {
  CreateProfileResult,
  ProfileChanges,
  ProfileRepository,
  StoredProfile,
} from "./profileRepository";
import {
  checkDateOfBirth,
  checkDisplayName,
  checkGender,
  checkLocation,
  checkPassword,
  checkPreferences,
  checkUsername,
} from "./profileRules";
import type {
  OwnProfile,
  ProfileUpdateInput,
  PublicProfile,
  SignUpInput,
  SignUpResult,
} from "./profileTypes";

const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
/** `YYYY-MM-DD` is the first 10 characters of an ISO 8601 time. */
const DATE_LENGTH = 10;

/** Parts the service needs. `now` is replaceable in tests. */
export interface ProfileServiceOptions {
  profiles: ProfileRepository;
  hasher: PasswordHasher;
  /** The Auth Service: sign up returns the same tokens as login. */
  auth: { issueTokens(userId: string): Promise<TokenPair> };
  places: Pick<LocationService, "findPlaceName">;
  photoUploads: PhotoUploadClaimer;
  favorites: FavoritesReader;
  scorer: MatchScorer;
  now?: () => Date;
}

/** What the routes call. */
export interface ProfileService {
  /**
   * Check whether a username can still be used (case insensitive).
   * @param username - the username as typed
   * @returns `isAvailable` false when someone has it
   * @throws ApiError 400 INVALID_INPUT (field `username`) when it breaks rule A1
   */
  checkUsername(username: string): Promise<{ isAvailable: boolean }>;

  /**
   * Create a profile and log the new user in.
   * @param input - the sign up body
   * @returns the tokens and the new profile
   * @throws ApiError 400 INVALID_INPUT (with `field`) when a rule fails, or `photoUploadId`
   *   for an unknown, expired or used upload
   * @throws ApiError 409 USERNAME_TAKEN when the username is taken
   */
  signUp(input: SignUpInput): Promise<SignUpResult>;

  /**
   * @param userId - the logged in user
   * @returns their own profile
   * @throws ApiError 401 UNAUTHENTICATED when the user no longer exists
   */
  getOwnProfile(userId: string): Promise<OwnProfile>;

  /**
   * Change the logged in user's profile. A new location gets a new place name (cleared when
   * the lookup fails).
   * @param userId - the logged in user
   * @param input - the fields to change
   * @returns the updated profile
   * @throws ApiError 400 INVALID_INPUT (with `field`) when a rule fails or `username` is sent
   * @throws ApiError 401 UNAUTHENTICATED when the user no longer exists
   */
  updateOwnProfile(userId: string, input: ProfileUpdateInput): Promise<OwnProfile>;

  /**
   * Show another user's profile to the logged in user.
   * @param viewerId - the logged in user
   * @param userId - the user to show
   * @returns the candidate card with `matchScore`, `lookingFor` and `isFavorite`
   * @throws ApiError 404 USER_NOT_FOUND for an unknown ID or an ID that is not a UUID
   * @throws ApiError 401 UNAUTHENTICATED when the logged in user no longer exists
   * @throws ApiError 500 MATCH_ENGINE_UNAVAILABLE when the engine fails
   */
  getPublicProfile(viewerId: string, userId: string): Promise<PublicProfile>;
}

function toOwnProfile(profile: StoredProfile): OwnProfile {
  return {
    userId: profile.userId,
    username: profile.username,
    displayName: profile.displayName,
    dateOfBirth: profile.dateOfBirth.toISOString().slice(0, DATE_LENGTH),
    gender: profile.gender,
    location: { lat: profile.latitude, lon: profile.longitude },
    placeName: profile.placeName,
    photoUrl: photoUrlFor(profile.photoId),
    preferences: { ...profile.preferences },
  };
}

function toMatchProfile(profile: StoredProfile): MatchProfile {
  return {
    userId: profile.userId,
    username: profile.username,
    displayName: profile.displayName,
    photoId: profile.photoId,
    gender: profile.gender,
    dateOfBirth: profile.dateOfBirth,
    latitude: profile.latitude,
    longitude: profile.longitude,
    placeName: profile.placeName,
    preference: {
      ageMin: profile.preferences.minAge,
      ageMax: profile.preferences.maxAge,
      genders: profile.preferences.targetGenders,
      radiusKm: profile.preferences.radiusKm,
    },
  };
}

function sessionEnded(): ApiError {
  return new ApiError(
    HTTP_UNAUTHORIZED,
    ERROR_CODES.unauthenticated,
    "Your account no longer exists. Please log in again.",
  );
}

function usernameTaken(): ApiError {
  return new ApiError(
    HTTP_CONFLICT,
    ERROR_CODES.usernameTaken,
    "That username is taken. Please choose another one.",
    "username",
  );
}

function uploadNotUsable(): ApiError {
  return new ApiError(
    HTTP_BAD_REQUEST,
    ERROR_CODES.invalidInput,
    "The profile photo upload was not found, has expired or was already used. Please upload the photo again.",
    "photoUploadId",
  );
}

/**
 * Create the Profile Service.
 * @param options - repository, hasher, Auth Service, Location Service, photo claimer,
 *   favorites, match scorer and an optional clock
 * @returns the service
 */
export function createProfileService(options: ProfileServiceOptions): ProfileService {
  const { profiles, hasher, auth, places, photoUploads, favorites, scorer } = options;
  const now = options.now ?? (() => new Date());

  // A8: when the lookup fails, the profile is still saved, with no place name.
  async function lookUpPlaceName(lat: number, lon: number): Promise<string | null> {
    try {
      return await places.findPlaceName(lat, lon);
    } catch (error) {
      console.warn(
        "Place lookup failed; the profile is saved without a place name:",
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }

  async function finishClaim(uploadId: string): Promise<void> {
    try {
      await photoUploads.finishClaim(uploadId);
    } catch (error) {
      console.error("Could not remove the temporary photo upload after sign up:", error);
    }
  }

  return {
    async checkUsername(username) {
      const stored = checkUsername(username);
      return { isAvailable: !(await profiles.isUsernameTaken(stored)) };
    },

    async signUp(input) {
      const moment = now();
      const genderCodes = await profiles.listGenderCodes();
      const username = checkUsername(input.username);
      checkPassword(input.password);
      const displayName = checkDisplayName(input.displayName);
      const dateOfBirth = checkDateOfBirth(input.dateOfBirth, moment);
      const gender = checkGender(input.gender, genderCodes);
      const location = checkLocation(input.location);
      const preferences = checkPreferences(input.preferences, genderCodes);

      // Fail fast before the slow steps. The unique index still decides when two sign ups race.
      if (await profiles.isUsernameTaken(username)) {
        throw usernameTaken();
      }
      const passwordHash = await hasher.hash(input.password);
      const placeName = await lookUpPlaceName(location.lat, location.lon);

      const photo = await photoUploads.prepareProfilePhoto(input.photoUploadId);
      if (photo === null) {
        throw uploadNotUsable();
      }
      let result: CreateProfileResult;
      try {
        result = await profiles.createProfile({
          username,
          displayName,
          dateOfBirth,
          gender,
          latitude: location.lat,
          longitude: location.lon,
          placeName,
          photoKey: photo.photoKey,
          passwordHash,
          preferences,
        });
      } catch (error) {
        await photoUploads.cancelClaim(photo.photoKey);
        throw error;
      }
      if (result.status === "usernameTaken") {
        await photoUploads.cancelClaim(photo.photoKey);
        throw usernameTaken();
      }
      if (result.status === "photoKeyTaken") {
        // Another sign up saved this photo first, so its object belongs to that user: keep it.
        throw uploadNotUsable();
      }

      await finishClaim(input.photoUploadId);
      const tokens = await auth.issueTokens(result.profile.userId);
      return { ...tokens, profile: toOwnProfile(result.profile) };
    },

    async getOwnProfile(userId) {
      const profile = await profiles.findProfileById(userId);
      if (profile === null) {
        throw sessionEnded();
      }
      return toOwnProfile(profile);
    },

    async updateOwnProfile(userId, input) {
      if (input.username !== undefined) {
        throw new ApiError(
          HTTP_BAD_REQUEST,
          ERROR_CODES.invalidInput,
          "The username cannot be changed.",
          "username",
        );
      }
      const genderCodes = await profiles.listGenderCodes();
      const changes: ProfileChanges = {};
      if (input.displayName !== undefined) {
        changes.displayName = checkDisplayName(input.displayName);
      }
      if (input.dateOfBirth !== undefined) {
        changes.dateOfBirth = checkDateOfBirth(input.dateOfBirth, now());
      }
      if (input.gender !== undefined) {
        changes.gender = checkGender(input.gender, genderCodes);
      }
      if (input.preferences !== undefined) {
        changes.preferences = checkPreferences(input.preferences, genderCodes);
      }
      if (input.location !== undefined) {
        const location = checkLocation(input.location);
        changes.location = {
          latitude: location.lat,
          longitude: location.lon,
          placeName: await lookUpPlaceName(location.lat, location.lon),
        };
      }
      const updated = await profiles.updateProfile(userId, changes);
      if (updated === null) {
        throw sessionEnded();
      }
      return toOwnProfile(updated);
    },

    async getPublicProfile(viewerId, userId) {
      const candidate = await profiles.findProfileById(userId);
      if (candidate === null) {
        throw new ApiError(HTTP_NOT_FOUND, ERROR_CODES.userNotFound, "That user does not exist.");
      }
      const viewer = await profiles.findProfileById(viewerId);
      if (viewer === null) {
        throw sessionEnded();
      }
      const [favoriteIds, matchScore] = await Promise.all([
        favorites.listFavoriteUserIds(viewerId),
        scorer.scoreCandidate(toMatchProfile(viewer), toMatchProfile(candidate)),
      ]);
      const km = distanceKm(
        { lat: viewer.latitude, lon: viewer.longitude },
        { lat: candidate.latitude, lon: candidate.longitude },
      );
      return {
        userId: candidate.userId,
        username: candidate.username,
        displayName: candidate.displayName,
        photoUrl: photoUrlFor(candidate.photoId),
        age: ageOn(candidate.dateOfBirth, now()),
        gender: candidate.gender,
        placeName: candidate.placeName,
        distanceKm: roundDistanceKm(km),
        matchScore,
        lookingFor: { ...candidate.preferences },
        isFavorite: favoriteIds.includes(candidate.userId),
      };
    },
  };
}
