/*
 * Server entry point: validates the environment, builds the app and starts listening. It stops
 * cleanly on SIGTERM (Docker) and SIGINT (Ctrl+C). It also makes sure the photo bucket exists,
 * retrying while RustFS is still starting up.
 */
import type { S3Client } from "@aws-sdk/client-s3";

import { createApp } from "./app";
import { ConfigError, loadConfig } from "./config/env";
import { MAX_REQUEST_BODY_BYTES } from "./config/server";
import { createPrismaClient } from "./data/prismaClient";
import { createShutdown } from "./shutdown";
import {
  createRustFSS3Client,
  createRustFSPhotoStore,
  ensureRustFSBucket,
} from "./services/photo/photoStore";
import { createRustFSPhotoUploads, startUploadSweep } from "./services/photo/photoUploads";

const EXIT_CODE_BAD_CONFIG = 1;
// A short schedule of waits (milliseconds), not a single limit, so each value stays inline.
// eslint-disable-next-line no-magic-numbers
const BUCKET_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Make sure the photo bucket exists. RustFS may still be starting up (the compose race), so the
 * check waits and tries again; when the last try fails it gives up and the photo requests fail
 * until the server starts again. The server starts either way.
 * @param s3 - the RustFS S3 client
 * @param bucket - the bucket name from RUSTFS_BUCKET
 */
async function makeSurePhotoBucketExists(s3: S3Client, bucket: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await ensureRustFSBucket(s3, bucket);
      return;
    } catch (error) {
      const delay = BUCKET_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        console.error(
          "Could not make sure the photo bucket exists; giving up. Photo requests will fail " +
            "until the server starts again:",
          error,
        );
        return;
      }
      console.error(`Could not make sure the photo bucket exists; retrying in ${delay} ms:`, error);
      await sleep(delay);
    }
  }
}

try {
  const config = loadConfig();
  const prisma = createPrismaClient(config.databaseUrl);
  const app = createApp(config, { prisma }).listen({
    port: config.port,
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
  });
  console.log(`Mai Ru API running at http://${app.server?.hostname}:${app.server?.port}`);

  // The photo bucket is created when it is missing. This runs in the background, because the
  // server must start even when RustFS is not up yet.
  void makeSurePhotoBucketExists(createRustFSS3Client(config), config.rustfsBucket);

  // The temporary photo uploads expire after one hour; the sweep deletes the ones nobody used.
  const uploadSweep = createRustFSPhotoUploads({
    store: createRustFSPhotoStore(config),
    secret: config.jwtSecret,
  });
  const stopUploadSweep = startUploadSweep(() => uploadSweep.sweepExpired());
  process.once("exit", stopUploadSweep);

  const shutdown = createShutdown({
    stopServer: () => app.stop(),
    closeDatabase: () => prisma.$disconnect(),
    exit: (code) => process.exit(code),
  });
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(EXIT_CODE_BAD_CONFIG);
  }
  throw error;
}
