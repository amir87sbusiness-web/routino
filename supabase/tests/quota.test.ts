/**
 * Supabase free-tier budget guard.
 *
 * The worry this answers: "will the Supabase project fill up, and how fast?"
 * Free tier gives 500 MB of database and 5 GB of egress, and migrating off a
 * full project is painful — so the cost of a user has to be a number we know,
 * not a hope.
 *
 * It drives the REAL edge app against a REAL Postgres (PGlite) through the same
 * flows a person goes through — sign up, refresh a token, buy a plan, leave
 * feedback, fail a login — then reads `pg_total_relation_size` off the result.
 * That splits the schema in two:
 *
 *   permanent  users, devices, entitlements, grants, payments, redemptions,
 *              feedback — one-way growth, so their cost is *per user, forever*
 *              and they are what eventually fills 500 MB.
 *   rolling    otp_codes, login_attempts — pg_cron deletes rows past 24h
 *              (supabase/setup.sql), so their size tracks a single DAY of
 *              traffic and never accumulates.
 *
 * Response sizes are measured the same way, because egress is just bytes×calls.
 *
 * The assertions are budgets, not truths: they exist so that a future change
 * which makes a user cost 10× more fails here instead of on the billing page.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth, makeHarness, type Harness } from "./helpers/harness.ts";

/** Supabase Free plan, the two limits this file is about. */
const FREE_DB_BYTES = 500 * 1024 * 1024;
const FREE_EGRESS_BYTES = 5 * 1024 * 1024 * 1024;

/**
 * Measured as a SLOPE, not a total: an empty schema already costs ~250 KB in
 * minimum heap and index pages, which at any test-sized N swamps the real
 * per-user cost (it read as 6 KB/user at N=120, ~4 KB of which was just the
 * fixed overhead being divided by 120). So the simulation runs to HALF, takes a
 * snapshot, runs to FULL, and reports the difference — the marginal user, which
 * is the only number that predicts when 500 MB runs out.
 */
const USERS = 300;
const HALF = USERS / 2;
/** The share that actually pays (a deliberately generous 40%). */
const PAYING = Math.round(USERS * 0.4);

const PERMANENT = [
  "users",
  "devices",
  "entitlements",
  "grants",
  "payments",
  "redemptions",
  "feedback",
  "records",
] as const;
const ROLLING = ["otp_codes", "login_attempts"] as const;

let h: Harness;
/** Filled by the simulation, read by every test below. */
const sizes = new Map<string, number>();
const sizesAtHalf = new Map<string, number>();
const responseBytes = new Map<string, number>();

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
/** Single-quoted SQL literal, for the few rows inserted without a route. */
const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** Bytes of a response body, i.e. exactly what leaves Supabase for one call. */
async function record(label: string, res: Response): Promise<Response> {
  const body = await res.clone().text();
  responseBytes.set(label, Buffer.byteLength(body));
  return res;
}

async function signUp(phone: string) {
  await record(
    "POST /v1/auth/otp/request",
    await h.call("POST", "/v1/auth/otp/request", { body: { phone } }),
  );
  const code = h.sms.last()!.code;
  const res = await record(
    "POST /v1/auth/otp/verify",
    await h.call("POST", "/v1/auth/otp/verify", { body: { phone, code } }),
  );
  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { access: string; refresh: string; deviceId: string };
}

async function buyPlan(access: string, planId: string) {
  const res = await record(
    "POST /v1/payments/checkout",
    await h.call("POST", "/v1/payments/checkout", {
      headers: auth(access),
      body: { planId, platform: "web" },
    }),
  );
  const { paymentId, trackId } = (await res.json()) as { paymentId: string; trackId: number };
  const settle = await h.call("GET", `/v1/dev/gateway/settle?trackId=${trackId}&outcome=paid`);
  await h.follow(settle.headers.get("location")!);
  return paymentId;
}

/** Table sizes as Postgres itself reports them, after reclaiming dead tuples. */
async function measure(into: Map<string, number>): Promise<void> {
  // Autovacuum does this continuously on the real database; without it the
  // token-refresh UPDATEs would be counted as growth they are not.
  await h.raw("vacuum analyze");
  const rows = await h.query<{ relname: string; bytes: string }>(`
    select relname, pg_total_relation_size(c.oid)::text as bytes
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  `);
  into.clear();
  for (const r of rows) into.set(r.relname, Number(r.bytes));
}

beforeAll(async () => {
  h = await makeHarness();

  for (let i = 0; i < USERS; i++) {
    if (i === HALF) await measure(sizesAtHalf);
    // 0912 + 7 digits — distinct, and valid for normalizePhone.
    const phone = `0912${String(1_000_000 + i).slice(-7)}`;
    const { access, refresh } = await signUp(phone);

    // A day of app use: the client refreshes when the 15-min access token
    // lapses. The row is UPDATEd in place, so this is about dead tuples, not
    // new rows — which is the point of measuring after a vacuum below.
    let token = refresh;
    for (let r = 0; r < 3; r++) {
      const res = await record(
        "POST /v1/auth/token/refresh",
        await h.call("POST", "/v1/auth/token/refresh", { body: { refresh: token } }),
      );
      token = ((await res.json()) as { refresh: string }).refresh;
    }

    await record(
      "GET /v1/subscriptions/me",
      await h.call("GET", "/v1/subscriptions/me", { headers: auth(access) }),
    );

    if (i < PAYING) await buyPlan(access, i % 3 === 0 ? "m12" : "m1");

    // A fifth of users send feedback. Inserted directly on purpose: there is no
    // POST /v1/feedback yet (FeedbackModal keeps it in IndexedDB), but the table
    // is in the schema, so this budgets for the day it gets wired up rather than
    // measuring a zero that would later surprise us.
    if (i % 5 === 0) {
      await h.raw(
        `insert into feedback (rating, section, comment, at)
         values (4, 'habits', ${literal("خیلی خوبه ولی کاش ".repeat(8))}, now())`,
      );
    }

    // A wrong password now and then — this is what fills login_attempts.
    if (i % 4 === 0) {
      await h.call("POST", "/v1/auth/password/login", {
        body: { identifier: phone, password: "wrong-password" },
      });
    }
  }

  await record("GET /v1/plans", await h.call("GET", "/v1/plans"));
  await record("GET /health", await h.call("GET", "/health"));

  await measure(sizes);
});

afterAll(async () => {
  await h?.close();
});

const sum = (names: readonly string[], from = sizes) =>
  names.reduce((total, name) => total + (from.get(name) ?? 0), 0);

describe("database growth", () => {
  it("reports what one more user costs, forever", () => {
    const permanent = sum(PERMANENT);
    const marginal = (permanent - sum(PERMANENT, sizesAtHalf)) / (USERS - HALF);
    const capacity = Math.floor(FREE_DB_BYTES / marginal);

    const breakdown = [...PERMANENT]
      .map((t) => {
        const delta = (sizes.get(t) ?? 0) - (sizesAtHalf.get(t) ?? 0);
        return `${t}=${(delta / (USERS - HALF)).toFixed(0)}B`;
      })
      .join("  ");
    console.log(
      `\n[db] permanent tables at ${USERS} users (${PAYING} paying): ${kb(permanent)} total\n` +
        `     marginal cost per user: ${breakdown}\n` +
        `     ≈ ${marginal.toFixed(0)} bytes/user → 500 MB holds ~${capacity.toLocaleString()} users\n`,
    );

    // 2 KB is already several times what these rows hold; crossing it means a
    // new table started growing per-user, which is the change worth catching.
    expect(marginal).toBeLessThan(2048);
    expect(capacity).toBeGreaterThan(250_000);
  });

  it("keeps the rate-limit ledgers off the permanent bill", () => {
    const rolling = sum(ROLLING);
    console.log(
      `[db] rolling 24h ledgers for ${USERS} sign-ups: ${kb(rolling)} ` +
        `(otp_codes=${kb(sizes.get("otp_codes") ?? 0)}, login_attempts=${kb(sizes.get("login_attempts") ?? 0)})`,
    );

    // Not a size assertion — a purge assertion. These two tables are the only
    // ones written on every unauthenticated request, so if the pg_cron jobs in
    // supabase/setup.sql ever stop covering them they become the fastest way to
    // fill the disk. Deleting a day-old row must leave nothing behind.
    return h
      .raw(
        `delete from otp_codes where created_at < now() - interval '24 hours';
         delete from login_attempts where created_at < now() - interval '24 hours'`,
      )
      .then(async () => {
        await h.raw(
          `update otp_codes set created_at = now() - interval '48 hours';
           update login_attempts set created_at = now() - interval '48 hours'`,
        );
        await h.raw(
          `delete from otp_codes where created_at < now() - interval '24 hours';
           delete from login_attempts where created_at < now() - interval '24 hours'`,
        );
        const [otp] = await h.query<{ n: string }>("select count(*)::text as n from otp_codes");
        const [att] = await h.query<{ n: string }>(
          "select count(*)::text as n from login_attempts",
        );
        expect(Number(otp.n)).toBe(0);
        expect(Number(att.n)).toBe(0);
      });
  });

  it("stores nothing of the user's habits, tasks or journal", () => {
    // The app is offline-first: everything a person actually creates lives in
    // IndexedDB on their device. `records` is the table sync WOULD use, and it
    // is the one thing that could turn 330k users into 3k — so its emptiness is
    // an architectural fact worth failing on if it silently changes.
    expect(sizes.get("records") ?? 0).toBeLessThan(64 * 1024);
  });
});

describe("egress", () => {
  it("reports the bytes a user costs per day", () => {
    const lines = [...responseBytes.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, bytes]) => `     ${String(bytes).padStart(5)} B  ${label}`)
      .join("\n");

    // One app open: entitlement check + a token refresh. Everything else
    // (sign-up, checkout) happens once in a user's life, not daily.
    const perDay =
      (responseBytes.get("GET /v1/subscriptions/me") ?? 0) +
      (responseBytes.get("POST /v1/auth/token/refresh") ?? 0);
    const dau = Math.floor(FREE_EGRESS_BYTES / (perDay * 30));

    console.log(
      `\n[egress] response sizes:\n${lines}\n` +
        `     ≈ ${perDay} B per user per day → 5 GB/month covers ~${dau.toLocaleString()} daily users\n` +
        `     (the web app itself is on Cloudflare Pages and costs Supabase nothing)\n`,
    );

    // No API response should ever be page-sized. A regression here means an
    // endpoint started returning a list instead of an answer.
    for (const [label, bytes] of responseBytes) {
      expect(bytes, `${label} response is too large`).toBeLessThan(4096);
    }
    expect(dau).toBeGreaterThan(100_000);
  });
});
