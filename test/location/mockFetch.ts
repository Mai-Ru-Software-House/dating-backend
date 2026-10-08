/*
 * Test helper: a fake fetch that records every call and answers from a handler, so the
 * Location Service tests never touch the network.
 */

/** One recorded call to the fake fetch. */
export interface RecordedCall {
  url: URL;
  headers: Headers;
  method: string;
  /** The request body parsed as JSON, or undefined when there is none. */
  body: unknown;
}

type Handler = (call: RecordedCall) => Response | Promise<Response>;

/**
 * Create a fake fetch.
 * @param handler - builds the response for each call
 * @returns the fake `fetch` and the list of calls it received
 */
export function createMockFetch(handler: Handler) {
  const calls: RecordedCall[] = [];
  const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const call = {
      url: new URL(String(input)),
      headers: new Headers(init?.headers),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
    };
    calls.push(call);
    const answer = Promise.resolve(handler(call));
    const signal = init?.signal;
    if (signal === undefined || signal === null) {
      return answer;
    }
    // Like the real fetch, give up when the request is aborted (for example by a timeout).
    return Promise.race([
      answer,
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    ]);
  };
  return { fetch: mockFetch as unknown as typeof fetch, calls };
}

/**
 * Build a JSON response like the Nominatim reverse endpoint sends.
 * @param body - the value to send as JSON
 * @param status - HTTP status, default 200
 * @returns the response
 */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
