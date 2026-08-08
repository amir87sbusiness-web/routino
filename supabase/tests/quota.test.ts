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

/**
 * What one user's synced data actually looks like after a season of real use.
 *
 * This is the number that matters most now and it used to be measured as ZERO:
 * before sync shipped, `records` stayed empty and the whole budget was computed
 * from account rows alone. Turning sync on made `records` the largest table in
 * the product by a wide margin, so a budget that ignores it is not conservative,
 * it is wrong.
 *
 * A quarter, not a year, so 300 simulated users stay a test rather than a batch
 * job — the per-RECORD cost is reported alongside, which is what lets you scale
 * this to however long a real user stays.
 */
const RECORDS_PER_USER = {
  categories: 16, // the default seed, which every user gets on first launch
  habits: 6,
  logs: 90, // ~3 months of ticking a few habits
  journal: 30,
  tasks: 12,
  settings: 10,
} as const;

const SYNCED_ROWS = Object.values(RECORDS_PER_USER).reduce((a, b) => a + b, 0);

/** Pushes that footprint through the real sync endpoint. */
async function seedSyncData(access: string, seed: number): Promise<void> {
  const rows: unknown[] = [];
  const add = (kind: string, id: string, data: unknown) =>
    rows.push({ kind, id, data, updatedAt: 1_700_000_000_000 + seed, deleted: false });

  for (let i = 0; i < RECORDS_PER_USER.categories; i++) {
    add("categories", `cat-${i}`, {
      id: `cat-${i}`,
      name: "دسته‌بندی نمونه",
      icon: "star",
      color: "#ff8800",
    });
  }
  for (let i = 0; i < RECORDS_PER_USER.habits; i++) {
    add("habits", `hab-${i}`, {
      id: `hab-${i}`,
      name: "ورزش صبحگاهی روزانه",
      categoryId: `cat-${i % 4}`,
      type: "binary",
      target: 1,
      schedule: { kind: "daily" },
      monthlyGoal: 30,
      reminderTime: "07:30",
      createdAt: 1_700_000_000_000,
    });
  }
  for (let i = 0; i < RECORDS_PER_USER.logs; i++) {
    add(
      "logs",
      `hab-${i % 6}|2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      {
        habitId: `hab-${i % 6}`,
        dateKey: "2026-05-01",
        value: 1,
        note: "",
      },
    );
  }
  for (let i = 0; i < RECORDS_PER_USER.journal; i++) {
    add(
      "journal",
      `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      {
        dateKey: "2026-05-01",
        // A real entry, not an empty string — journal text is the biggest single
        // field a user writes and pretending it is short flatters the estimate.
        text: "امروز روز خوبی بود، تمرین کردم و کتاب خوندم. فردا باید زودتر بیدار بشم.",
        score: 8,
        mood: "🙂",
        updatedAt: 1_700_000_000_000,
      },
    );
  }
  for (let i = 0; i < RECORDS_PER_USER.tasks; i++) {
    add("tasks", `task-${i}`, {
      id: `task-${i}`,
      title: "کار نمونه برای امروز",
      dateKey: "2026-05-01",
      done: i % 2 === 0,
      color: "#ff8800",
      icon: "check",
    });
  }
  const settingKeys = [
    "lang",
    "cal",
    "brand",
    "weekStart",
    "journalReminder",
    "a",
    "b",
    "c",
    "d",
    "e",
  ];
  for (const k of settingKeys.slice(0, RECORDS_PER_USER.settings)) {
    add("settings", k, { value: "fa" });
  }

  // The server caps a push at 200 records, same as a real client.
  for (let i = 0; i < rows.length; i += 200) {
    await h.call("POST", "/v1/sync/push", {
      headers: auth(access),
      body: { records: rows.slice(i, i + 200) },
    });
  }
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

    // The app's real boot request, which now also carries the entitlement.
    await record(
      "GET /v1/sync/pull",
      await h.call("GET", "/v1/sync/pull?cursor=0", { headers: auth(access) }),
    );

    await seedSyncData(access, i);

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
  // Generous, and load-bearing: vitest SKIPS a suite whose beforeAll times out,
  // and a budget guard that silently skips under CI load is a budget guard you
  // do not have. 300 simulated users seeding a quarter of habit data each is
  // minutes of work on a busy machine.
}, 600_000);

afterAll(async () => {
  await h?.close();
});

const sum = (names: readonly string[], from = sizes) =>
  names.reduce((total, name) => total + (from.get(name) ?? 0), 0);

describe("database growth", () => {
  it("reports what a user's synced habits and journal cost", () => {
    const recordsBytes = sum(["records"]) - sum(["records"], sizesAtHalf);
    const perUser = recordsBytes / (USERS - HALF);
    const perRow = perUser / SYNCED_ROWS;

    console.log(
      `[db] synced data: ${SYNCED_ROWS} rows/user (≈a quarter of use) costs ${Math.round(perUser)}B` +
        `\n     ≈ ${Math.round(perRow)} B per record — a user who stays a YEAR (~${SYNCED_ROWS * 4} rows)` +
        ` costs ≈ ${Math.round((perRow * SYNCED_ROWS * 4) / 1024)} KB` +
        `\n     500 MB holds ≈ ${Math.round(FREE_DB_BYTES / (perRow * SYNCED_ROWS * 4)).toLocaleString("en-US")} users at a year each`,
    );

    // The guard that matters: sync must not make a user cost a megabyte. This is
    // deliberately loose — it is a "something changed structurally" alarm, not a
    // target.
    expect(perRow).toBeLessThan(600);
  });

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

    // These two numbers moved by 30x when sync shipped, and that is the single
    // most important fact about this project's hosting.
    //
    // Before sync, `records` was empty and a user cost ~1.6 KB forever, so 500 MB
    // read as ~330,000 users and the database was effectively free. With sync on,
    // a user's habits and journal ARE the database: a quarter of use is ~57 KB,
    // which puts the free tier at roughly 9,000 users — and unlike the monthly
    // invocation and egress quotas, this one does not reset. It fills up and
    // stays full.
    //
    // 80 KB is the alarm line: it is a comfortable margin over the ~57 KB a
    // three-month user costs today, and crossing it means either records grew a
    // fatter shape or something new started accumulating per user.
    expect(marginal).toBeLessThan(80 * 1024);
    // Still enough to launch on and grow into. When this fails, the answer is a
    // paid Supabase plan (8 GB for $25/mo), not a code change.
    expect(capacity).toBeGreaterThan(6_000);
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

  it("keeps the account tables small next to the synced data", () => {
    // The comment this replaces called `records` "the one thing that could turn
    // 330k users into 3k" and asserted it stayed empty. Sync shipped, so it is
    // no longer empty and that assertion was the alarm going off exactly as
    // designed. What is still worth guarding is the SHAPE of the bill: the
    // user's own data should dominate it, and the account plumbing around it —
    // devices, grants, payments, entitlements — should stay a rounding error. If
    // that ever inverts, something is accumulating per user that has nothing to
    // do with what they wrote.
    const accountTables = [
      "users",
      "devices",
      "entitlements",
      "grants",
      "payments",
      "redemptions",
      "feedback",
    ];
    const accountBytes = sum(accountTables) - sum(accountTables, sizesAtHalf);
    const recordBytes = sum(["records"]) - sum(["records"], sizesAtHalf);

    expect(recordBytes).toBeGreaterThan(0); // sync is on; it must be storing something
    expect(accountBytes).toBeLessThan(recordBytes);
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
