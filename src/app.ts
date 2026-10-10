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
import {
  createPrismaFavoritesRepository,
  createPrismaNotesRepository,
} from "./data/prismaFavoritesNotesRepository";
import { createPrismaMatchProfileReader } from "./data/prismaMatchProfileReader";
import {
  createPrismaMessageRepository,
  createPrismaUserReader,
} from "./data/prismaMessageRepository";
import { createPrismaProfilePhotoRepository } from "./data/prismaProfilePhotoRepository";
import { createPrismaProfileRepository } from "./data/prismaProfileRepository";
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
import { createMatchEngineClient } from "./services/match/engineClient";
import { matchRoutes } from "./services/match/matchRoutes";
import { createMatchService, type MatchService } from "./services/match/matchService";
import { messagingRoutes } from "./services/messaging/messagingRoutes";
import {
  createMessagingService,
  type MessagingService,
} from "./services/messaging/messagingService";
import { createEngineMatchScorer } from "./services/profile/matchScorer";
import type { PhotoUploadClaimer } from "./services/profile/photoUploadClaimer";
import { profileRoutes } from "./services/profile/profileRoutes";
import { createProfileService, type ProfileService } from "./services/profile/profileService";
import { photoRoutes } from "./services/photo/photoRoutes";
import { createPhotoService, type PhotoService } from "./services/photo/photoService";
import { createRustFSPhotoStore } from "./services/photo/photoStore";
import { createRustFSPhotoUploads, type RustFSPhotoUploads } from "./services/photo/photoUploads";

/** Parts of the app that tests can replace, for example to avoid real network calls. */
export interface AppDependencies {
  /** Shared database client. Created from DATABASE_URL on first use when not given. */
  prisma?: PrismaClient;
  authService?: AuthService;
  locationService?: LocationService;
  sessionValidator?: SessionValidator;
  messagingService?: MessagingService;
  favoritesNotesService?: FavoritesNotesService;
  matchService?: MatchService;
  profileService?: ProfileService;
  /** Sign up's photo upload claim (Tae). */
  photoUploads?: PhotoUploadClaimer;
  /** The Photo Service (Tae). Override in tests to avoid real RustFS calls. */
  photoService?: PhotoService;
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
  // Login and sign up hash passwords with the same Argon2id settings.
  const hasher = createPasswordHasher({
    memoryCost: config.argon2MemoryCost,
    timeCost: config.argon2TimeCost,
  });
  const authService =
    dependencies.authService ??
    createAuthService({
      repository: createPrismaAuthRepository(getPrisma()),
      hasher,
      tokens: createTokenService({
        secret: config.jwtSecret,
        accessTtlSeconds: config.accessTokenTtlSeconds,
      }),
      refreshTtlDays: config.refreshTokenTtlDays,
    });
  const sessionValidator = dependencies.sessionValidator ?? authService.validateSession;
  // PostgreSQL repositories (written by Vic as a proposal for Chuan, see docs/data-access.md). The
  // favorites repository and the user reader are shared, so the chat list shows the favorites
  // that the Favorites & Notes Service saved.
  const users = createPrismaUserReader(getPrisma());
  const favorites = createPrismaFavoritesRepository(getPrisma());
  const messagingService =
    dependencies.messagingService ??
    createMessagingService({
      messages: createPrismaMessageRepository(getPrisma()),
      favorites,
      users,
    });
  const favoritesNotesService =
    dependencies.favoritesNotesService ??
    createFavoritesNotesService({
      favorites,
      notes: createPrismaNotesRepository(getPrisma()),
      users,
    });

  // One engine client for Find Matches and the match score on a candidate profile.
  const engine = createMatchEngineClient({
    baseUrl: config.matchEngineUrl,
    timeoutMs: config.matchEngineTimeoutMs,
  });
  const matchService =
    dependencies.matchService ??
    createMatchService({ profiles: createPrismaMatchProfileReader(getPrisma()), engine });

  // Photo functions (Tae). The store talks to RustFS; the upload store keeps the temporary
  // sign up uploads on top of it, so the claimer the Profile Service uses is the RustFS
  // version from now on (sign up can finish on a running server).
  const photoStore = createRustFSPhotoStore(config);
  const photoUploadsStore: RustFSPhotoUploads = createRustFSPhotoUploads({
    store: photoStore,
    secret: config.jwtSecret,
  });
  const photoService =
    dependencies.photoService ??
    createPhotoService({
      store: photoStore,
      uploads: photoUploadsStore,
      photos: createPrismaProfilePhotoRepository(getPrisma()),
    });

  // Profile Service (Chuan). It shares the favorites repository, so `isFavorite` on a profile
  // agrees with GET /favorites.
  const profileService =
    dependencies.profileService ??
    createProfileService({
      profiles: createPrismaProfileRepository(getPrisma()),
      hasher,
      auth: authService,
      places: locationService,
      photoUploads: dependencies.photoUploads ?? photoUploadsStore.claimer,
      favorites,
      scorer: createEngineMatchScorer({ engine }),
    });

  return new Elysia()
    .use(errorHandler)
    .use(corsPlugin(config))
    .use(openapiPlugin())
    .use(healthRoutes)
    .use(authRoutes(authService))
    .use(profileRoutes(profileService, sessionValidator))
    .use(locationRoutes(locationService))
    .use(messagingRoutes(messagingService, sessionValidator))
    .use(favoritesNotesRoutes(favoritesNotesService, sessionValidator))
    .use(matchRoutes(matchService, sessionValidator))
    .use(photoRoutes(photoService, sessionValidator));
}
