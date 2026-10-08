/*
 * Schema tests on a real PostgreSQL, for the tables in prisma/schema.prisma (Chuan): keys,
 * unique rules, the gender reference rows, cascade deletes and the IDs the database makes.
 * The database has no CHECK rules (18 or older, 1 to 1000 characters and so on belong to the
 * services), so none are tested here.
 */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";

import type { PrismaClient } from "../../src/generated/prisma/client";
import { connectTestDatabase, createTestUser, hasTestDatabase, resetDatabase } from "./database";

/** Run a database call that must fail and return the error. */
async function failure(run: () => PromiseLike<unknown>): Promise<{ code?: string }> {
  try {
    await run();
  } catch (error) {
    return error as { code?: string };
  }
  throw new Error("The database call should have failed.");
}

describe.skipIf(!hasTestDatabase)("database schema", () => {
  const prisma: PrismaClient = hasTestDatabase ? connectTestDatabase() : (null as never);

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("has the four gender rows from the first migration", async () => {
    const genders = await prisma.gender.findMany({ orderBy: { code: "asc" } });
    expect(genders.map((gender) => gender.code)).toEqual(["female", "male", "non_binary", "other"]);
  });

  it("keeps the gender rows when the test reset runs", async () => {
    await createTestUser(prisma, "alice");
    await resetDatabase(prisma);
    expect(await prisma.gender.count()).toBe(4);
    expect(await prisma.user.count()).toBe(0);
  });

  it("makes UUID version 7 IDs in the database", async () => {
    const user = await createTestUser(prisma, "alice");
    expect(user.id[14]).toBe("7");
  });

  it("rejects a second user with the same username", async () => {
    await createTestUser(prisma, "alice");
    expect((await failure(() => createTestUser(prisma, "alice"))).code).toBe("P2002");
  });

  it("rejects a gender that is not in the genders table", async () => {
    await failure(() => createTestUser(prisma, "alice", { genderCode: "robot" }));
  });

  it("keeps one password sign-in method per user", async () => {
    const user = await createTestUser(prisma, "alice");
    const addSecondPassword = () =>
      prisma.userAuthMethod.create({
        data: { userId: user.id, authType: "password", passwordHash: "other" },
      });
    expect((await failure(addSecondPassword)).code).toBe("P2002");
  });

  it("keeps refresh token hashes unique", async () => {
    const user = await createTestUser(prisma, "alice");
    const data = {
      userId: user.id,
      tokenHash: "a".repeat(64),
      expiresAt: new Date("2026-11-07T10:00:00.000Z"),
    };
    await prisma.refreshToken.create({ data });
    expect((await failure(() => prisma.refreshToken.create({ data }))).code).toBe("P2002");
  });

  it("keeps one favorite per pair", async () => {
    const alice = await createTestUser(prisma, "alice");
    const chai = await createTestUser(prisma, "chai_01");
    const pin = () =>
      prisma.favorite.create({ data: { userId: alice.id, favoriteUserId: chai.id } });
    await pin();
    expect((await failure(pin)).code).toBe("P2002");
  });

  it("allows many notes about the same person and numbers them", async () => {
    const alice = await createTestUser(prisma, "alice");
    const chai = await createTestUser(prisma, "chai_01");
    const first = await prisma.note.create({
      data: { authorId: alice.id, subjectUserId: chai.id, body: "Met at a cafe." },
    });
    const second = await prisma.note.create({
      data: { authorId: alice.id, subjectUserId: chai.id, body: "Likes coffee." },
    });
    expect(second.id).toBeGreaterThan(first.id);
  });

  it("sets a reply's link to null when the original message is deleted", async () => {
    const alice = await createTestUser(prisma, "alice");
    const bob = await createTestUser(prisma, "bob_01");
    const original = await prisma.message.create({
      data: { senderId: alice.id, receiverId: bob.id, body: "Coffee?" },
    });
    const reply = await prisma.message.create({
      data: {
        senderId: bob.id,
        receiverId: alice.id,
        body: "Sure",
        replyToMessageId: original.id,
      },
    });
    await prisma.message.delete({ where: { id: original.id } });
    const after = await prisma.message.findUniqueOrThrow({ where: { id: reply.id } });
    expect(after.replyToMessageId).toBeNull();
  });

  it("deletes everything that belongs to a user with the user", async () => {
    const alice = await createTestUser(prisma, "alice");
    const bob = await createTestUser(prisma, "bob_01");
    await prisma.refreshToken.create({
      data: { userId: alice.id, tokenHash: "b".repeat(64), expiresAt: new Date() },
    });
    await prisma.message.create({
      data: { senderId: alice.id, receiverId: bob.id, body: "Hello" },
    });
    await prisma.favorite.create({ data: { userId: alice.id, favoriteUserId: bob.id } });
    await prisma.note.create({
      data: { authorId: alice.id, subjectUserId: bob.id, body: "Nice" },
    });

    await prisma.user.delete({ where: { id: alice.id } });

    expect(await prisma.userAuthMethod.count()).toBe(1);
    expect(await prisma.userTargetGender.count()).toBe(1);
    expect(await prisma.refreshToken.count()).toBe(0);
    expect(await prisma.message.count()).toBe(0);
    expect(await prisma.favorite.count()).toBe(0);
    expect(await prisma.note.count()).toBe(0);
  });

  it("stores times as UTC instants", async () => {
    const user = await createTestUser(prisma, "alice");
    const rows = await prisma.$queryRaw<{ type: string }[]>`
      SELECT pg_typeof(created_at)::text AS type FROM users WHERE id = ${user.id}::uuid`;
    expect(rows[0]?.type).toBe("timestamp with time zone");
  });
});
