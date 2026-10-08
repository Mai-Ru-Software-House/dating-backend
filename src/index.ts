/*
 * Server entry point: validates the environment, builds the app and starts listening. It stops
 * cleanly on SIGTERM (Docker) and SIGINT (Ctrl+C).
 */
import { createApp } from "./app";
import { ConfigError, loadConfig } from "./config/env";
import { MAX_REQUEST_BODY_BYTES } from "./config/server";
import { createPrismaClient } from "./data/prismaClient";
import { createShutdown } from "./shutdown";

const EXIT_CODE_BAD_CONFIG = 1;

try {
  const config = loadConfig();
  const prisma = createPrismaClient(config.databaseUrl);
  const app = createApp(config, { prisma }).listen({
    port: config.port,
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
  });
  console.log(`Mai Ru API running at http://${app.server?.hostname}:${app.server?.port}`);

  const shutdown = createShutdown({
    stopServer: () => app.stop(),
    closeDatabase: () => prisma.$disconnect(),
    exit: (code) => process.exit(code),
  });
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(EXIT_CODE_BAD_CONFIG);
  }
  throw error;
}
