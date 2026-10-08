/*
 * Tests for the Prisma Auth repository on a real PostgreSQL: credentials lookup in
 * `user_auth_methods` and refresh token rotation, including two requests with the same token
 * at the same time. Token hashes are 64 characters, like the SHA-256 hex the service stores.
 */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";

import { createPrismaAuthRepository } from "../../src/data/prismaAuthRepository";
import type { PrismaClient } from "../../src/generated/prisma/client";
import { connectTestDatabase, createTestUser, hasTestDatabase, resetDatabase } from "./database";

const NOW = new Date("2026-10-07T10:00:00.000Z");
const LATER = new Date("2026-11-07T10:00:00.000Z");
const MUCH_LATER = new Date("2026-12-07T10:00:00.000Z");

/** A fake token hash with the right length, different for each label. */
function hashOf(label: string): string {
  return label.padEnd(64, "0");
}

describe.skipIf(!hasTestDatabase)("Prisma Auth repository", () => {
  const prisma: PrismaClient = hasTestDatabase ? connectTestDatabase() : (null as never);
  const repository = createPrismaAuthRepository(prisma);

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("finds the password hash by username", async () => {
    const alice = await createTestUser(prisma, "alice", { passwordHash: "$argon2id$alice" });
    expect(await repository.findCredentialsByUsername("alice")).toEqual({
      userId: alice.id,
      passwordHash: "$argon2id$alice",
    });
    expect(await repository.findCredentialsByUsername("nobody")).toBeNull();
  });

  it("does not find a user who has no password sign-in method", async () => {
    const alice = await createTestUser(prisma, "alice");
    await prisma.userAuthMethod.deleteMany({ where: { userId: alice.id } });
    expect(await repository.findCredentialsByUsername("alice")).toBeNull();
  });

  it("rotates a refresh token once and stores the replacement", async () => {
    const alice = await createTestUser(prisma, "alice");
    await repository.insertRefreshToken({
      userId: alice.id,
      tokenHash: hashOf("old"),
      expiresAt: LATER,
    });
    const userId = await repository.rotateRefreshToken(
      hashOf("old"),
      { tokenHash: hashOf("new"), expiresAt: MUCH_LATER },
      NOW,
    );
    expect(userId).toBe(alice.id);
    const old = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashOf("old") },
    });
    const replacement = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashOf("new") },
    });
    expect(old.revokedAt).toEqual(NOW);
    expect(replacement.revokedAt).toBeNull();
    expect(replacement.userId).toBe(alice.id);
    expect(
      await repository.rotateRefreshToken(
        hashOf("old"),
        { tokenHash: hashOf("again"), expiresAt: MUCH_LATER },
        NOW,
      ),
    ).toBeNull();
    expect(await prisma.refreshToken.count()).toBe(2);
  });

  it("refuses an unknown or expired refresh token and stores nothing", async () => {
    const alice = await createTestUser(prisma, "alice");
    await repository.insertRefreshToken({
      userId: alice.id,
      tokenHash: hashOf("old"),
      expiresAt: LATER,
    });
    const replacement = { tokenHash: hashOf("x"), expiresAt: MUCH_LATER };
    expect(await repository.rotateRefreshToken(hashOf("missing"), replacement, NOW)).toBeNull();
    expect(await repository.rotateRefreshToken(hashOf("old"), replacement, MUCH_LATER)).toBeNull();
    expect(await prisma.refreshToken.count()).toBe(1);
  });

  it("lets only one of two requests with the same token succeed", async () => {
    const alice = await createTestUser(prisma, "alice");
    await repository.insertRefreshToken({
      userId: alice.id,
      tokenHash: hashOf("old"),
      expiresAt: LATER,
    });
    const results = await Promise.all(
      ["first", "second"].map((label) =>
        repository.rotateRefreshToken(
          hashOf("old"),
          { tokenHash: hashOf(label), expiresAt: MUCH_LATER },
          NOW,
        ),
      ),
    );
    expect(results.filter((userId) => userId !== null)).toEqual([alice.id]);
    expect(await prisma.refreshToken.count()).toBe(2);
  });

  it("cancels one token, or all tokens of a user, but never another user's", async () => {
    const alice = await createTestUser(prisma, "alice");
    const bob = await createTestUser(prisma, "bob_01");
    const store = (userId: string, label: string) =>
      repository.insertRefreshToken({ userId, tokenHash: hashOf(label), expiresAt: LATER });
    await store(alice.id, "a1");
    await store(alice.id, "a2");
    await store(bob.id, "b1");
    const revokedAt = (label: string) =>
      prisma.refreshToken
        .findUniqueOrThrow({ where: { tokenHash: hashOf(label) } })
        .then((token) => token.revokedAt);

    await repository.revokeRefreshToken(bob.id, hashOf("a1"), NOW);
    expect(await revokedAt("a1")).toBeNull();

    await repository.revokeRefreshToken(alice.id, hashOf("a1"), NOW);
    expect(await revokedAt("a1")).toEqual(NOW);

    await repository.revokeAllRefreshTokens(alice.id, NOW);
    expect(await revokedAt("a2")).toEqual(NOW);
    expect(await revokedAt("b1")).toBeNull();
  });
});
