/*
 * Profile Service tests on in-memory data: the Create Profile cases of the functional test plan
 * (CP01 to CP18 where the backend has a part), Edit Profile, the candidate profile with its
 * match score, and the username check.
 */
import { describe, expect, it } from "bun:test";

import { ERROR_CODES } from "../../src/plugins/errors";
import { distanceKm, roundDistanceKm } from "../../src/services/location/distance";
import { ALICE, BOB, CHAI, DAN, FAH, NOW } from "../match/fixtures";
import { expectApiError, UNKNOWN_USER_ID } from "../messaging/fixtures";
import {
  createTestProfiles,
  DEFAULT_PLACE_NAME,
  MINT_UPLOAD_ID,
  mintSignUp,
  TURNS_18_TODAY,
  TURNS_18_TOMORROW,
} from "./fixtures";

const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_INTERNAL_ERROR = 500;
const NO_SUCH_UUID = "00000000-0000-7000-8000-000000000000";
const SECOND_UPLOAD_ID = "0194a1b2-8d11-7a22-9b33-000000000002";
const MAX_SCORE = 100;
const FAKE_ENGINE_PENALTY_PER_KM = 2;
const DECIMAL = 10;

describe("checkUsername", () => {
  it("says a free username is available", async () => {
    const { service } = await createTestProfiles();
    expect(await service.checkUsername("mint_01")).toEqual({ isAvailable: true });
  });

  it("says a taken username is not available, in any letter case", async () => {
    const { service } = await createTestProfiles();
    expect(await service.checkUsername("alice")).toEqual({ isAvailable: false });
    expect(await service.checkUsername("ALICE")).toEqual({ isAvailable: false });
  });

  it("rejects a username that breaks rule A1 with 400 username", async () => {
    const { service } = await createTestProfiles();
    for (const username of ["", "abc", "mint#01", "abcdefghij0123456789x"]) {
      await expectApiError(
        service.checkUsername(username),
        HTTP_BAD_REQUEST,
        ERROR_CODES.invalidInput,
        "username",
      );
    }
  });
});

describe("signUp", () => {
  it("CP01: creates the profile, returns tokens, and the new user can log in", async () => {
    const { service, auth, photoUploads } = await createTestProfiles();
    const result = await service.signUp(mintSignUp());

    expect(result.profile).toMatchObject({
      username: "mint_01",
      displayName: "Mint",
      dateOfBirth: "1999-09-15",
      gender: "female",
      location: { lat: 13.73, lon: 100.53 },
      preferences: { minAge: 24, maxAge: 32, targetGenders: ["male"], radiusKm: 30 },
    });
    expect(await auth.service.validateSession(result.accessToken)).toEqual({
      userId: result.profile.userId,
    });
    const login = await auth.service.login("mint_01", "Mint2026");
    expect(await auth.service.validateSession(login.accessToken)).toEqual({
      userId: result.profile.userId,
    });
    expect(await service.getOwnProfile(result.profile.userId)).toEqual(result.profile);

    // The upload became the profile photo, and the temporary upload is gone.
    const [photoKey] = photoUploads.listProfilePhotoKeys();
    expect(photoKey).toMatch(/^profile-photos\/[0-9a-f-]{36}\.jpg$/);
    expect(result.profile.photoUrl).toBe(
      `/api/v1/photos/${photoKey?.slice("profile-photos/".length, -".jpg".length)}`,
    );
    expect(photoUploads.hasUpload(MINT_UPLOAD_ID)).toBe(false);
  });

  it("CP02: stores the place name of the location", async () => {
    const { service, places } = await createTestProfiles();
    const result = await service.signUp(mintSignUp());
    expect(result.profile.placeName).toBe(DEFAULT_PLACE_NAME);
    expect(places.calls).toEqual([{ lat: 13.73, lon: 100.53 }]);
  });

  it("CP04: rejects a taken username in any letter case with 409, and keeps the upload", async () => {
    const { service, photoUploads, places } = await createTestProfiles();
    for (const username of ["alice", "Alice"]) {
      await expectApiError(
        service.signUp(mintSignUp({ username })),
        HTTP_CONFLICT,
        ERROR_CODES.usernameTaken,
        "username",
      );
    }
    expect(photoUploads.hasUpload(MINT_UPLOAD_ID)).toBe(true);
    expect(photoUploads.listProfilePhotoKeys()).toEqual([]);
    expect(places.calls).toEqual([]);
  });

  it("CP05, CP06, CP07: rejects a short, odd or empty username with 400 username", async () => {
    const { service } = await createTestProfiles();
    for (const username of ["abc", "mint#01", ""]) {
      await expectApiError(
        service.signUp(mintSignUp({ username })),
        HTTP_BAD_REQUEST,
        ERROR_CODES.invalidInput,
        "username",
      );
    }
  });

  it("CP08: accepts a 20 character username and keeps it whole, in lowercase", async () => {
    const { service } = await createTestProfiles();
    const result = await service.signUp(mintSignUp({ username: "ABCDEFGHIJ0123456789" }));
    expect(result.profile.username).toBe("abcdefghij0123456789");
  });

  it("CP09: of two sign ups with one username at the same time, one gets 409", async () => {
    const { service, addUpload, photoUploads } = await createTestProfiles();
    addUpload(SECOND_UPLOAD_ID);
    const outcomes = await Promise.allSettled([
      service.signUp(mintSignUp({ username: "race_01" })),
      service.signUp(mintSignUp({ username: "race_01", photoUploadId: SECOND_UPLOAD_ID })),
    ]);
    const statuses = outcomes.map((outcome) =>
      outcome.status === "fulfilled" ? "created" : (outcome.reason as { code: string }).code,
    );
    expect(statuses.sort()).toEqual(["USERNAME_TAKEN", "created"]);
    // The loser's photo object was removed again.
    expect(photoUploads.listProfilePhotoKeys()).toHaveLength(1);
  });

  it("CP10: rejects a short password and says it is too short", async () => {
    const { service } = await createTestProfiles();
    let message = "";
    try {
      await service.signUp(mintSignUp({ password: "abc12" }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("too short");
    expect(message).toContain("8 characters");
  });

  it("rejects a password without a letter or without a digit with 400 password", async () => {
    const { service } = await createTestProfiles();
    for (const password of ["Mintmint", "12345678", "x".repeat(1001)]) {
      await expectApiError(
        service.signUp(mintSignUp({ password })),
        HTTP_BAD_REQUEST,
        ERROR_CODES.invalidInput,
        "password",
      );
    }
  });

  it("CP12: stores the password as an Argon2id hash, never as text", async () => {
    const { service, auth, profiles } = await createTestProfiles();
    const result = await service.signUp(mintSignUp());
    const hash = profiles.passwordHashOf(result.profile.userId);
    expect(hash?.startsWith("$argon2id$")).toBe(true);
    expect(hash).not.toContain("Mint2026");
    expect((await auth.repository.findCredentialsByUsername("mint_01"))?.passwordHash).toBe(
      hash as string,
    );
  });

  it("CP13: rejects a date of birth in the future with 400 dateOfBirth", async () => {
    const { service } = await createTestProfiles();
    let message = "";
    try {
      await service.signUp(mintSignUp({ dateOfBirth: "2030-01-01" }));
    } catch (error) {
      message = (error as Error).message;
      expect((error as { field?: string }).field).toBe("dateOfBirth");
    }
    expect(message).toContain("future");
  });

  it("CP14: rejects someone who turns 18 tomorrow", async () => {
    const { service } = await createTestProfiles();
    let message = "";
    try {
      await service.signUp(mintSignUp({ dateOfBirth: TURNS_18_TOMORROW }));
    } catch (error) {
      message = (error as Error).message;
      expect((error as { field?: string }).field).toBe("dateOfBirth");
    }
    expect(message).toContain("at least 18");
  });

  it("CP15: accepts someone who turns 18 today, shown with age 18", async () => {
    const { service } = await createTestProfiles();
    const result = await service.signUp(
      mintSignUp({ username: "teen_ok", dateOfBirth: TURNS_18_TODAY }),
    );
    expect(result.profile.dateOfBirth).toBe(TURNS_18_TODAY);
    expect((await service.getPublicProfile(ALICE.userId, result.profile.userId)).age).toBe(18);
  });

  it("rejects a date that does not exist or is not YYYY-MM-DD with 400 dateOfBirth", async () => {
    const { service } = await createTestProfiles();
    for (const dateOfBirth of ["2001-02-30", "15/09/1999", "1999-9-15", "0999-01-01", ""]) {
      await expectApiError(
        service.signUp(mintSignUp({ dateOfBirth })),
        HTTP_BAD_REQUEST,
        ERROR_CODES.invalidInput,
        "dateOfBirth",
      );
    }
  });

  it("CP16: rejects an empty display name with 400 displayName", async () => {
    const { service } = await createTestProfiles();
    for (const displayName of ["", "   "]) {
      await expectApiError(
        service.signUp(mintSignUp({ displayName })),
        HTTP_BAD_REQUEST,
        ERROR_CODES.invalidInput,
        "displayName",
      );
    }
  });

  it("allows a display name of 50 characters, trims spaces, and rejects 51", async () => {
    const { service, addUpload } = await createTestProfiles();
    const fifty = "M".repeat(50);
    const result = await service.signUp(mintSignUp({ displayName: `  ${fifty}  ` }));
    expect(result.profile.displayName).toBe(fifty);
    addUpload(SECOND_UPLOAD_ID);
    await expectApiError(
      service.signUp(
        mintSignUp({
          username: "mint_02",
          displayName: "M".repeat(51),
          photoUploadId: SECOND_UPLOAD_ID,
        }),
      ),
      HTTP_BAD_REQUEST,
      ERROR_CODES.invalidInput,
      "displayName",
    );
  });

  it("CP17: still saves the profile, with no place name, when the lookup fails", async () => {
    const { service, places } = await createTestProfiles();
    places.state.isDown = true;
    const result = await service.signUp(mintSignUp({ location: { lat: 12.5, lon: 100.9 } }));
    expect(result.profile.placeName).toBeNull();
    expect(await service.getOwnProfile(result.profile.userId)).toEqual(result.profile);
  });

  it("CP17: saves no place name for a point that has none (the sea)", async () => {
    const { service, places } = await createTestProfiles();
    places.state.placeName = null;
    const result = await service.signUp(mintSignUp({ location: { lat: 12.5, lon: 100.9 } }));
    expect(result.profile.placeName).toBeNull();
  });

  it("CP18: saves injection text in the display name exactly as typed", async () => {
    const { service } = await createTestProfiles();
    const result = await service.signUp(mintSignUp({ displayName: "' OR '1'='1" }));
    expect(result.profile.displayName).toBe("' OR '1'='1");
  });

  it("accepts prefer_not_to_say and rejects the old code other", async () => {
    const { service, addUpload } = await createTestProfiles();
    const result = await service.signUp(mintSignUp({ gender: "prefer_not_to_say" }));
    expect(result.profile.gender).toBe("prefer_not_to_say");
    addUpload(SECOND_UPLOAD_ID);
    await expectApiError(
      service.signUp(
        mintSignUp({ username: "mint_02", gender: "other", photoUploadId: SECOND_UPLOAD_ID }),
      ),
      HTTP_BAD_REQUEST,
      ERROR_CODES.invalidInput,
      "gender",
    );
  });

  it("rejects a location out of range with the dotted field name", async () => {
    const { service } = await createTestProfiles();
    await expectApiError(
      service.signUp(mintSignUp({ location: { lat: 91, lon: 100 } })),
      HTTP_BAD_REQUEST,
      ERROR_CODES.invalidInput,
      "location.lat",
    );
    await expectApiError(
      service.signUp(mintSignUp({ location: { lat: 13, lon: -181 } })),
      HTTP_BAD_REQUEST,
      ERROR_CODES.invalidInput,
      "location.lon",
    );
  });

  it("rejects each broken preference with its dotted field name", async () => {
    const { service } = await createTestProfiles();
    const valid = mintSignUp().preferences;
    const cases: [Partial<typeof valid>, string][] = [
      [{ minAge: 17 }, "preferences.minAge"],
      [{ minAge: 24.5 }, "preferences.minAge"],
      [{ minAge: 30, maxAge: 25 }, "preferences.minAge"],
      [{ maxAge: 121 }, "preferences.maxAge"],
      [{ targetGenders: [] }, "preferences.targetGenders"],
      [{ targetGenders: ["male", "robot"] }, "preferences.targetGenders"],
      [{ radiusKm: 0 }, "preferences.radiusKm"],
      [{ radiusKm: 2.5 }, "preferences.radiusKm"],
      [{ radiusKm: 20_001 }, "preferences.radiusKm"],
    ];
    for (const [change, field] of cases) {
      await expectApiError(
        service.signUp(mintSignUp({ preferences: { ...valid, ...change } })),
        HTTP_BAD_REQUEST,
        ERROR_CODES.invalidInput,
        field,
      );
    }
  });

  it("stores a target gender sent twice only once, and allows a radius of 20000 km", async () => {
    const { service } = await createTestProfiles();
    const result = await service.signUp(
      mintSignUp({
        preferences: {
          minAge: 18,
          maxAge: 120,
          targetGenders: ["non_binary", "male", "male"],
          radiusKm: 20_000,
        },
      }),
    );
    expect(result.profile.preferences).toEqual({
      minAge: 18,
      maxAge: 120,
      targetGenders: ["male", "non_binary"],
      radiusKm: 20_000,
    });
  });

  it("rejects an unknown, expired or used upload with 400 photoUploadId", async () => {
    const { service, photoUploads } = await createTestProfiles();
    await expectApiError(
      service.signUp(mintSignUp({ photoUploadId: NO_SUCH_UUID })),
      HTTP_BAD_REQUEST,
      ERROR_CODES.invalidInput,
      "photoUploadId",
    );
    photoUploads.addUpload(SECOND_UPLOAD_ID, "png", NOW);
    await expectApiError(
      service.signUp(mintSignUp({ photoUploadId: SECOND_UPLOAD_ID })),
      HTTP_BAD_REQUEST,
      ERROR_CODES.invalidInput,
      "photoUploadId",
    );
    await service.signUp(mintSignUp());
    await expectApiError(
      service.signUp(mintSignUp({ username: "mint_02" })),
      HTTP_BAD_REQUEST,
      ERROR_CODES.invalidInput,
      "photoUploadId",
    );
  });

  it("removes the prepared photo and keeps the upload when saving fails", async () => {
    const { service, profiles, photoUploads } = await createTestProfiles();
    profiles.createProfile = async () => {
      throw new Error("The database is down.");
    };
    await expect(service.signUp(mintSignUp())).rejects.toThrow("The database is down.");
    expect(photoUploads.listProfilePhotoKeys()).toEqual([]);
    expect(photoUploads.hasUpload(MINT_UPLOAD_ID)).toBe(true);
  });

  it("checks every rule before it looks up the place or touches the photo", async () => {
    const { service, places, photoUploads } = await createTestProfiles();
    await expectApiError(
      service.signUp(mintSignUp({ preferences: { ...mintSignUp().preferences, radiusKm: 0 } })),
      HTTP_BAD_REQUEST,
      ERROR_CODES.invalidInput,
      "preferences.radiusKm",
    );
    expect(places.calls).toEqual([]);
    expect(photoUploads.listProfilePhotoKeys()).toEqual([]);
  });
});

describe("getOwnProfile", () => {
  it("gives alice her own profile with date of birth, location and photo path", async () => {
    const { service } = await createTestProfiles();
    expect(await service.getOwnProfile(ALICE.userId)).toEqual({
      userId: ALICE.userId,
      username: "alice",
      displayName: "Alice",
      dateOfBirth: "1999-03-10",
      gender: "female",
      location: { lat: 13.7466, lon: 100.5393 },
      placeName: "Bangkok, Pathum Wan",
      photoUrl: "/api/v1/photos/pho_alice",
      preferences: { minAge: 24, maxAge: 32, targetGenders: ["male"], radiusKm: 50 },
    });
  });

  it("answers 401 when the user no longer exists", async () => {
    const { service } = await createTestProfiles();
    await expectApiError(
      service.getOwnProfile(NO_SUCH_UUID),
      HTTP_UNAUTHORIZED,
      ERROR_CODES.unauthenticated,
    );
  });
});

describe("updateOwnProfile", () => {
  it("changes only the fields that are sent", async () => {
    const { service } = await createTestProfiles();
    const before = await service.getOwnProfile(ALICE.userId);
    const after = await service.updateOwnProfile(ALICE.userId, {
      displayName: "  Ali  ",
      gender: "prefer_not_to_say",
      dateOfBirth: "1999-03-11",
    });
    expect(after).toEqual({
      ...before,
      displayName: "Ali",
      gender: "prefer_not_to_say",
      dateOfBirth: "1999-03-11",
    });
    expect(await service.getOwnProfile(ALICE.userId)).toEqual(after);
  });

  it("replaces the preferences as a whole", async () => {
    const { service } = await createTestProfiles();
    const preferences = {
      minAge: 30,
      maxAge: 40,
      targetGenders: ["non_binary", "female"],
      radiusKm: 5,
    };
    const after = await service.updateOwnProfile(ALICE.userId, { preferences });
    expect(after.preferences).toEqual({ ...preferences, targetGenders: ["female", "non_binary"] });
  });

  it("gives a new location a new place name", async () => {
    const { service, places } = await createTestProfiles();
    places.state.placeName = "Chiang Mai, Mueang Chiang Mai";
    const after = await service.updateOwnProfile(ALICE.userId, {
      location: { lat: 18.7883, lon: 98.9853 },
    });
    expect(after.location).toEqual({ lat: 18.7883, lon: 98.9853 });
    expect(after.placeName).toBe("Chiang Mai, Mueang Chiang Mai");
    expect(places.calls).toEqual([{ lat: 18.7883, lon: 98.9853 }]);
  });

  it("clears the old place name when the lookup for the new location fails", async () => {
    const { service, places } = await createTestProfiles();
    places.state.isDown = true;
    const after = await service.updateOwnProfile(ALICE.userId, {
      location: { lat: 12.5, lon: 100.9 },
    });
    expect(after.placeName).toBeNull();
  });

  it("does not look up the place when the location is not sent", async () => {
    const { service, places } = await createTestProfiles();
    const after = await service.updateOwnProfile(ALICE.userId, { displayName: "Ali" });
    expect(after.placeName).toBe("Bangkok, Pathum Wan");
    expect(places.calls).toEqual([]);
  });

  it("rejects a username with 400 username and changes nothing", async () => {
    const { service } = await createTestProfiles();
    const before = await service.getOwnProfile(ALICE.userId);
    await expectApiError(
      service.updateOwnProfile(ALICE.userId, { username: "alice_2", displayName: "Ali" }),
      HTTP_BAD_REQUEST,
      ERROR_CODES.invalidInput,
      "username",
    );
    expect(await service.getOwnProfile(ALICE.userId)).toEqual(before);
  });

  it("checks each field with the sign up rules", async () => {
    const { service } = await createTestProfiles();
    const preferences = (await service.getOwnProfile(ALICE.userId)).preferences;
    const cases: [Parameters<typeof service.updateOwnProfile>[1], string][] = [
      [{ displayName: " " }, "displayName"],
      [{ dateOfBirth: "2030-01-01" }, "dateOfBirth"],
      [{ dateOfBirth: TURNS_18_TOMORROW }, "dateOfBirth"],
      [{ gender: "other" }, "gender"],
      [{ location: { lat: 91, lon: 0 } }, "location.lat"],
      [{ preferences: { ...preferences, radiusKm: 0 } }, "preferences.radiusKm"],
    ];
    for (const [input, field] of cases) {
      await expectApiError(
        service.updateOwnProfile(ALICE.userId, input),
        HTTP_BAD_REQUEST,
        ERROR_CODES.invalidInput,
        field,
      );
    }
  });

  it("keeps the profile as it is for an empty body", async () => {
    const { service } = await createTestProfiles();
    const before = await service.getOwnProfile(ALICE.userId);
    expect(await service.updateOwnProfile(ALICE.userId, {})).toEqual(before);
  });

  it("answers 401 when the user no longer exists", async () => {
    const { service } = await createTestProfiles();
    await expectApiError(
      service.updateOwnProfile(NO_SUCH_UUID, { displayName: "Ghost" }),
      HTTP_UNAUTHORIZED,
      ERROR_CODES.unauthenticated,
    );
  });
});

describe("getPublicProfile", () => {
  it("shows bob to alice as a card with match score, his preferences and no private data", async () => {
    const { service } = await createTestProfiles();
    const card = await service.getPublicProfile(ALICE.userId, BOB.userId);
    const km = distanceKm(
      { lat: ALICE.latitude, lon: ALICE.longitude },
      { lat: BOB.latitude, lon: BOB.longitude },
    );
    // The fake engine scores 100 minus 2 points per km, to one decimal.
    const engineScore =
      Math.round((MAX_SCORE - km * FAKE_ENGINE_PENALTY_PER_KM) * DECIMAL) / DECIMAL;
    expect(card).toEqual({
      userId: BOB.userId,
      username: "bob",
      displayName: "Bob",
      photoUrl: "/api/v1/photos/pho_bob",
      age: 28,
      gender: "male",
      placeName: "Bangkok, Bang Rak",
      distanceKm: roundDistanceKm(km),
      matchScore: Math.round(engineScore),
      lookingFor: { minAge: 22, maxAge: 30, targetGenders: ["female"], radiusKm: 30 },
      isFavorite: false,
    });
    expect(Object.keys(card)).not.toContain("dateOfBirth");
    expect(Object.keys(card)).not.toContain("location");
  });

  it("says chai is alice's favorite", async () => {
    const { service } = await createTestProfiles();
    expect((await service.getPublicProfile(ALICE.userId, CHAI.userId)).isFavorite).toBe(true);
  });

  it("gives a match score of 0 without asking the engine when they do not fit both ways", async () => {
    const { service, engine } = await createTestProfiles();
    expect((await service.getPublicProfile(ALICE.userId, FAH.userId)).matchScore).toBe(0);
    expect((await service.getPublicProfile(ALICE.userId, DAN.userId)).matchScore).toBe(0);
    expect((await service.getPublicProfile(ALICE.userId, ALICE.userId)).matchScore).toBe(0);
    expect(engine.calls).toEqual([]);
  });

  it("sends the engine only the two users, without dates of birth", async () => {
    const { service, engine } = await createTestProfiles();
    await service.getPublicProfile(ALICE.userId, BOB.userId);
    expect(engine.calls).toHaveLength(1);
    const body = engine.calls[0]?.body as { candidates: { userId: string }[]; limit: number };
    expect(body.limit).toBe(1);
    expect(body.candidates.map((candidate) => candidate.userId)).toEqual([BOB.userId]);
    expect(JSON.stringify(body)).not.toContain("dateOfBirth");
  });

  it("answers 404 USER_NOT_FOUND for an unknown user or an ID that is not a UUID", async () => {
    const { service } = await createTestProfiles();
    for (const userId of [NO_SUCH_UUID, UNKNOWN_USER_ID]) {
      await expectApiError(
        service.getPublicProfile(ALICE.userId, userId),
        HTTP_NOT_FOUND,
        ERROR_CODES.userNotFound,
      );
    }
  });

  it("answers 500 MATCH_ENGINE_UNAVAILABLE when the engine is down", async () => {
    const { service, engine } = await createTestProfiles();
    engine.state.isDown = true;
    await expectApiError(
      service.getPublicProfile(ALICE.userId, BOB.userId),
      HTTP_INTERNAL_ERROR,
      ERROR_CODES.matchEngineUnavailable,
    );
  });
});
