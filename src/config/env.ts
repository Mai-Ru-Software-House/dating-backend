/*
 * Environment configuration: reads the environment variables, checks them against a
 * schema and returns a typed config object. Called once at startup so a missing or
 * malformed variable stops the server with a clear message.
 */
import { t, type Static } from "elysia";
import { Value } from "@sinclair/typebox/value";

const DEFAULT_PORT = "3000";
const DEFAULT_NODE_ENV = "development";
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
  SESSION_SECRET: t.String({ minLength: 1 }),
  DATABASE_URL: t.String({ minLength: 1 }),
  RUSTFS_ENDPOINT: t.String({ minLength: 1 }),
  RUSTFS_ACCESS_KEY: t.String({ minLength: 1 }),
  RUSTFS_SECRET_KEY: t.String({ minLength: 1 }),
  RUSTFS_BUCKET: t.String({ minLength: 1 }),
  MATCH_ENGINE_URL: t.String({ minLength: 1 }),
  NOMINATIM_URL: t.String({ minLength: 1 }),
});

type RawEnv = Static<typeof envSchema>;

/** Validated settings used by the rest of the backend. */
export interface Config {
  nodeEnv: RawEnv["NODE_ENV"];
  port: number;
  corsOrigins: string[];
  sessionSecret: string;
  databaseUrl: string;
  rustfsEndpoint: string;
  rustfsAccessKey: string;
  rustfsSecretKey: string;
  rustfsBucket: string;
  matchEngineUrl: string;
  nominatimUrl: string;
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
    sessionSecret: raw.SESSION_SECRET,
    databaseUrl: raw.DATABASE_URL,
    rustfsEndpoint: raw.RUSTFS_ENDPOINT,
    rustfsAccessKey: raw.RUSTFS_ACCESS_KEY,
    rustfsSecretKey: raw.RUSTFS_SECRET_KEY,
    rustfsBucket: raw.RUSTFS_BUCKET,
    matchEngineUrl: raw.MATCH_ENGINE_URL,
    nominatimUrl: raw.NOMINATIM_URL,
  };
}
