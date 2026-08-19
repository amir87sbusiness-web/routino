// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
/** Environment, validated at boot. Fail fast and loudly beats a 3am null. */
// Explicit node:process import (not the global) so this file also runs on Deno,
// where the edge entry calls loadEnv(Deno.env.toObject()) but the default-arg
// reference must still resolve.
import process from "node:process";
import { z } from "zod";

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

  /** Shared secret for /v1/admin/* and the /admin panel. Header-only, compared
   * in constant time. */
  ADMIN_TOKEN: z.string().min(12).default("dev-only-admin-token"),

  JWT_SECRET: z.string().min(32).default("dev-only-secret-change-me-in-production-32+"),
  // Every protected request rechecks the user and device rows, so revocation is
  // immediate even with a longer JWT. One hour avoids needless refresh calls.
  ACCESS_TTL_SECONDS: z.coerce.number().default(3600),
  REFRESH_TTL_DAYS: z.coerce.number().default(180),

  /** Mixed into the OTP hash so a DB leak alone can't reverse 6-digit codes. */
  OTP_PEPPER: z.string().min(16).default("dev-only-otp-pepper-change-me"),
  OTP_TTL_SECONDS: z.coerce.number().default(120),
  OTP_MAX_ATTEMPTS: z.coerce.number().default(5),

  SMS_PROVIDER: z.enum(["console", "kavenegar"]).default("console"),
  KAVENEGAR_API_KEY: z.string().optional(),
  KAVENEGAR_TEMPLATE: z.string().default("routino-otp"),

  /**
   * Default single gateway. `fake` serves a local gateway page — the whole
   * payment state machine is testable with no external dependency. For one live
   * gateway, set this to `zibal` or `zarinpal`. To run BOTH (server picks the
   * fastest healthy one per checkout, with automatic failover), set
   * `PSP_PROVIDERS` instead — it overrides this when non-empty.
   */
  PSP_PROVIDER: z.enum(["fake", "zibal", "zarinpal"]).default("fake"),
  /**
   * Optional comma-separated gateway list, e.g. `zarinpal,zibal`. When set it
   * defines the active gateways AND their tiebreak order; the router routes each
   * checkout to the fastest healthy one and fails over. Empty = use
   * `PSP_PROVIDER` (single gateway).
   */
  PSP_PROVIDERS: z.string().default(""),
  /** Zibal's sandbox merchant is the literal string "zibal". */
  ZIBAL_MERCHANT: z.string().default("zibal"),

  /**
   * Explicit, deliberate permission to run TEST providers in production —
   * Zibal's sandbox merchant and/or console SMS.
   *
   * Without it production refuses to boot on either, because both fail in the
   * one direction nobody notices: sandbox Zibal shows the user a real gateway,
   * returns "paid", and grants a real subscription while zero Toman reaches the
   * merchant account. This has to be a decision somebody typed, not a default
   * somebody forgot. Turn it off the moment the real merchant id is in place.
   */
  ALLOW_TEST_PROVIDERS: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  /** ZarinPal merchant id (36-char UUID). No usable sandbox default — required
   * in production only when zarinpal is among the active gateways. */
  ZARINPAL_MERCHANT: z.string().default("dev-only-zarinpal-merchant"),

  /** Public base URL of THIS server. Zibal redirects a browser here, so it must
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

  /** Temporary test/dev escape hatch for exercising the retired sync engine.
   * Production is forbidden from enabling it: personal records are local-only. */
  LEGACY_PERSONAL_SYNC_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),

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

/** The active payment gateways, in tiebreak/priority order. `PSP_PROVIDERS`
 * (comma list) wins when set; otherwise the single `PSP_PROVIDER`. Unknown or
 * duplicate names are dropped. */
export function pspProviderNames(
  env: Pick<Env, "PSP_PROVIDER" | "PSP_PROVIDERS">,
): ("fake" | "zibal" | "zarinpal")[] {
  const known = ["fake", "zibal", "zarinpal"] as const;
  const raw = env.PSP_PROVIDERS.trim()
    ? env.PSP_PROVIDERS.split(",").map((s) => s.trim())
    : [env.PSP_PROVIDER];
  const out: ("fake" | "zibal" | "zarinpal")[] = [];
  for (const name of raw) {
    if (
      (known as readonly string[]).includes(name) &&
      !out.includes(name as (typeof known)[number])
    ) {
      out.push(name as (typeof known)[number]);
    }
  }
  return out;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === "production") {
    if (parsed.data.LEGACY_PERSONAL_SYNC_ENABLED)
      throw new Error("LEGACY_PERSONAL_SYNC_ENABLED is forbidden in production");
    if (parsed.data.JWT_SECRET.startsWith("dev-only"))
      throw new Error("JWT_SECRET must be set in production");
    if (parsed.data.OTP_PEPPER.startsWith("dev-only"))
      throw new Error("OTP_PEPPER must be set in production");
    if (parsed.data.ADMIN_TOKEN.startsWith("dev-only"))
      throw new Error("ADMIN_TOKEN must be set in production");
    if (parsed.data.SMS_PROVIDER === "kavenegar" && !parsed.data.KAVENEGAR_API_KEY) {
      throw new Error("KAVENEGAR_API_KEY is required when SMS_PROVIDER=kavenegar");
    }
    // PGlite is single-connection; it is a development and test engine only.
    if (parsed.data.DB_DRIVER === "pglite")
      throw new Error("DB_DRIVER=pglite is not supported in production");

    const psps = pspProviderNames(parsed.data);
    if (psps.length === 0)
      throw new Error("no payment gateway configured (set PSP_PROVIDER or PSP_PROVIDERS)");
    if (psps.includes("fake")) throw new Error("the 'fake' gateway is not allowed in production");
    if (psps.includes("zarinpal") && parsed.data.ZARINPAL_MERCHANT.startsWith("dev-only")) {
      throw new Error("ZARINPAL_MERCHANT is required when zarinpal is an active gateway");
    }
    // Zibal's sandbox is not a distinct host or a distinct flag — it is just the
    // merchant id left at its default. So the ONLY thing standing between "we
    // are taking real money" and "we are giving subscriptions away" is this
    // check. ZarinPal has had the equivalent guard since day one; Zibal did not,
    // which made forgetting one environment variable a silent revenue hole.
    if (
      psps.includes("zibal") &&
      parsed.data.ZIBAL_MERCHANT === "zibal" &&
      !parsed.data.ALLOW_TEST_PROVIDERS
    ) {
      throw new Error(
        "ZIBAL_MERCHANT is still the sandbox merchant 'zibal' — no real money would be collected. " +
          "Set the real merchant id, or set ALLOW_TEST_PROVIDERS=true to stay in sandbox on purpose.",
      );
    }
    if (parsed.data.SMS_PROVIDER === "console" && !parsed.data.ALLOW_TEST_PROVIDERS) {
      throw new Error(
        "SMS_PROVIDER=console writes every login code to the server log instead of sending it. " +
          "Set SMS_PROVIDER=kavenegar, or ALLOW_TEST_PROVIDERS=true to stay in console mode on purpose.",
      );
    }
  }
  return parsed.data;
}

/** Which live-money/live-delivery paths are currently faked. Printed at boot so
 * "why did nobody get the SMS" and "why is there no money in the account" are
 * answered by the first line of the log rather than by a support ticket. */
export function testProviderWarnings(env: Env): string[] {
  const out: string[] = [];
  if (pspProviderNames(env).includes("fake")) out.push("PAYMENTS: fake gateway — no real money.");
  if (pspProviderNames(env).includes("zibal") && env.ZIBAL_MERCHANT === "zibal")
    out.push(
      "PAYMENTS: Zibal SANDBOX merchant — subscriptions are granted, no real money is collected.",
    );
  if (env.SMS_PROVIDER === "console")
    out.push("SMS: console mode — login codes are printed to this log, not sent to anyone.");
  return out;
}
