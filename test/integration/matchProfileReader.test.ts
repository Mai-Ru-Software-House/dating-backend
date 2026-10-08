/*
 * Tests for the Prisma Match profile reader on a real PostgreSQL, with the nine users of the
 * functional test plan: the field mapping, the pool, and the whole FM01 flow (reader, mutual
 * rule, fake engine, cards).
 */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";

import {
  createPrismaMatchProfileReader,
  photoIdFromKey,
} from "../../src/data/prismaMatchProfileReader";
import type { PrismaClient } from "../../src/generated/prisma/client";
import { createMatchEngineClient } from "../../src/services/match/engineClient";
import { createMatchService } from "../../src/services/match/matchService";
import type { MatchProfile } from "../../src/services/match/matchTypes";
import { NOW, TEST_USERS, createFakeEngine } from "../match/fixtures";
import { connectTestDatabase, hasTestDatabase, resetDatabase } from "./database";

const NO_SUCH_USER_ID = "00000000-0000-7000-8000-000000000000";

describe("photoIdFromKey", () => {
  it("uses the file name without its extension", () => {
    expect(photoIdFromKey("profile-photos/seed/alice.jpg")).toBe("alice");
    expect(photoIdFromKey("profile-photos/0194f.webp")).toBe("0194f");
    expect(photoIdFromKey("plain")).toBe("plain");
  });
});

describe.skipIf(!hasTestDatabase)("Prisma Match profile reader", () => {
  const prisma: PrismaClient = hasTestDatabase ? connectTestDatabase() : (null as never);
  const reader = createPrismaMatchProfileReader(prisma);
  const idByUsername = new Map<string, string>();

  async function insert(profile: MatchProfile): Promise<void> {
    const user = await prisma.user.create({
      data: {
        username: profile.username,
        displayName: profile.displayName,
        dateOfBirth: profile.dateOfBirth,
        genderCode: profile.gender,
        photoKey: `profile-photos/seed/${profile.username}.jpg`,
        latitude: profile.latitude,
        longitude: profile.longitude,
        placeName: profile.placeName,
        targetMinAge: profile.preference.ageMin,
        targetMaxAge: profile.preference.ageMax,
        targetRadiusKm: profile.preference.radiusKm,
        targetGenders: {
          create: profile.preference.genders.map((genderCode) => ({ genderCode })),
        },
      },
    });
    idByUsername.set(profile.username, user.id);
  }

  beforeEach(async () => {
    await resetDatabase(prisma);
    idByUsername.clear();
    for (const profile of TEST_USERS) {
      await insert(profile);
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("maps a user, the target preferences and the photo ID", async () => {
    const alice = await reader.findProfile(idByUsername.get("alice") as string);
    expect(alice).toEqual({
      userId: idByUsername.get("alice") as string,
      username: "alice",
      displayName: "Alice",
      photoId: "alice",
      gender: "female",
      dateOfBirth: new Date("1999-03-10T00:00:00.000Z"),
      latitude: 13.7466,
      longitude: 100.5393,
      placeName: "Bangkok, Pathum Wan",
      preference: { ageMin: 24, ageMax: 32, genders: ["male"], radiusKm: 50 },
    });
  });

  it("returns null for an unknown user and for an ID that is not a UUID", async () => {
    expect(await reader.findProfile(NO_SUCH_USER_ID)).toBeNull();
    expect(await reader.findProfile("99999")).toBeNull();
  });

  it("lists everyone except the user, and honours the limit", async () => {
    const aliceId = idByUsername.get("alice") as string;
    const pool = await reader.listPool(aliceId, 2000);
    expect(pool).toHaveLength(TEST_USERS.length - 1);
    expect(pool.map((profile) => profile.userId)).not.toContain(aliceId);
    expect(await reader.listPool(aliceId, 3)).toHaveLength(3);
  });

  it("keeps several target genders", async () => {
    const bobId = idByUsername.get("bob") as string;
    await prisma.userTargetGender.create({ data: { userId: bobId, genderCode: "non_binary" } });
    const bob = await reader.findProfile(bobId);
    expect([...(bob?.preference.genders ?? [])].sort()).toEqual(["female", "non_binary"]);
  });

  it("FM01 on the database: alice sees bob and chai only", async () => {
    const engine = createFakeEngine();
    const service = createMatchService({
      profiles: reader,
      engine: createMatchEngineClient({
        baseUrl: "http://match-engine.test:8000",
        timeoutMs: 1000,
        fetch: engine.fetch,
      }),
      now: () => NOW,
    });

    const { recommendations } = await service.getRecommendations(
      idByUsername.get("alice") as string,
      {},
    );
    expect(recommendations.map((card) => card.username)).toEqual(["bob", "chai"]);
    expect(recommendations.map((card) => card.userId)).toEqual([
      idByUsername.get("bob") as string,
      idByUsername.get("chai") as string,
    ]);
  });
});
