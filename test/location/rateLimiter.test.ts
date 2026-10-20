/*
 * Tests for the rate limiter, using a fake clock so no test waits for real time.
 */
import { describe, expect, it } from "bun:test";

import { createRateLimiter, RateLimitExceededError } from "../../src/services/location/rateLimiter";

function createFakeClock() {
  let current = 1_000_000;
  return {
    now: () => current,
    sleep: (ms: number) => {
      current += ms;
      return Promise.resolve();
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
      await limiter.schedule(() => {
        startTimes.push(clock.now());
        return Promise.resolve();
      });
    }

    const [first = 0, second = 0, third = 0] = startTimes;
    expect(second - first).toBe(1000);
    expect(third - second).toBe(1000);
  });

  it("does not wait when enough time has passed", async () => {
    const clock = createFakeClock();
    const limiter = createRateLimiter({ minIntervalMs: 1000, maxWaitMs: 5000, ...clock });

    await limiter.schedule(() => Promise.resolve(undefined));
    clock.advance(1500);
    const before = clock.now();
    await limiter.schedule(() => Promise.resolve(undefined));

    expect(clock.now()).toBe(before);
  });

  it("keeps the order of simultaneous calls", async () => {
    const clock = createFakeClock();
    const limiter = createRateLimiter({ minIntervalMs: 1000, maxWaitMs: 5000, ...clock });
    const order: number[] = [];

    await Promise.all(
      [1, 2, 3].map((id) =>
        limiter.schedule(() => {
          order.push(id);
          return Promise.resolve();
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
      sleep: () => Promise.resolve(undefined),
    });
    const task = () => Promise.resolve("ok");

    // These three reserve slots at +0, +1000 and +2000 ms.
    const accepted = [limiter.schedule(task), limiter.schedule(task), limiter.schedule(task)];
    const rejected = limiter.schedule(task);

    expect(await rejected.catch((error: unknown) => error)).toBeInstanceOf(RateLimitExceededError);
    expect(await Promise.all(accepted)).toEqual(["ok", "ok", "ok"]);

    // If the rejected call had used a slot, this call would wait 3000 ms and be rejected too.
    clock.advance(1000);
    expect(await limiter.schedule(task)).toBe("ok");
  });

  it("passes the task result and its error through", async () => {
    const clock = createFakeClock();
    const limiter = createRateLimiter({ minIntervalMs: 1000, maxWaitMs: 5000, ...clock });

    expect(await limiter.schedule(() => Promise.resolve("done"))).toBe("done");
    const error = await limiter
      .schedule(() => Promise.reject(new Error("boom")))
      .catch((reason: unknown) => reason);
    expect(error).toEqual(new Error("boom"));
  });
});
