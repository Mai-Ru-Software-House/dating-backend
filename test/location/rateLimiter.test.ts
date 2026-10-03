/*
 * Tests for the rate limiter, using a fake clock so no test waits for real time.
 */
import { describe, expect, it } from "bun:test";

import { createRateLimiter, RateLimitExceededError } from "../../src/services/location/rateLimiter";

function createFakeClock() {
  let current = 1_000_000;
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms;
    },
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("createRateLimiter", () => {
  it("starts tasks at least one interval apart", async () => {
    const clock = createFakeClock();
    const limiter = createRateLimiter({ minIntervalMs: 1000, maxWaitMs: 5000, ...clock });
    const startTimes: number[] = [];

    for (let call = 0; call < 3; call += 1) {
      await limiter.schedule(async () => {
        startTimes.push(clock.now());
      });
    }

    expect(startTimes[1]! - startTimes[0]!).toBe(1000);
    expect(startTimes[2]! - startTimes[1]!).toBe(1000);
  });

  it("does not wait when enough time has passed", async () => {
    const clock = createFakeClock();
    const limiter = createRateLimiter({ minIntervalMs: 1000, maxWaitMs: 5000, ...clock });

    await limiter.schedule(async () => undefined);
    clock.advance(1500);
    const before = clock.now();
    await limiter.schedule(async () => undefined);

    expect(clock.now()).toBe(before);
  });

  it("keeps the order of simultaneous calls", async () => {
    const clock = createFakeClock();
    const limiter = createRateLimiter({ minIntervalMs: 1000, maxWaitMs: 5000, ...clock });
    const order: number[] = [];

    await Promise.all(
      [1, 2, 3].map((id) =>
        limiter.schedule(async () => {
          order.push(id);
        }),
      ),
    );

    expect(order).toEqual([1, 2, 3]);
  });

  it("rejects a call that would wait longer than the maximum, without using a slot", async () => {
    // This sleep does not move the clock, so the calls below pile up like simultaneous requests.
    const clock = createFakeClock();
    const limiter = createRateLimiter({
      minIntervalMs: 1000,
      maxWaitMs: 2000,
      now: clock.now,
      sleep: async () => undefined,
    });
    const task = async () => "ok";

    // These three reserve slots at +0, +1000 and +2000 ms.
    const accepted = [limiter.schedule(task), limiter.schedule(task), limiter.schedule(task)];
    const rejected = limiter.schedule(task);

    await expect(rejected).rejects.toBeInstanceOf(RateLimitExceededError);
    expect(await Promise.all(accepted)).toEqual(["ok", "ok", "ok"]);

    // If the rejected call had used a slot, this call would wait 3000 ms and be rejected too.
    clock.advance(1000);
    await expect(limiter.schedule(task)).resolves.toBe("ok");
  });

  it("passes the task result and its error through", async () => {
    const clock = createFakeClock();
    const limiter = createRateLimiter({ minIntervalMs: 1000, maxWaitMs: 5000, ...clock });

    expect(await limiter.schedule(async () => "done")).toBe("done");
    await expect(
      limiter.schedule(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
