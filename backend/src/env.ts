/** Environment, validated at boot. Fail fast and loudly beats a 3am null. */
// Explicit node:process import (not the global) so this file also runs on Deno,
// where the edge entry calls loadEnv(Deno.env.toObject()) but the default-arg
// reference must still resolve.
import process from "node:process";
import { z } from "zod";
import { normalizePhone } from "./lib/phone.js";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().default("postgres://routino:routino@localhost:5432/routino"),

  /**
   * `pglite` runs a real Postgres (WASM) in-process, persisted to PGLITE_DIR.
   * That makes `npm run dev` work with no Postgres and no Docker installed —
   * useful because it is the same engine production runs, not a stand-in.
   * Forced to `postgres` in production: PGlite is single-connection.
   */
  DB_DRIVER: z.enum(["postgres", "pglite"]).default("pglite"),
  PGLITE_DIR: z.string().default("./.pglite-data"),

  /** Comma-separated. MUST include the Capacitor WebView origins or the Android
   * app cannot call the API at all: Android is `https://localhost` (because
   * capacitor.config.ts sets androidScheme: 'https') and iOS is
   * `capacitor://localhost`. This is the most common Capacitor-meets-API bite. */
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173,http://localhost:5180,https://localhost,capacitor://localhost"),

  /**
   * True when the API sits behind a reverse proxy (Caddy in the compose file).
   * Controls Fastify's trustProxy: when false, x-forwarded-for from a random
   * client is IGNORED — otherwise anyone could spoof the header and sidestep
   * every per-IP rate limit.
   */
  TRUST_PROXY: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),

  /** Owner-only admin login. Kept in deployment secrets, never in a table or UI. */
  ADMIN_PHONE: z.string().default(""),
  ADMIN_SESSION_SECRET: z
    .string()
    .min(32)
    .default("dev-only-admin-session-secret-change-me-32+"),

  JWT_SECRET: z.string().min(32).default("dev-only-secret-change-me-in-production-32+"),
  // Stateless access tokens expire after exactly 30 days and cannot be revoked early.
  ACCESS_TTL_SECONDS: z.coerce.number().default(2_592_000),

  /** Mixed into the OTP hash so a DB leak alone can't reverse 4-digit codes. */
  OTP_PEPPER: z.string().min(16).default("dev-only-otp-pepper-change-me"),
  OTP_TTL_SECONDS: z.coerce.number().default(120),
  OTP_MAX_ATTEMPTS: z.coerce.number().default(3),

  SMS_PROVIDER: z.enum(["console", "kavenegar"]).default("console"),
  KAVENEGAR_API_KEY: z.string().optional(),
  KAVENEGAR_TEMPLATE: z.string().default("routino-otp"),

  /** Production supports only ZarinPal. Fake is local/test-only and production
   * rejects it unconditionally. */
  PSP_PROVIDER: z.enum(["fake", "zarinpal"]).default("fake"),
  /** ZarinPal merchant id (36-char UUID). */
  ZARINPAL_MERCHANT: z.string().default("dev-only-zarinpal-merchant"),

  /** Public base URL of THIS server. ZarinPal redirects a browser here, so it must
   * be reachable from the user's device — `localhost` works for web dev but can
   * never work from a phone. Use a tunnel for device testing. */
  PUBLIC_API_URL: z.string().default("http://localhost:3000"),
  /** Where the web app lives, for the post-payment redirect.
   *
   * Must include the `/app` path. The app is served at `routino.me/app` (the
   * bare domain is the landing page), so a value without it sends everyone who
   * just paid to the marketing page instead of their subscription. In
   * production this is the `PUBLIC_WEB_URL` secret — keep the `/app` there too. */
  PUBLIC_WEB_URL: z.string().default("http://localhost:5180/app"),
  /** Deep link back into the Android app after payment. */
  APP_DEEP_LINK: z.string().default("routino://pay/result"),

  /** Bound the damage from the inherently-untrusted subscription import. */
  IMPORT_MAX_DAYS: z.coerce.number().default(400),

  /**
   * Optional owner bootstrap. When OWNER_PHONE and OWNER_PASSWORD are both set,
   * the server ensures that account exists with that password on boot (see
   * `services/owner-bootstrap.ts`). Idempotent, and it NEVER overwrites a
   * password the user has already set — so once the owner changes it from the
   * app, this env value stops mattering. Left empty in dev/tests.
   */
  OWNER_PHONE: z.string().default(""),
  OWNER_PASSWORD: z.string().default(""),
  OWNER_USERNAME: z.string().default(""),

  /**
   * Edge deployment only. When set, every request must carry the same value in
   * `x-proxy-secret` — the Cloudflare Worker in front of api.routino.me adds it,
   * so the raw *.supabase.co URL is unreachable and the worker-set client-IP
   * header becomes trustworthy (the edge analogue of TRUST_PROXY). Empty = off
   * (local dev/tests). /health stays open for monitoring.
   */
  PROXY_SECRET: z.string().default(""),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === "production") {
    if (parsed.data.JWT_SECRET.startsWith("dev-only"))
      throw new Error("JWT_SECRET must be set in production");
    if (parsed.data.OTP_PEPPER.startsWith("dev-only"))
      throw new Error("OTP_PEPPER must be set in production");
    if (!normalizePhone(parsed.data.ADMIN_PHONE))
      throw new Error("ADMIN_PHONE must be a valid Iranian mobile number in production");
    if (parsed.data.ADMIN_SESSION_SECRET.startsWith("dev-only"))
      throw new Error("ADMIN_SESSION_SECRET must be set in production");
    if (parsed.data.PROXY_SECRET.length < 32)
      throw new Error("PROXY_SECRET must be at least 32 characters in production");
    if (parsed.data.SMS_PROVIDER === "kavenegar" && !parsed.data.KAVENEGAR_API_KEY) {
      throw new Error("KAVENEGAR_API_KEY is required when SMS_PROVIDER=kavenegar");
    }
    // PGlite is single-connection; it is a development and test engine only.
    if (parsed.data.DB_DRIVER === "pglite")
      throw new Error("DB_DRIVER=pglite is not supported in production");

    if (parsed.data.PSP_PROVIDER !== "zarinpal")
      throw new Error("PSP_PROVIDER must be zarinpal in production; fake is forbidden");
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        parsed.data.ZARINPAL_MERCHANT,
      )
    )
      throw new Error("ZARINPAL_MERCHANT must be a valid 36-character merchant UUID");
    if (parsed.data.SMS_PROVIDER === "console")
      throw new Error("SMS_PROVIDER=console is not allowed in production");
  }
  return parsed.data;
}

/** Which live-money/live-delivery paths are currently faked. Printed at boot so
 * "why did nobody get the SMS" and "why is there no money in the account" are
 * answered by the first line of the log rather than by a support ticket. */
export function testProviderWarnings(env: Env): string[] {
  const out: string[] = [];
  if (env.PSP_PROVIDER === "fake") out.push("PAYMENTS: fake gateway — no real money.");
  if (env.SMS_PROVIDER === "console")
    out.push("SMS: console mode — login codes are printed to this log, not sent to anyone.");
  return out;
}
