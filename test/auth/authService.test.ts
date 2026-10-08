/*
 * Tests for the Auth Service on an in-memory repository: login, refresh rotation, logout and
 * the session check (functional tests LG05, LG09, LG10, LG11).
 */
import { describe, expect, it } from "bun:test";

import { expectApiError } from "../messaging/fixtures";
import { ACCESS_TTL_SECONDS, REFRESH_TTL_DAYS, createTestAuth } from "./fixtures";

const MS_PER_SECOND = 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const HTTP_UNAUTHORIZED = 401;

describe("login", () => {
  it("returns an access token and a refresh token for the right password", async () => {
    const { service } = await createTestAuth();
    const pair = await service.login("alice", "Alice2026");
    expect(pair.accessToken.split(".")).toHaveLength(3);
    expect(pair.refreshToken.length).toBeGreaterThan(0);
    expect(await service.validateSession(pair.accessToken)).toEqual({ userId: "usr_alice" });
  });

  it("gives the same error for a wrong password and an unknown user", async () => {
    const { service } = await createTestAuth();
    const errors: unknown[] = [];
    for (const attempt of [
      () => service.login("alice", "WrongPass1"),
      () => service.login("nobody", "Alice2026"),
    ]) {
      try {
        await attempt();
      } catch (error) {
        errors.push(error);
      }
    }
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({
      status: HTTP_UNAUTHORIZED,
      code: "INVALID_CREDENTIALS",
      message: (errors[1] as Error).message,
    });
    expect(errors[1]).toMatchObject({ status: HTTP_UNAUTHORIZED, code: "INVALID_CREDENTIALS" });
  });

  it("accepts the username in any letter case, as usernames are stored in lowercase", async () => {
    const { service } = await createTestAuth();
    const pair = await service.login("Alice", "Alice2026");
    expect(await service.validateSession(pair.accessToken)).toEqual({ userId: "usr_alice" });
  });

  it("lets two users hold sessions at the same time (switch user)", async () => {
    const { service } = await createTestAuth();
    const alice = await service.login("alice", "Alice2026");
    const bob = await service.login("bob", "Bob2026x");
    expect(await service.validateSession(alice.accessToken)).toEqual({ userId: "usr_alice" });
    expect(await service.validateSession(bob.accessToken)).toEqual({ userId: "usr_bob" });
  });
});

describe("session check", () => {
  it("rejects a fake token", async () => {
    const { service } = await createTestAuth();
    expect(await service.validateSession("fake-token")).toBeNull();
  });

  it("rejects an access token after its life, and refresh then works (LG09)", async () => {
    const { service, clock } = await createTestAuth();
    const pair = await service.login("alice", "Alice2026");
    clock.advance((ACCESS_TTL_SECONDS + 1) * MS_PER_SECOND);
    expect(await service.validateSession(pair.accessToken)).toBeNull();
    const renewed = await service.refresh(pair.refreshToken);
    expect(await service.validateSession(renewed.accessToken)).toEqual({ userId: "usr_alice" });
  });
});

describe("refresh", () => {
  it("gives a new pair and cancels the old refresh token", async () => {
    const { service } = await createTestAuth();
    const first = await service.login("alice", "Alice2026");
    const second = await service.refresh(first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    await expectApiError(service.refresh(first.refreshToken), HTTP_UNAUTHORIZED, "UNAUTHENTICATED");
    const third = await service.refresh(second.refreshToken);
    expect(await service.validateSession(third.accessToken)).toEqual({ userId: "usr_alice" });
  });

  it("rejects an unknown refresh token", async () => {
    const { service } = await createTestAuth();
    await expectApiError(service.refresh("r_unknown"), HTTP_UNAUTHORIZED, "UNAUTHENTICATED");
  });

  it("rejects a refresh token after its life", async () => {
    const { service, clock } = await createTestAuth();
    const pair = await service.login("alice", "Alice2026");
    clock.advance(REFRESH_TTL_DAYS * MS_PER_DAY + MS_PER_SECOND);
    await expectApiError(service.refresh(pair.refreshToken), HTTP_UNAUTHORIZED, "UNAUTHENTICATED");
  });

  it("lets only one of two requests with the same token succeed", async () => {
    const { service } = await createTestAuth();
    const pair = await service.login("alice", "Alice2026");
    const results = await Promise.allSettled([
      service.refresh(pair.refreshToken),
      service.refresh(pair.refreshToken),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });
});

describe("logout", () => {
  it("cancels the given refresh token (LG10)", async () => {
    const { service } = await createTestAuth();
    const pair = await service.login("alice", "Alice2026");
    await service.logout("usr_alice", pair.refreshToken);
    await expectApiError(service.refresh(pair.refreshToken), HTTP_UNAUTHORIZED, "UNAUTHENTICATED");
  });

  it("leaves other sessions of the same user alone when a token is given", async () => {
    const { service } = await createTestAuth();
    const phone = await service.login("alice", "Alice2026");
    const tablet = await service.login("alice", "Alice2026");
    await service.logout("usr_alice", phone.refreshToken);
    expect((await service.refresh(tablet.refreshToken)).refreshToken.length).toBeGreaterThan(0);
  });

  it("cancels every refresh token of the user when none is given", async () => {
    const { service, repository } = await createTestAuth();
    const phone = await service.login("alice", "Alice2026");
    const tablet = await service.login("alice", "Alice2026");
    await service.logout("usr_alice");
    expect(repository.countActiveRefreshTokens()).toBe(0);
    await expectApiError(service.refresh(phone.refreshToken), HTTP_UNAUTHORIZED, "UNAUTHENTICATED");
    await expectApiError(
      service.refresh(tablet.refreshToken),
      HTTP_UNAUTHORIZED,
      "UNAUTHENTICATED",
    );
  });

  it("does not cancel the token of another user", async () => {
    const { service } = await createTestAuth();
    const bob = await service.login("bob", "Bob2026x");
    await service.logout("usr_alice", bob.refreshToken);
    expect((await service.refresh(bob.refreshToken)).refreshToken.length).toBeGreaterThan(0);
  });
});

describe("issueTokens", () => {
  it("gives a working pair to a user who just signed up", async () => {
    const { service } = await createTestAuth();
    const pair = await service.issueTokens("usr_new");
    expect(await service.validateSession(pair.accessToken)).toEqual({ userId: "usr_new" });
    expect((await service.refresh(pair.refreshToken)).accessToken.length).toBeGreaterThan(0);
  });
});
