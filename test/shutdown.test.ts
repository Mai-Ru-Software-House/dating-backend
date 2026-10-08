/*
 * Tests for the graceful shutdown: the server stops first, then the database is closed, then
 * the process exits; a failure still closes the database and exits with 1; a second signal
 * does nothing.
 */
import { describe, expect, it } from "bun:test";

import { createShutdown } from "../src/shutdown";

function setup(options: { failServer?: boolean; failDatabase?: boolean } = {}) {
  const events: string[] = [];
  const shutdown = createShutdown({
    stopServer: async () => {
      events.push("server stopped");
      if (options.failServer) {
        throw new Error("stop failed");
      }
    },
    closeDatabase: async () => {
      events.push("database closed");
      if (options.failDatabase) {
        throw new Error("close failed");
      }
    },
    exit: (code) => events.push(`exit ${code}`),
    log: (message) => events.push(`log: ${message}`),
  });
  return { shutdown, events };
}

describe("createShutdown", () => {
  it("stops the server, closes the database and exits with 0, in that order", async () => {
    const { shutdown, events } = setup();
    await shutdown("SIGTERM");
    expect(events).toEqual([
      "log: SIGTERM received, shutting down",
      "server stopped",
      "database closed",
      "exit 0",
    ]);
  });

  it("still closes the database when the server fails to stop, and exits with 1", async () => {
    const { shutdown, events } = setup({ failServer: true });
    const originalError = console.error;
    console.error = () => {};
    try {
      await shutdown("SIGINT");
    } finally {
      console.error = originalError;
    }
    expect(events).toContain("database closed");
    expect(events.at(-1)).toBe("exit 1");
  });

  it("exits with 1 when the database fails to close", async () => {
    const { shutdown, events } = setup({ failDatabase: true });
    const originalError = console.error;
    console.error = () => {};
    try {
      await shutdown("SIGTERM");
    } finally {
      console.error = originalError;
    }
    expect(events.at(-1)).toBe("exit 1");
  });

  it("does nothing on a second signal", async () => {
    const { shutdown, events } = setup();
    await shutdown("SIGTERM");
    const before = events.length;
    await shutdown("SIGINT");
    expect(events).toHaveLength(before);
  });
});
