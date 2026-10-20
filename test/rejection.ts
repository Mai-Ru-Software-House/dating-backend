/*
 * Test helper for promises that must fail. It gives the rejection reason back, so a test can
 * check it with a normal `expect`.
 */

/**
 * Wait for a promise that is expected to reject.
 * @param promise - the promise that must reject
 * @returns the value the promise rejected with
 * @throws Error when the promise resolves instead
 */
export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("The promise was expected to reject, but it resolved.");
}
