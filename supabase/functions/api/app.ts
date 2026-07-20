/**
 * Builds the Hono app from injected dependencies — the edge counterpart of
 * backend/src/app.ts. No module constructs a database connection here; index.ts
 * does that and passes it in, which is what lets the vitest suite hand in PGlite
 * and drive this exact app with `app.request()`.
 *
 * URL shape: the Supabase gateway strips `/functions/v1` and hands us
 * `/api/...` (the function name), hence `basePath("/api")`. The Cloudflare
 * Worker maps `api.routino.me/*` onto `/functions/v1/api/*`, so public paths
 * (`/v1/...`, `/admin`, `/health`) are unchanged from the Fastify deployment.
 */
import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import type { AppEnv, Deps } from "./deps.ts";
import { HttpError } from "./shared/lib/http-errors.ts";
import { adminRoutes } from "./routes/admin.ts";
import { adminPanelRoutes } from "./routes/admin-panel.ts";
import { authRoutes } from "./routes/auth.ts";
import { devGatewayRoutes } from "./routes/dev-gateway.ts";
import { healthRoutes } from "./routes/health.ts";
import { paymentRoutes } from "./routes/payments.ts";
import { planRoutes } from "./routes/plans.ts";
import { subscriptionRoutes } from "./routes/subscriptions.ts";

const secretEquals = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
};

export function buildApp(deps: Deps) {
  const app = new Hono<AppEnv>().basePath("/api");

  // CORS first, so even a rejected request gets a well-formed preflight answer.
  const allowed = deps.env.CORS_ORIGINS.split(",").map((s) => s.trim());
  app.use(
    "*",
    cors({
      origin: (origin) => (allowed.includes(origin) ? origin : ""),
      credentials: true,
      allowHeaders: ["content-type", "authorization", "x-admin-token"],
      allowMethods: ["GET", "POST", "OPTIONS"],
    }),
  );

  // The edge analogue of TRUST_PROXY: when PROXY_SECRET is set, only requests
  // that came through our Cloudflare Worker (which adds the header) are served.
  // That blocks the raw *.supabase.co URL and makes the worker-set client-IP
  // header trustworthy. /health stays open for uptime monitors.
  app.use("*", async (c, next) => {
    const secret = deps.env.PROXY_SECRET;
    if (secret && !c.req.path.startsWith("/api/health")) {
      const got = c.req.header("x-proxy-secret");
      if (!got || !secretEquals(got, secret)) {
        return c.json({ error: "forbidden", message: "Direct access is not allowed" }, 403);
      }
    }
    await next();
  });

  // Same JSON error contract as Fastify's registerErrorHandler.
  app.onError((err, c) => {
    if (err instanceof HttpError) {
      const retryAfter = (err as HttpError & { retryAfter?: number }).retryAfter;
      if (retryAfter) c.header("Retry-After", String(retryAfter));
      return c.json(
        { error: err.code, message: err.message },
        err.statusCode as ContentfulStatusCode,
      );
    }
    if (err instanceof ZodError) {
      return c.json(
        {
          error: "invalid_request",
          message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        },
        400,
      );
    }
    // Anything unrecognised is a bug. Log it with the stack, but never leak the
    // internals to the client.
    console.error("unhandled error", err);
    return c.json({ error: "internal", message: "Internal server error" }, 500);
  });

  app.notFound((c) => c.json({ error: "not_found", message: "Route not found" }, 404));

  app.route("/", healthRoutes(deps));
  app.route("/v1", planRoutes(deps));
  app.route("/v1", authRoutes(deps));
  app.route("/v1", subscriptionRoutes(deps));
  app.route("/v1", paymentRoutes(deps));
  app.route("/v1", devGatewayRoutes(deps)); // no-op unless psp includes fake
  app.route("/v1", adminRoutes(deps));
  app.route("/", adminPanelRoutes(deps));

  return app;
}
