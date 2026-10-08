/*
 * Helpers that read Prisma errors in the Data Access Layer. With the pg driver adapter, a
 * unique violation is Prisma error P2002, and the name of the broken index is in
 * `meta.driverAdapterError.cause.constraint.index` (for example `users_username_key`).
 */
import { Prisma } from "../generated/prisma/client";

/** Prisma's code for "a unique rule failed". */
const UNIQUE_VIOLATION_CODE = "P2002";

/** The unique indexes the repositories turn into answers instead of errors. */
export const UNIQUE_INDEXES = {
  username: "users_username_key",
  photoKey: "users_photo_key_key",
} as const;

function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Find out which unique index an error broke.
 * @param error - anything a Prisma call threw
 * @returns the index name, or null when the error is not a unique violation (or does not say)
 */
export function brokenUniqueIndex(error: unknown): string | null {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== UNIQUE_VIOLATION_CODE
  ) {
    return null;
  }
  const index = readPath(error.meta, ["driverAdapterError", "cause", "constraint", "index"]);
  return typeof index === "string" ? index : null;
}
