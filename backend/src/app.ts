/**
 * Builds the Fastify app from injected dependencies.
 *
 * This module NEVER constructs a database connection — `index.ts` does that and
 * passes it in. That inversion is what lets the test suite hand in PGlite and
 * drive the real app with `app.inject()`: no ports, no Docker, milliseconds per
 * test. One module-level db singleton anywhere would break it.
 */
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import compress from "@fastify/compress";
import rateLimit from "@fastify/rate-limit";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import type { Database } from "./db/client.js";
import type { Env } from "./env.js";
import type { SmsProvider } from "./providers/sms/index.js";
import type { PspProvider } from "./providers/psp/index.js";
import { authPlugin } from "./plugins/auth.js";
import { registerErrorHandler } from "./plugins/errors.js";
import { adminRoutes } from "./routes/admin.js";
import { adminPanelRoutes } from "./routes/admin-panel.js";
import { authRoutes } from "./routes/auth.js";
import { devGatewayRoutes } from "./routes/dev-gateway.js";
import { deviceRoutes } from "./routes/devices.js";
import { healthRoutes } from "./routes/health.js";
import { paymentRoutes } from "./routes/payments.js";
import { planRoutes } from "./routes/plans.js";
import { subscriptionRoutes } from "./routes/subscriptions.js";
import { syncRoutes } from "./routes/sync.js";
import { requestIdFor } from "./lib/request-id.js";

export interface Deps {
  db: Database;
  env: Env;
  sms: SmsProvider;
  psp: PspProvider;
  /** Injectable so tests can control time instead of sleeping. */
  now: () => number;
}

/** Every route reaches its dependencies through `fastify.deps`. */
declare module "fastify" {
  interface FastifyInstance {
    deps: Deps;
  }
}

export type App = FastifyInstance;

export async function buildApp(deps: Omit<Deps, "now"> & { now?: () => number }): Promise<App> {
  const app = Fastify({
    logger: deps.env.NODE_ENV === "test" ? false : { level: "info" },
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: (req) => requestIdFor(req.headers["x-request-id"]),
    // Only honour x-forwarded-for behind our own proxy. Trusting it from the
    // open internet would let anyone spoof their IP past the OTP rate limits.
    trustProxy: deps.env.TRUST_PROXY,
    // Every request body here is a short JSON object — the largest is a
    // subscription import. 64 KB is generous for that and stops a multi-megabyte
    // payload from being parsed before validation gets to reject it (which
    // surfaced as a confusing 500 rather than a clean 400).
    bodyLimit: 64 * 1024,
  });

  app.decorate("deps", { now: () => Date.now(), ...deps } satisfies Deps);

  app.addHook("onRequest", async (req, reply) => {
    void reply.header("x-request-id", req.id);
  });

  app.addHook("onResponse", async (req, reply) => {
    if (deps.env.NODE_ENV === "test") return;
    const details = {
      requestId: req.id,
      method: req.method,
      route: req.routeOptions.url,
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
    };
    if (reply.statusCode >= 500) req.log.error(details, "request completed");
    else if (reply.elapsedTime >= 1_000) req.log.warn(details, "slow request");
    else if (Math.random() < 0.01) req.log.info(details, "request sample");
  });

  // A blunt per-IP ceiling. The precise limits that matter (SMS spend, login
  // guessing, admin tokens) are enforced in Postgres by the services, because
  // they must survive restarts and work across serverless isolates; this only
  // stops a single host from flooding the process. Off under test so the suite's
  // deliberate bursts stay deterministic.
  if (deps.env.NODE_ENV !== "test") {
    await app.register(rateLimit, {
      max: 300,
      timeWindow: "1 minute",
      // /health is what the uptime monitor hits, on a schedule, forever.
      allowList: (req) => req.url.startsWith("/health"),
    });
  }

  await app.register(helmet, {
    // The payment callback returns an HTML page that tries a custom-scheme deep
    // link; a strict CSP would block the inline script that performs it.
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: deps.env.CORS_ORIGINS.split(",").map((s) => s.trim()),
    credentials: true,
    // Cache the CORS preflight so the browser stops sending an OPTIONS request
    // before every API call. Without this, each authenticated call pays for two
    // round-trips to the (already ~1s) backend — the preflight and the request.
    // Browsers cap this (Chrome ~2h, Firefox 24h); the value is just the max ask.
    maxAge: 86400,
  });

  // Delta sync payloads are highly repetitive jsonb — compression is most of the
  // bandwidth win, and it costs one line.
  await app.register(compress, { global: true, threshold: 1024 });

  registerErrorHandler(app);
  await app.register(authPlugin);

  await app.register(healthRoutes);
  await app.register(planRoutes, { prefix: "/v1" });
  await app.register(authRoutes, { prefix: "/v1" });
  await app.register(deviceRoutes, { prefix: "/v1" });
  await app.register(subscriptionRoutes, { prefix: "/v1" });
  await app.register(syncRoutes, { prefix: "/v1" });
  await app.register(paymentRoutes, { prefix: "/v1" });
  await app.register(devGatewayRoutes, { prefix: "/v1" }); // no-op unless psp=fake
  await app.register(adminRoutes, { prefix: "/v1" });
  await app.register(adminPanelRoutes);

  return app;
}
