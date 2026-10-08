/*
 * Shared setup for the Profile tests: the nine users of the functional test plan (from the
 * Match fixtures) as stored profiles, the CP01 sign up of mint_01, a fixed clock, a fake place
 * lookup, in-memory photo uploads, alice's favorite chai and the fake Match Engine. Sign up
 * also registers the user in the in-memory Auth repository, so a test can log in afterwards.
 */
import { ApiError, ERROR_CODES } from "../../src/plugins/errors";
import { createMatchEngineClient } from "../../src/services/match/engineClient";
import type { MatchProfile } from "../../src/services/match/matchTypes";
import { createInMemoryFavoritesReader } from "../../src/services/messaging/inMemoryMessageRepository";
import { createInMemoryPhotoUploadClaimer } from "../../src/services/profile/inMemoryPhotoUploadClaimer";
import {
  createInMemoryProfileRepository,
  type InMemoryProfileRepository,
} from "../../src/services/profile/inMemoryProfileRepository";
import { createEngineMatchScorer } from "../../src/services/profile/matchScorer";
import type { StoredProfile } from "../../src/services/profile/profileRepository";
import { createProfileService } from "../../src/services/profile/profileService";
import type { LocationInput, SignUpInput } from "../../src/services/profile/profileTypes";
import { cheapHasher, createTestAuth } from "../auth/fixtures";
import { ALICE, CHAI, NOW, TEST_USERS, createFakeEngine } from "../match/fixtures";

const HTTP_INTERNAL_ERROR = 500;
const MS_PER_HOUR = 3_600_000;

/** The upload of square_500.jpg that the CP01 sign up uses. */
export const MINT_UPLOAD_ID = "0194a1b2-8d11-7a22-9b33-c4d5e6f7a8b9";
/** The place name the fake lookup gives by default. */
export const DEFAULT_PLACE_NAME = "Bangkok, Pathum Wan";
/** On NOW (8 Oct 2026) someone born on this day turns 18 today (CP15). */
export const TURNS_18_TODAY = "2008-10-08";
/** On NOW someone born on this day is still 17 and turns 18 tomorrow (CP14). */
export const TURNS_18_TOMORROW = "2008-10-09";

/**
 * The mint_01 sign up of the Seed Data sheet (CP01): Mint, female, 15 Sep 1999, at
 * 13.7300, 100.5300, wants male 24 to 32 within 30 km.
 * @param changes - fields to replace, for the tests of one rule
 * @returns the sign up body
 */
export function mintSignUp(changes: Partial<SignUpInput> = {}): SignUpInput {
  return {
    username: "mint_01",
    password: "Mint2026",
    displayName: "Mint",
    dateOfBirth: "1999-09-15",
    gender: "female",
    location: { lat: 13.73, lon: 100.53 },
    photoUploadId: MINT_UPLOAD_ID,
    preferences: { minAge: 24, maxAge: 32, targetGenders: ["male"], radiusKm: 30 },
    ...changes,
  };
}

/** Turn a Match fixture user into a stored profile with a photo key. */
function toStoredProfile(user: MatchProfile): { profile: StoredProfile; photoKey: string } {
  return {
    photoKey: `profile-photos/${user.photoId}.jpg`,
    profile: {
      userId: user.userId,
      username: user.username,
      displayName: user.displayName,
      dateOfBirth: user.dateOfBirth,
      gender: user.gender,
      latitude: user.latitude,
      longitude: user.longitude,
      placeName: user.placeName,
      photoId: user.photoId,
      preferences: {
        minAge: user.preference.ageMin,
        maxAge: user.preference.ageMax,
        targetGenders: user.preference.genders,
        radiusKm: user.preference.radiusKm,
      },
    },
  };
}

/** A fake Location Service: records each lookup, answers `state.placeName` or fails. */
function createFakePlaces() {
  const calls: LocationInput[] = [];
  const state: { placeName: string | null; isDown: boolean } = {
    placeName: DEFAULT_PLACE_NAME,
    isDown: false,
  };
  return {
    calls,
    state,
    async findPlaceName(lat: number, lon: number): Promise<string | null> {
      calls.push({ lat, lon });
      if (state.isDown) {
        throw new ApiError(
          HTTP_INTERNAL_ERROR,
          ERROR_CODES.geocoderUnavailable,
          "Nominatim did not answer.",
        );
      }
      return state.placeName;
    },
  };
}

/**
 * Build the Profile Service on in-memory data, with the nine test users, alice's favorite chai,
 * the mint_01 upload and a clock fixed at NOW.
 * @returns the service and every part a test may look at or change
 */
export async function createTestProfiles() {
  const auth = await createTestAuth();
  const stored = createInMemoryProfileRepository({ profiles: TEST_USERS.map(toStoredProfile) });
  // Sign up and login share the database in the real app; here sign up also fills the Auth
  // repository, so a test can log in as the new user.
  const profiles: InMemoryProfileRepository = {
    ...stored,
    async createProfile(profile) {
      const result = await stored.createProfile(profile);
      if (result.status === "created") {
        auth.repository.addUser(profile.username, {
          userId: result.profile.userId,
          passwordHash: profile.passwordHash,
        });
      }
      return result;
    },
  };
  const places = createFakePlaces();
  const photoUploads = createInMemoryPhotoUploadClaimer({ now: () => NOW });
  const addUpload = (uploadId: string) =>
    photoUploads.addUpload(uploadId, "jpg", new Date(NOW.getTime() + MS_PER_HOUR));
  addUpload(MINT_UPLOAD_ID);
  const engine = createFakeEngine();
  const service = createProfileService({
    profiles,
    hasher: cheapHasher,
    auth: auth.service,
    places,
    photoUploads,
    favorites: createInMemoryFavoritesReader({ [ALICE.userId]: [CHAI.userId] }),
    scorer: createEngineMatchScorer({
      engine: createMatchEngineClient({
        baseUrl: "http://match-engine.test:8000",
        timeoutMs: 1000,
        fetch: engine.fetch,
      }),
      now: () => NOW,
    }),
    now: () => NOW,
  });
  return { service, profiles, auth, places, photoUploads, addUpload, engine };
}
