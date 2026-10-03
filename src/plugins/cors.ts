/*
 * CORS plugin: lets the mobile app and approved web tools call the API from their origins.
 */
import { cors } from "@elysia/cors";

import type { Config } from "../config/env";

const ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

/**
 * Build the CORS plugin from the config.
 * @param config - validated config, `corsOrigins` lists the allowed origins
 * @returns an Elysia plugin to register with `.use()`
 */
export function corsPlugin(config: Config) {
  return cors({
    origin: config.corsOrigins,
    methods: ALLOWED_METHODS,
    credentials: true,
  });
}
