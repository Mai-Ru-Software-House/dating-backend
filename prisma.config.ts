/*
 * Prisma CLI configuration: where the schema, the migrations and the seed script live, and
 * which database the CLI (migrate, db pull, db seed) connects to. Bun loads .env by itself,
 * so run the CLI with Bun (the db:* scripts in package.json do).
 */
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "bun prisma/seed.ts",
  },
  datasource: {
    // Not env("DATABASE_URL"): that throws when the variable is missing, and `prisma generate`
    // must also work where there is no database, for example while building an image.
    url: process.env.DATABASE_URL ?? "",
  },
});
