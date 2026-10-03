/*
 * Health route: GET /api/v1/health tells monitors and the mobile app that the server is up.
 * It needs no session.
 */
import { Elysia, t } from "elysia";

/** Elysia plugin with the health route. */
export const healthRoutes = new Elysia({ prefix: "/api/v1" }).get(
  "/health",
  () => ({ status: "ok" as const, timestamp: new Date().toISOString() }),
  {
    response: t.Object({ status: t.Literal("ok"), timestamp: t.String() }),
    detail: { summary: "Check that the server is running", tags: ["System"] },
  },
);
