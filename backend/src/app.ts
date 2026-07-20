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
import Fastify, { type FastifyInstance } from "fastify";
import type { Database } from "./db/client.js";
import type { Env } from "./env.js";
import type { SmsProvider } from "./providers/sms/index.js";
import type { PspRouter } from "./providers/psp/index.js";
import { authPlugin } from "./plugins/auth.js";
import { registerErrorHandler } from "./plugins/errors.js";
import { adminRoutes } from "./routes/admin.js";
import { adminPanelRoutes } from "./routes/admin-panel.js";
import { authRoutes } from "./routes/auth.js";
import { devGatewayRoutes } from "./routes/dev-gateway.js";
import { healthRoutes } from "./routes/health.js";
import { paymentRoutes } from "./routes/payments.js";
import { planRoutes } from "./routes/plans.js";
import { subscriptionRoutes } from "./routes/subscriptions.js";

export interface Deps {
  db: Database;
  env: Env;
  sms: SmsProvider;
  /** One or more gateways behind a router (fastest-healthy + failover). */
  psp: PspRouter;
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
    // Only honour x-forwarded-for behind our own proxy. Trusting it from the
    // open internet would let anyone spoof their IP past the OTP rate limits.
    trustProxy: deps.env.TRUST_PROXY,
  });

  app.decorate("deps", { now: () => Date.now(), ...deps } satisfies Deps);

  await app.register(helmet, {
    // The payment callback returns an HTML page that tries a custom-scheme deep
    // link; a strict CSP would block the inline script that performs it.
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: deps.env.CORS_ORIGINS.split(",").map((s) => s.trim()),
    credentials: true,
  });

  // Delta sync payloads are highly repetitive jsonb — compression is most of the
  // bandwidth win, and it costs one line.
  await app.register(compress, { global: true, threshold: 1024 });

  registerErrorHandler(app);
  await app.register(authPlugin);

  await app.register(healthRoutes);
  await app.register(planRoutes, { prefix: "/v1" });
  await app.register(authRoutes, { prefix: "/v1" });
  await app.register(subscriptionRoutes, { prefix: "/v1" });
  await app.register(paymentRoutes, { prefix: "/v1" });
  await app.register(devGatewayRoutes, { prefix: "/v1" }); // no-op unless psp=fake
  await app.register(adminRoutes, { prefix: "/v1" });
  await app.register(adminPanelRoutes);

  return app;
}
