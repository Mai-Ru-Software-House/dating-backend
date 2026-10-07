/*
 * Shared Prisma client for the Data Access Layer. The app creates one client at startup and
 * passes it to every repository, so the whole backend shares one connection pool. Creating
 * the client does not connect; the first query does, so code that never queries (for example
 * the in-memory unit tests) needs no database.
 */
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";

/** Give up on a new connection after 5 seconds. The pg default is to wait forever. */
const CONNECTION_TIMEOUT_MS = 5_000;

/**
 * Create the Prisma client for the PostgreSQL database.
 * @param databaseUrl - PostgreSQL connection string, usually `config.databaseUrl`
 * @returns a client that connects on its first query; call `$disconnect()` on shutdown
 */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  });
  return new PrismaClient({ adapter });
}
