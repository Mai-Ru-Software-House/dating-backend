/*
 * Sign up on a real PostgreSQL, through the Profile Service with the Prisma repositories: CP01
 * (the new user can log in), CP09 (two sign ups with one username: one 409, one row) and CP12
 * (the password is an Argon2id hash in user_auth_methods). They need TEST_DATABASE_URL and run
 * on Linux or WSL.
 */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";

import { createPrismaAuthRepository } from "../../src/data/prismaAuthRepository";
import { createPrismaProfileRepository } from "../../src/data/prismaProfileRepository";
import type { PrismaClient } from "../../src/generated/prisma/client";
import { createAuthService } from "../../src/services/auth/authService";
import { createTokenService } from "../../src/services/auth/tokens";
import { createInMemoryFavoritesReader } from "../../src/services/messaging/inMemoryMessageRepository";
import { createInMemoryPhotoUploadClaimer } from "../../src/services/profile/inMemoryPhotoUploadClaimer";
import { NO_MATCH_SCORE } from "../../src/services/profile/matchScorer";
import { createProfileService } from "../../src/services/profile/profileService";
import { cheapHasher, REFRESH_TTL_DAYS, TEST_JWT_SECRET } from "../auth/fixtures";
import { NOW } from "../match/fixtures";
import { MINT_UPLOAD_ID, mintSignUp } from "../profile/fixtures";
import { connectTestDatabase, hasTestDatabase, resetDatabase } from "./database";

const ACCESS_TTL_SECONDS = 900;
const MS_PER_HOUR = 3_600_000;
const SECOND_UPLOAD_ID = "0194a1b2-8d11-7a22-9b33-000000000002";

describe.skipIf(!hasTestDatabase)("sign up on PostgreSQL", () => {
  const prisma: PrismaClient = hasTestDatabase ? connectTestDatabase() : (null as never);

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function build() {
    const auth = createAuthService({
      repository: createPrismaAuthRepository(prisma),
      hasher: cheapHasher,
      tokens: createTokenService({ secret: TEST_JWT_SECRET, accessTtlSeconds: ACCESS_TTL_SECONDS }),
      refreshTtlDays: REFRESH_TTL_DAYS,
    });
    const photoUploads = createInMemoryPhotoUploadClaimer();
    const expiresAt = new Date(Date.now() + MS_PER_HOUR);
    photoUploads.addUpload(MINT_UPLOAD_ID, "jpg", expiresAt);
    photoUploads.addUpload(SECOND_UPLOAD_ID, "png", expiresAt);
    const service = createProfileService({
      profiles: createPrismaProfileRepository(prisma),
      hasher: cheapHasher,
      auth,
      places: { findPlaceName: async () => "Bangkok, Pathum Wan" },
      photoUploads,
      favorites: createInMemoryFavoritesReader(),
      scorer: { scoreCandidate: async () => NO_MATCH_SCORE },
      now: () => NOW,
    });
    return { auth, service };
  }

  it("CP01, CP12: stores mint_01 with an Argon2id hash, and mint_01 can log in", async () => {
    const { auth, service } = build();
    const result = await service.signUp(mintSignUp());

    const login = await auth.login("MINT_01", "Mint2026");
    expect(await auth.validateSession(login.accessToken)).toEqual({
      userId: result.profile.userId,
    });

    const method = await prisma.userAuthMethod.findUniqueOrThrow({
      where: { userId_authType: { userId: result.profile.userId, authType: "password" } },
    });
    expect(method.passwordHash?.startsWith("$argon2id$")).toBe(true);
    expect(method.passwordHash).not.toContain("Mint2026");
    // Sign up and login each stored one refresh token.
    expect(await prisma.refreshToken.count({ where: { userId: result.profile.userId } })).toBe(2);
    expect(await service.getOwnProfile(result.profile.userId)).toEqual(result.profile);
  });

  it("CP09: two sign ups with one username at the same time leave one user and one 409", async () => {
    const { service } = build();
    const outcomes = await Promise.allSettled([
      service.signUp(mintSignUp({ username: "race_01" })),
      service.signUp(mintSignUp({ username: "race_01", photoUploadId: SECOND_UPLOAD_ID })),
    ]);
    const statuses = outcomes.map((outcome) =>
      outcome.status === "fulfilled" ? "created" : (outcome.reason as { code: string }).code,
    );
    expect(statuses.sort()).toEqual(["USERNAME_TAKEN", "created"]);
    expect(await prisma.user.count({ where: { username: "race_01" } })).toBe(1);
    expect(await prisma.userAuthMethod.count()).toBe(1);
    expect(await prisma.userTargetGender.count()).toBe(1);
  });
});
