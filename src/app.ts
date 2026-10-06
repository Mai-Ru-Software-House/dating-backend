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
import { stubSessionValidator, type SessionValidator } from "./services/auth/sessionValidator";
import { locationRoutes } from "./services/location/locationRoutes";
import { createLocationService, type LocationService } from "./services/location/locationService";
import {
  createInMemoryFavoritesReader,
  createInMemoryMessageRepository,
  createInMemoryUserReader,
} from "./services/messaging/inMemoryMessageRepository";
import { messagingRoutes } from "./services/messaging/messagingRoutes";
import {
  createMessagingService,
  type MessagingService,
} from "./services/messaging/messagingService";

/** Parts of the app that tests can replace, for example to avoid real network calls. */
export interface AppDependencies {
  locationService?: LocationService;
  sessionValidator?: SessionValidator;
  messagingService?: MessagingService;
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
  // Until the Auth Service exists, the stub accepts no token, so protected routes answer 401.
  const sessionValidator = dependencies.sessionValidator ?? stubSessionValidator;
  // In-memory data until the Data Access Layer (Chuan) provides the real repositories.
  const messagingService =
    dependencies.messagingService ??
    createMessagingService({
      messages: createInMemoryMessageRepository(),
      favorites: createInMemoryFavoritesReader(),
      users: createInMemoryUserReader(),
    });

  return new Elysia()
    .use(errorHandler)
    .use(corsPlugin(config))
    .use(openapiPlugin())
    .use(healthRoutes)
    .use(locationRoutes(locationService))
    .use(messagingRoutes(messagingService, sessionValidator));
}
