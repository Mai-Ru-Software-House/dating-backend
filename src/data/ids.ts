/*
 * Helpers for IDs in the Data Access Layer. The database columns are UUIDs, and PostgreSQL
 * rejects text that is not a UUID, so every repository first checks an ID that came from outside
 * (the app sends IDs like `99999` in the functional test plan). Such an ID is "not found".
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Check that a text can be used as a UUID column value.
 * @param value - the ID to check
 * @returns true when it has the shape of a UUID
 */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Keep only the IDs that are UUIDs.
 * @param values - IDs from outside
 * @returns the IDs that have the shape of a UUID, in the same order
 */
export function onlyUuids(values: string[]): string[] {
  return values.filter(isUuid);
}
