/*
 * Test helper for tests that need a real PostgreSQL. They run only when TEST_DATABASE_URL is
 * set (and the migrations are applied to that database); otherwise they are skipped, so
 * `bun test` still works on a machine without a database.
 */
import { createPrismaClient } from "../../src/data/prismaClient";
import type { PrismaClient } from "../../src/generated/prisma/client";

/** The test database URL, or undefined when integration tests should be skipped. */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** Use as `describe.skipIf(!hasTestDatabase)(...)`. */
export const hasTestDatabase = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== "";

/**
 * Connect to the test database.
 * @returns a Prisma client for TEST_DATABASE_URL
 * @throws Error when TEST_DATABASE_URL is not set
 */
export function connectTestDatabase(): PrismaClient {
  if (TEST_DATABASE_URL === undefined || TEST_DATABASE_URL === "") {
    throw new Error("TEST_DATABASE_URL is not set");
  }
  return createPrismaClient(TEST_DATABASE_URL);
}

/**
 * Remove every user and everything that belongs to a user (sign-in methods, tokens, target
 * genders, messages, favorites, notes), so each test starts from an empty database. The
 * `genders` rows stay: the first migration creates them as reference data.
 * @param prisma - a client from connectTestDatabase
 */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe("TRUNCATE TABLE users CASCADE");
}

/** Optional changes to the user that `createTestUser` builds. */
export interface TestUserOptions {
  genderCode?: string;
  passwordHash?: string;
}

/**
 * Create a user with a password sign-in method and one target gender, like sign up does.
 * @param prisma - a client from connectTestDatabase
 * @param username - the (lowercase) username
 * @param options - optional gender and password hash
 * @returns the stored user
 */
export async function createTestUser(
  prisma: PrismaClient,
  username: string,
  options: TestUserOptions = {},
) {
  return prisma.user.create({
    data: {
      username,
      displayName: username,
      dateOfBirth: new Date("1999-05-17T00:00:00.000Z"),
      genderCode: options.genderCode ?? "female",
      photoKey: `profile-photos/test/${username}.jpg`,
      latitude: 13.7466,
      longitude: 100.5393,
      targetMinAge: 18,
      targetMaxAge: 40,
      targetRadiusKm: 50,
      targetGenders: { create: [{ genderCode: "male" }] },
      authMethods: {
        create: {
          authType: "password",
          passwordHash: options.passwordHash ?? `$argon2id$hash-of-${username}`,
        },
      },
    },
  });
}
