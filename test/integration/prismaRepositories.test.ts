/*
 * The repository behaviour tests (test/repositories/contracts.ts), run against PostgreSQL with
 * the Prisma repositories: messages, favorites, notes, the user reader, profiles and profile
 * photos. They need TEST_DATABASE_URL and run on Linux or WSL.
 */
import { afterAll, describe } from "bun:test";

import {
  createPrismaFavoritesRepository,
  createPrismaNotesRepository,
} from "../../src/data/prismaFavoritesNotesRepository";
import {
  createPrismaMessageRepository,
  createPrismaUserReader,
} from "../../src/data/prismaMessageRepository";
import { createPrismaProfilePhotoRepository } from "../../src/data/prismaProfilePhotoRepository";
import { createPrismaProfileRepository } from "../../src/data/prismaProfileRepository";
import type { PrismaClient } from "../../src/generated/prisma/client";
import {
  describeFavoritesRepository,
  describeMessageRepository,
  describeNotesRepository,
  describeProfilePhotoRepository,
  describeProfileRepository,
  describeUserReader,
  type People,
} from "../repositories/contracts";
import { connectTestDatabase, createTestUser, hasTestDatabase, resetDatabase } from "./database";

describe.skipIf(!hasTestDatabase)("Prisma repositories", () => {
  const prisma: PrismaClient = hasTestDatabase ? connectTestDatabase() : (null as never);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Empty the database and create alice, bob and chai. */
  async function freshPeople(): Promise<People> {
    await resetDatabase(prisma);
    const alice = await createTestUser(prisma, "alice");
    const bob = await createTestUser(prisma, "bob_01");
    const chai = await createTestUser(prisma, "chai_01");
    return { alice: alice.id, bob: bob.id, chai: chai.id };
  }

  describeMessageRepository(async () => ({
    ...(await freshPeople()),
    repository: createPrismaMessageRepository(prisma),
  }));

  describeFavoritesRepository(async () => ({
    ...(await freshPeople()),
    repository: createPrismaFavoritesRepository(prisma),
  }));

  describeNotesRepository(async () => ({
    ...(await freshPeople()),
    repository: createPrismaNotesRepository(prisma),
  }));

  describeUserReader(async () => {
    const people = await freshPeople();
    const expected = {
      [people.alice]: { displayName: "alice", photoUrl: "/api/v1/photos/alice" },
      [people.bob]: { displayName: "bob_01", photoUrl: "/api/v1/photos/bob_01" },
      [people.chai]: { displayName: "chai_01", photoUrl: "/api/v1/photos/chai_01" },
    };
    return { ...people, reader: createPrismaUserReader(prisma), expected };
  });

  describeProfileRepository(async () => {
    await resetDatabase(prisma);
    return { repository: createPrismaProfileRepository(prisma) };
  });

  describeProfilePhotoRepository(async () => {
    const people = await freshPeople();
    const alice = { userId: people.alice, photoKey: `profile-photos/${Bun.randomUUIDv7()}.jpg` };
    const bob = { userId: people.bob, photoKey: `profile-photos/${Bun.randomUUIDv7()}.webp` };
    for (const user of [alice, bob]) {
      await prisma.user.update({ where: { id: user.userId }, data: { photoKey: user.photoKey } });
    }
    return { repository: createPrismaProfilePhotoRepository(prisma), alice, bob };
  });
});
