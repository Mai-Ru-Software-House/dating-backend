/*
 * Server entry point: validates the environment, builds the app and starts listening.
 */
import { createApp } from "./app";
import { ConfigError, loadConfig } from "./config/env";

const EXIT_CODE_BAD_CONFIG = 1;

try {
  const config = loadConfig();
  const app = createApp(config).listen(config.port);
  console.log(`Mai Ru API running at http://${app.server?.hostname}:${app.server?.port}`);
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(EXIT_CODE_BAD_CONFIG);
  }
  throw error;
}
