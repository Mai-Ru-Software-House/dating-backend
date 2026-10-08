/*
 * Environment configuration: reads the environment variables, checks them against a
 * schema and returns a typed config object. Called once at startup so a missing or
 * malformed variable stops the server with a clear message.
 */
import { t, type Static } from "elysia";
import { Value } from "@sinclair/typebox/value";

const DEFAULT_PORT = "3000";
const DEFAULT_NODE_ENV = "development";
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = "900";
const DEFAULT_REFRESH_TOKEN_TTL_DAYS = "30";
const DEFAULT_ARGON2_MEMORY_COST = "65536";
const DEFAULT_ARGON2_TIME_COST = "3";
const DEFAULT_MATCH_ENGINE_TIMEOUT_MS = "5000";
const POSITIVE_INTEGER_PATTERN = "^[1-9][0-9]*$";
const EMAIL_PATTERN = String.raw`^[^@\s]+@[^@\s]+$`;
const MAX_PORT = 65535;
const URL_VARIABLES = [
  "DATABASE_URL",
  "RUSTFS_ENDPOINT",
  "MATCH_ENGINE_URL",
  "NOMINATIM_URL",
] as const;

const envSchema = t.Object({
  NODE_ENV: t.Union([t.Literal("development"), t.Literal("test"), t.Literal("production")]),
  PORT: t.String({ pattern: "^[0-9]+$" }),
  CORS_ORIGINS: t.String({ minLength: 1 }),
  JWT_SECRET: t.String({ minLength: 1 }),
  ACCESS_TOKEN_TTL_SECONDS: t.String({ pattern: POSITIVE_INTEGER_PATTERN }),
  REFRESH_TOKEN_TTL_DAYS: t.String({ pattern: POSITIVE_INTEGER_PATTERN }),
  ARGON2_MEMORY_COST: t.String({ pattern: POSITIVE_INTEGER_PATTERN }),
  ARGON2_TIME_COST: t.String({ pattern: POSITIVE_INTEGER_PATTERN }),
  MATCH_ENGINE_TIMEOUT_MS: t.String({ pattern: POSITIVE_INTEGER_PATTERN }),
  DATABASE_URL: t.String({ minLength: 1 }),
  RUSTFS_ENDPOINT: t.String({ minLength: 1 }),
  RUSTFS_ACCESS_KEY: t.String({ minLength: 1 }),
  RUSTFS_SECRET_KEY: t.String({ minLength: 1 }),
  RUSTFS_BUCKET: t.String({ minLength: 1 }),
  MATCH_ENGINE_URL: t.String({ minLength: 1 }),
  NOMINATIM_URL: t.String({ minLength: 1 }),
  NOMINATIM_EMAIL: t.Optional(t.String({ pattern: EMAIL_PATTERN })),
});

type RawEnv = Static<typeof envSchema>;

/** Validated settings used by the rest of the backend. */
export interface Config {
  nodeEnv: RawEnv["NODE_ENV"];
  port: number;
  corsOrigins: string[];
  jwtSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  argon2MemoryCost: number;
  argon2TimeCost: number;
  matchEngineTimeoutMs: number;
  databaseUrl: string;
  rustfsEndpoint: string;
  rustfsAccessKey: string;
  rustfsSecretKey: string;
  rustfsBucket: string;
  matchEngineUrl: string;
  nominatimUrl: string;
  /** Contact email sent to Nominatim, or undefined when NOMINATIM_EMAIL is not set. */
  nominatimEmail: string | undefined;
}

/** Thrown when the environment is missing variables or has invalid values. */
export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment configuration:\n- ${problems.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read and validate the environment variables.
 * @param source - variables to read, defaults to the process environment
 * @returns the validated, typed config
 * @throws ConfigError listing every missing or invalid variable
 */
export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  const candidate = {
    ...source,
    NODE_ENV: source.NODE_ENV ?? DEFAULT_NODE_ENV,
    PORT: source.PORT ?? DEFAULT_PORT,
    ACCESS_TOKEN_TTL_SECONDS: source.ACCESS_TOKEN_TTL_SECONDS ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
    REFRESH_TOKEN_TTL_DAYS: source.REFRESH_TOKEN_TTL_DAYS ?? DEFAULT_REFRESH_TOKEN_TTL_DAYS,
    ARGON2_MEMORY_COST: source.ARGON2_MEMORY_COST ?? DEFAULT_ARGON2_MEMORY_COST,
    ARGON2_TIME_COST: source.ARGON2_TIME_COST ?? DEFAULT_ARGON2_TIME_COST,
    MATCH_ENGINE_TIMEOUT_MS: source.MATCH_ENGINE_TIMEOUT_MS ?? DEFAULT_MATCH_ENGINE_TIMEOUT_MS,
    // An empty value (NOMINATIM_EMAIL=) means "not set".
    NOMINATIM_EMAIL: source.NOMINATIM_EMAIL?.trim() || undefined,
  };

  const problems = [...Value.Errors(envSchema, candidate)].map((error) => {
    const name = error.path.replace("/", "");
    return `${name}: ${error.value === undefined ? "is required" : "has an invalid value"}`;
  });

  if (problems.length === 0) {
    const raw = candidate as RawEnv;
    if (Number(raw.PORT) > MAX_PORT) {
      problems.push(`PORT: must be at most ${MAX_PORT}`);
    }
    for (const name of URL_VARIABLES) {
      if (!isValidUrl(raw[name])) {
        problems.push(`${name}: must be a valid URL`);
      }
    }
  }

  if (problems.length > 0) {
    throw new ConfigError([...new Set(problems)]);
  }

  const raw = candidate as RawEnv;
  return {
    nodeEnv: raw.NODE_ENV,
    port: Number(raw.PORT),
    corsOrigins: raw.CORS_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    jwtSecret: raw.JWT_SECRET,
    accessTokenTtlSeconds: Number(raw.ACCESS_TOKEN_TTL_SECONDS),
    refreshTokenTtlDays: Number(raw.REFRESH_TOKEN_TTL_DAYS),
    argon2MemoryCost: Number(raw.ARGON2_MEMORY_COST),
    argon2TimeCost: Number(raw.ARGON2_TIME_COST),
    matchEngineTimeoutMs: Number(raw.MATCH_ENGINE_TIMEOUT_MS),
    databaseUrl: raw.DATABASE_URL,
    rustfsEndpoint: raw.RUSTFS_ENDPOINT,
    rustfsAccessKey: raw.RUSTFS_ACCESS_KEY,
    rustfsSecretKey: raw.RUSTFS_SECRET_KEY,
    rustfsBucket: raw.RUSTFS_BUCKET,
    matchEngineUrl: raw.MATCH_ENGINE_URL,
    nominatimUrl: raw.NOMINATIM_URL,
    nominatimEmail: raw.NOMINATIM_EMAIL,
  };
}
