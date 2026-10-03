/*
 * Rate limiter for calls to Nominatim, which allows at most 1 request per second. Every call
 * reserves the next free start slot and waits for it. If the wait would be too long the call
 * is rejected at once, so a flood of requests cannot build an endless queue.
 */

/** Thrown when a call would have to wait longer than the allowed maximum. */
export class RateLimitExceededError extends Error {
  constructor(waitMs: number) {
    super(`The wait of ${waitMs} ms is longer than the allowed maximum.`);
    this.name = "RateLimitExceededError";
  }
}

/** Settings for createRateLimiter. `now` and `sleep` can be replaced in tests. */
export interface RateLimiterOptions {
  /** Smallest time between two starts, in milliseconds. */
  minIntervalMs: number;
  /** Longest time a call may wait for its slot, in milliseconds. */
  maxWaitMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Runs a task when its slot comes up. */
export interface RateLimiter {
  schedule<T>(task: () => Promise<T>): Promise<T>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Create a rate limiter that starts at most one task per interval, in the order of the calls.
 * @param options - interval, longest allowed wait, and optional clock and sleep functions
 * @returns an object with `schedule(task)`
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  let nextFreeAt = 0;

  return {
    /**
     * Wait for the next free slot, then run the task.
     * @param task - the work to run, for example one request to Nominatim
     * @returns whatever the task returns
     * @throws RateLimitExceededError when the wait would be longer than `maxWaitMs`
     * @throws whatever the task throws
     */
    async schedule<T>(task: () => Promise<T>): Promise<T> {
      const startAt = Math.max(now(), nextFreeAt);
      const waitMs = startAt - now();
      if (waitMs > options.maxWaitMs) {
        throw new RateLimitExceededError(waitMs);
      }
      // The slot is reserved before waiting, so calls made meanwhile queue behind this one.
      nextFreeAt = startAt + options.minIntervalMs;
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      return task();
    },
  };
}
