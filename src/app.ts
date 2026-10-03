/*
 * App factory: builds the Elysia app with the shared parts (error format, CORS, OpenAPI)
 * and registers the routes. It does not listen, so tests can call `app.handle` directly.
 */
import { Elysia } from "elysia";

import type { Config } from "./config/env";
import { corsPlugin } from "./plugins/cors";
import { errorHandler } from "./plugins/errors";
import { openapiPlugin } from "./plugins/openapi";
import { healthRoutes } from "./routes/health";
import { locationRoutes } from "./services/location/locationRoutes";
import { createLocationService, type LocationService } from "./services/location/locationService";

/** Parts of the app that tests can replace, for example to avoid real network calls. */
export interface AppDependencies {
  locationService?: LocationService;
}

/**
 * Create the backend app.
 * @param config - validated config from loadConfig
 * @param dependencies - optional replacements for services, used by tests
 * @returns the Elysia app, ready for `.listen()` or `.handle()`
 */
export function createApp(config: Config, dependencies: AppDependencies = {}) {
  const locationService =
    dependencies.locationService ?? createLocationService({ baseUrl: config.nominatimUrl });

  return new Elysia()
    .use(errorHandler)
    .use(corsPlugin(config))
    .use(openapiPlugin())
    .use(healthRoutes)
    .use(locationRoutes(locationService));
}
