/** Environment, validated at boot. Fail fast and loudly beats a 3am null. */
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
  ACCESS_TTL_SECONDS: z.coerce.number().default(900), // 15 min; a blocked user keeps access until this expires
  REFRESH_TTL_DAYS: z.coerce.number().default(180),

  /** Mixed into the OTP hash so a DB leak alone can't reverse 6-digit codes. */
  OTP_PEPPER: z.string().min(16).default("dev-only-otp-pepper-change-me"),
  OTP_TTL_SECONDS: z.coerce.number().default(120),
  OTP_MAX_ATTEMPTS: z.coerce.number().default(5),

  SMS_PROVIDER: z.enum(["console", "kavenegar"]).default("console"),
  KAVENEGAR_API_KEY: z.string().optional(),
  KAVENEGAR_TEMPLATE: z.string().default("routino-otp"),

  /** `fake` serves a local gateway page — the whole payment state machine is
   * testable with no external dependency. Swap to `zibal` via env only. */
  PSP_PROVIDER: z.enum(["fake", "zibal"]).default("fake"),
  /** Zibal's sandbox merchant is the literal string "zibal". */
  ZIBAL_MERCHANT: z.string().default("zibal"),

  /** Public base URL of THIS server. Zibal redirects a browser here, so it must
   * be reachable from the user's device — `localhost` works for web dev but can
   * never work from a phone. Use a tunnel for device testing. */
  PUBLIC_API_URL: z.string().default("http://localhost:3000"),
  /** Where the web app lives, for the post-payment redirect. */
  PUBLIC_WEB_URL: z.string().default("http://localhost:5180"),
  /** Deep link back into the Android app after payment. */
  APP_DEEP_LINK: z.string().default("routino://pay/result"),

  /** Bound the damage from the inherently-untrusted subscription import. */
  IMPORT_MAX_DAYS: z.coerce.number().default(400),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === "production") {
    if (parsed.data.JWT_SECRET.startsWith("dev-only")) throw new Error("JWT_SECRET must be set in production");
    if (parsed.data.OTP_PEPPER.startsWith("dev-only")) throw new Error("OTP_PEPPER must be set in production");
    if (parsed.data.ADMIN_TOKEN.startsWith("dev-only")) throw new Error("ADMIN_TOKEN must be set in production");
    if (parsed.data.SMS_PROVIDER === "kavenegar" && !parsed.data.KAVENEGAR_API_KEY) {
      throw new Error("KAVENEGAR_API_KEY is required when SMS_PROVIDER=kavenegar");
    }
    // PGlite is single-connection; it is a development and test engine only.
    if (parsed.data.DB_DRIVER === "pglite") throw new Error("DB_DRIVER=pglite is not supported in production");
    if (parsed.data.PSP_PROVIDER === "fake") throw new Error("PSP_PROVIDER=fake is not allowed in production");
  }
  return parsed.data;
}
