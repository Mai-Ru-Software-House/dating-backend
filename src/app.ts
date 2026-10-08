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
import { createPrismaAuthRepository } from "./data/prismaAuthRepository";
import { createPrismaClient } from "./data/prismaClient";
import type { PrismaClient } from "./generated/prisma/client";
import { authRoutes } from "./services/auth/authRoutes";
import { createAuthService, type AuthService } from "./services/auth/authService";
import { createPasswordHasher } from "./services/auth/passwordHasher";
import type { SessionValidator } from "./services/auth/sessionValidator";
import { createTokenService } from "./services/auth/tokens";
import { locationRoutes } from "./services/location/locationRoutes";
import { createLocationService, type LocationService } from "./services/location/locationService";
import { favoritesNotesRoutes } from "./services/favoritesNotes/favoritesNotesRoutes";
import {
  createFavoritesNotesService,
  type FavoritesNotesService,
} from "./services/favoritesNotes/favoritesNotesService";
import {
  createInMemoryFavoritesRepository,
  createInMemoryNotesRepository,
} from "./services/favoritesNotes/inMemoryFavoritesNotesRepository";
import {
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
  /** Shared database client. Created from DATABASE_URL on first use when not given. */
  prisma?: PrismaClient;
  authService?: AuthService;
  locationService?: LocationService;
  sessionValidator?: SessionValidator;
  messagingService?: MessagingService;
  favoritesNotesService?: FavoritesNotesService;
}

/**
 * Create the backend app.
 * @param config - validated config from loadConfig
 * @param dependencies - optional replacements for services, used by tests
 * @returns the Elysia app, ready for `.listen()` or `.handle()`
 */
export function createApp(config: Config, dependencies: AppDependencies = {}) {
  const locationService =
    dependencies.locationService ??
    createLocationService({ baseUrl: config.nominatimUrl, email: config.nominatimEmail });
  let prismaClient = dependencies.prisma;
  const getPrisma = () => (prismaClient ??= createPrismaClient(config.databaseUrl));
  const authService =
    dependencies.authService ??
    createAuthService({
      repository: createPrismaAuthRepository(getPrisma()),
      hasher: createPasswordHasher({
        memoryCost: config.argon2MemoryCost,
        timeCost: config.argon2TimeCost,
      }),
      tokens: createTokenService({
        secret: config.jwtSecret,
        accessTtlSeconds: config.accessTokenTtlSeconds,
      }),
      refreshTtlDays: config.refreshTokenTtlDays,
    });
  const sessionValidator = dependencies.sessionValidator ?? authService.validateSession;
  // In-memory data until the Data Access Layer (Chuan) provides the real repositories. The
  // favorites repository and the user reader are shared, so the chat list shows the favorites
  // that the Favorites & Notes Service saved.
  const users = createInMemoryUserReader();
  const favorites = createInMemoryFavoritesRepository();
  const messagingService =
    dependencies.messagingService ??
    createMessagingService({ messages: createInMemoryMessageRepository(), favorites, users });
  const favoritesNotesService =
    dependencies.favoritesNotesService ??
    createFavoritesNotesService({ favorites, notes: createInMemoryNotesRepository(), users });

  return new Elysia()
    .use(errorHandler)
    .use(corsPlugin(config))
    .use(openapiPlugin())
    .use(healthRoutes)
    .use(authRoutes(authService))
    .use(locationRoutes(locationService))
    .use(messagingRoutes(messagingService, sessionValidator))
    .use(favoritesNotesRoutes(favoritesNotesService, sessionValidator));
}
