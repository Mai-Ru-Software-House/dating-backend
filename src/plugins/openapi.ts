/*
 * OpenAPI plugin: publishes the live API documentation at /openapi and the raw spec at
 * /openapi/json so the mobile app owner can read the current contract.
 */
import { openapi } from "@elysia/openapi";

const API_TITLE = "Mai Ru API";
const API_VERSION = "0.1.0";
const API_DESCRIPTION =
  "REST API for the Mai Ru online dating system. The written contract is docs/api-contract.md.";

/**
 * Build the OpenAPI plugin.
 * @returns an Elysia plugin to register with `.use()`
 */
export function openapiPlugin() {
  return openapi({
    documentation: {
      info: { title: API_TITLE, version: API_VERSION, description: API_DESCRIPTION },
      tags: [{ name: "System", description: "Health and other service level routes" }],
    },
  });
}
