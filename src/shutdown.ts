/*
 * Graceful shutdown: when Docker (or Watchtower, or Ctrl+C) asks the server to stop, finish the
 * requests in progress, close the database connections and exit. The work is done in a
 * function that gets everything it touches as arguments, so a test can check it without
 * stopping the test process.
 */

const EXIT_CODE_OK = 0;
const EXIT_CODE_ERROR = 1;

/** What the shutdown has to stop, and how to report and exit. */
export interface ShutdownOptions {
  /** Stops accepting new requests and waits for the ones in progress. */
  stopServer: () => Promise<unknown>;
  /** Closes the database connections. */
  closeDatabase: () => Promise<unknown>;
  /** Ends the process. */
  exit: (code: number) => void;
  log?: (message: string) => void;
}

/**
 * Build the function that stops the server.
 * @param options - the parts to stop and how to exit
 * @returns a function to call with the signal name. The first call stops the server, closes the
 *   database and exits with 0, or with 1 when one of them fails (the database is still closed
 *   when the server fails to stop). Later calls do nothing, so a second Ctrl+C is harmless.
 */
export function createShutdown(options: ShutdownOptions): (signal: string) => Promise<void> {
  const log = options.log ?? ((message: string) => console.log(message));
  let isStopping = false;

  return async (signal) => {
    if (isStopping) {
      return;
    }
    isStopping = true;
    log(`${signal} received, shutting down`);

    let exitCode = EXIT_CODE_OK;
    for (const step of [options.stopServer, options.closeDatabase]) {
      try {
        await step();
      } catch (error) {
        console.error("Shutdown step failed:", error);
        exitCode = EXIT_CODE_ERROR;
      }
    }
    options.exit(exitCode);
  };
}
