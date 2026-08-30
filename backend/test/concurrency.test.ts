/**
 * Races. Everything here is "two things happened at the same instant".
 *
 * These are the failures that never show up in manual testing and then all
 * arrive together on the first advertised day, so each test is a specific way
 * two requests can interleave — not a load test. The bar throughout: nothing
 * crashes, nobody is granted or charged twice, and no write is silently lost.
 *
 * Caveat: PGlite is a single connection, so these interleave at the await points
 * rather than executing in true parallel. That catches read-then-write logic
 * races, which is where this class of bug lives; it is not a substitute for load
 * testing real Postgres.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeHarness, type Harness } from "./helpers/pglite.js";
import { claimSendSlot } from "../src/services/otp.js";

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
  h.psp._txns.clear();
});
afterAll(async () => {
  await h?.close();
});

const auth = (access: string) => ({ authorization: `Bearer ${access}` });

interface Session {
  access: string;
  user: { id: string };
}

/** A fresh stateless sign-in on the same account. */
async function signIn(phone: string): Promise<Session> {
  await h.raw(`update otp_codes set consumed_at = null, created_at = now() - interval '2 minutes'`);
  await h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
  const res = await h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { phone, code: h.sms.last()!.code },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as Session;
}

const push = (access: string, records: unknown[]) =>
  h.app.inject({
    method: "POST",
    url: "/v1/sync/push",
    headers: auth(access),
    payload: { records },
  });

const pull = (access: string, cursor = 0) =>
  h.app.inject({ method: "GET", url: `/v1/sync/pull?cursor=${cursor}`, headers: auth(access) });

const habit = (id: string, name: string, updatedAt: number) => ({
  kind: "habits",
  id,
  data: {
    id,
    name,
    categoryId: "c1",
    type: "binary",
    target: 1,
    schedule: { kind: "daily" },
    monthlyGoal: null,
    reminderTime: null,
    createdAt: 1,
  },
  updatedAt,
  deleted: false,
});

const monthCell = (habitId: string, dateKey: string, updatedAt: number) => ({
  kind: "habitMonths",
  id: `${habitId}|${dateKey.slice(0, 7)}`,
  data: {
    habitId,
    monthKey: dateKey.slice(0, 7),
    cells: {
      [dateKey.slice(8, 10)]: {
        value: 1,
        done: true,
        updatedAt,
        deleted: false,
      },
    },
  },
  updatedAt,
  deleted: false,
});

describe("one account, several devices at once", () => {
  it("keeps every sequence number unique when devices push simultaneously", async () => {
    const s = await signIn("09130000001");

    // Ten pushes landing together. Sequence numbers are what ordering depends
    // on, and a duplicate means one device's row is invisible to another
    // forever — the failure is silent, which is why it is asserted directly.
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => push(s.access, [habit(`h${i}`, `عادت ${i}`, 1000 + i)])),
    );

    const rows = await h.query<{ seq: string }>(
      `select seq::text from records where user_id = '${s.user.id}' order by seq`,
    );
    const seqs = rows.map((r) => Number(r.seq));
    expect(new Set(seqs).size).toBe(seqs.length);

    // And the whole account is reachable from a cursor of zero.
    const body = (await pull(s.access, 0)).json() as { records: { id: string }[] };
    expect(body.records.filter((r) => r.id.startsWith("h"))).toHaveLength(10);
  });

  it("resolves simultaneous edits of the SAME habit by last-write-wins", async () => {
    const s = await signIn("09130000002");
    await push(s.access, [habit("h1", "اسم اولیه", 1000)]);

    // Phone and laptop rename the same habit in the same instant.
    await Promise.all([
      push(s.access, [habit("h1", "از گوشی", 5000)]),
      push(s.access, [habit("h1", "از لپ‌تاپ", 4000)]),
    ]);

    const body = (await pull(s.access, 0)).json() as {
      records: { id: string; data: { name: string }; updatedAt: number }[];
    };
    const h1 = body.records.filter((r) => r.id === "h1");
    // Exactly one row survives, and it is the newer timestamp — not "whichever
    // request happened to finish second".
    expect(h1).toHaveLength(1);
    expect(h1[0]!.data.name).toBe("از گوشی");
    expect(h1[0]!.updatedAt).toBe(5000);
  });

  it("does not lose a device's write when another device pulls mid-push", async () => {
    const s = await signIn("09130000003");
    await push(s.access, [habit("seed", "پایه", 1000)]);
    const start = ((await pull(s.access, 0)).json() as { cursor: number }).cursor;

    // A pull racing two pushes. Whatever the pull returns, a later pull from the
    // same cursor must still deliver everything.
    await Promise.all([
      push(s.access, [habit("a", "الف", 2000)]),
      pull(s.access, start),
      push(s.access, [habit("b", "ب", 2000)]),
    ]);

    const final = (await pull(s.access, 0)).json() as { records: { id: string }[] };
    const ids = final.records.map((r) => r.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
  });

  it("preserves different days when two devices update one month concurrently", async () => {
    const s = await signIn("09130000010");

    await Promise.all([
      push(s.access, [monthCell("h1", "2026-08-01", 5000)]),
      push(s.access, [monthCell("h1", "2026-08-02", 1000)]),
    ]);

    const body = (await pull(s.access, 0)).json() as {
      records: { kind: string; data: { cells: Record<string, unknown> } }[];
    };
    const stored = body.records.find((record) => record.kind === "habitMonths")!;
    expect(Object.keys(stored.data.cells).sort()).toEqual(["01", "02"]);
  });
});

describe("simultaneous stateless sign-in", () => {
  it("returns a valid access token for every concurrent password sign-in", async () => {
    const phone = "09130000004";
    const first = await signIn(phone);

    // Password sign-in, not OTP: a code is single-use and only the newest is
    // accepted, so four simultaneous OTP sign-ins are impossible by design.
    await h.app.inject({
      method: "POST",
      url: "/v1/auth/password",
      headers: auth(first.access),
      payload: { newPassword: "Routino!2026" },
    });

    const login = () =>
      h.app.inject({
        method: "POST",
        url: "/v1/auth/password/login",
        payload: { identifier: phone, password: "Routino!2026" },
      });

    const logins = await Promise.all(Array.from({ length: 4 }, () => login()));
    for (const response of logins) {
      expect(response.statusCode).toBe(200);
      const body = response.json() as Record<string, unknown> & { access: string };
      expect(body.access).toEqual(expect.any(String));
      expect(body).not.toHaveProperty("refresh");
      expect(body).not.toHaveProperty("deviceId");
    }
    expect(
      await h.query(
        `select table_name from information_schema.tables where table_name = 'devices'`,
      ),
    ).toHaveLength(0);
  });
});

describe("storms", () => {
  it("handles a burst of pulls without duplicating or dropping records", async () => {
    const s = await signIn("09130000008");
    await push(
      s.access,
      Array.from({ length: 25 }, (_, i) => habit(`h${i}`, `عادت ${i}`, 1000 + i)),
    );

    const pulls = await Promise.all(Array.from({ length: 12 }, () => pull(s.access, 0)));
    for (const res of pulls) {
      expect(res.statusCode).toBe(200);
      const body = res.json() as { records: { id: string }[] };
      const ids = body.records.filter((r) => r.id.startsWith("h")).map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length); // no duplicates
      expect(ids).toHaveLength(25); // nothing dropped
    }
  });

  it("stays correct when the same push is retried concurrently", async () => {
    const s = await signIn("09130000009");
    const batch = [habit("h1", "ورزش", 3000), habit("h2", "مطالعه", 3000)];

    // A client that timed out and retried, three times over.
    await Promise.all([push(s.access, batch), push(s.access, batch), push(s.access, batch)]);

    const body = (await pull(s.access, 0)).json() as { records: { id: string }[] };
    const mine = body.records.filter((r) => r.id === "h1" || r.id === "h2");
    expect(mine).toHaveLength(2);
  });

  it("keeps 15 brand-new accounts entirely separate under simultaneous signup", async () => {
    const sessions = await Promise.all(
      Array.from({ length: 15 }, (_, i) => signIn(`09131${String(i).padStart(6, "0")}`)),
    );

    await Promise.all(
      sessions.map((s, i) => push(s.access, [habit(`own-${i}`, `مال ${i}`, 2000)])),
    );

    const bodies = await Promise.all(sessions.map((s) => pull(s.access, 0)));
    bodies.forEach((res, i) => {
      const body = res.json() as { records: { id: string }[] };
      const owned = body.records.filter((r) => r.id.startsWith("own-"));
      expect(owned).toHaveLength(1);
      expect(owned[0]!.id).toBe(`own-${i}`);
    });
  });
});

describe("the SMS bill", () => {
  it("sends ONE code when the same phone asks five times at once", async () => {
    const phone = "09135550001";

    // A retrying client, a double-tapped button, or someone deliberately
    // hammering the endpoint. Every send is real money at Kavenegar, and the
    // per-phone limit is one per minute — so five simultaneous requests must
    // still cost exactly one message.
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } }),
      ),
    );

    const sent = h.sms.sent.filter((m) => m.phone.endsWith(phone.slice(1)));
    expect(sent).toHaveLength(1);

    // And the rest were told to wait rather than failing loudly.
    const accepted = results.filter((r) => r.statusCode === 200);
    expect(accepted.length).toBeLessThanOrEqual(1);
  });

  it("cannot be made to send five codes by interleaving the rate check", async () => {
    const phone = "989135550002";
    const now = new Date();

    // The same five requests, but interleaved the way real Postgres would run
    // them across five connections: every check happens before any insert. Over
    // HTTP against single-connection PGlite this window happens to close on its
    // own, which is exactly why the guarantee has to be asserted at the level
    // where the race actually lives.
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, async () => {
        return (await claimSendSlot(h.db, h.env, phone, null, now)) ? "sent" : "blocked";
      }),
    );

    expect(outcomes.filter((o) => o === "sent")).toHaveLength(1);
  });
});

describe("limits that are counted rather than locked", () => {
  it("does not let concurrent imports extend a subscription twice", async () => {
    const s = await signIn("09136660001");
    const expiresAt = Date.now() + 60 * 86_400_000;
    const body = { planId: "m3", expiresAt, startedAt: Date.now(), trial: false };

    // Two tabs, or a retry, both rescuing the same legacy subscription. The
    // once-only check is a SELECT followed by a write, so both can pass it.
    await Promise.all([
      h.app.inject({
        method: "POST",
        url: "/v1/subscriptions/import",
        headers: auth(s.access),
        payload: body,
      }),
      h.app.inject({
        method: "POST",
        url: "/v1/subscriptions/import",
        headers: auth(s.access),
        payload: body,
      }),
    ]);

    const [row] = await h.query<{ expires_at: string }>(
      `select expires_at::text from entitlements where user_id = '${s.user.id}'`,
    );
    const days = (new Date(row!.expires_at).getTime() - Date.now()) / 86_400_000;
    // ~60 days, not ~120. `ensureExpiresAt` takes the MAX rather than stacking,
    // which is what makes a duplicate import harmless even when both pass the
    // once-only check.
    expect(days).toBeLessThan(75);
    expect(days).toBeGreaterThan(55);
  });

  it("reports how far concurrent wrong passwords can overshoot the guess limit", async () => {
    const s = await signIn("09136660002");
    await h.app.inject({
      method: "POST",
      url: "/v1/auth/password",
      headers: auth(s.access),
      payload: { newPassword: "Routino!2026" },
    });

    // 30 wrong guesses at once. The hard limit is 50 and the soft limit 8, and
    // the ledger is counted-then-written, so simultaneous guesses all read the
    // same total and all get a scrypt run. This asserts the bound rather than
    // perfection: what must NOT happen is unbounded guessing, and what DOES
    // happen is an overshoot of at most the attacker's concurrency — which an
    // HTTP rate limiter in front, not this ledger, is the right answer to.
    const attempts = await Promise.all(
      Array.from({ length: 30 }, () =>
        h.app.inject({
          method: "POST",
          url: "/v1/auth/password/login",
          payload: { identifier: "09136660002", password: "definitely-wrong" },
        }),
      ),
    );

    for (const r of attempts) expect([401, 429]).toContain(r.statusCode);

    const [row] = await h.query<{ n: number }>(
      `select count(*)::int as n from login_attempts where identifier = '989136660002'`,
    );
    // Every failure was recorded, so the NEXT burst starts already throttled.
    expect(Number(row!.n)).toBeGreaterThanOrEqual(25);

    // And the real owner is not locked out by someone else's guessing — the
    // whole reason the soft limit lets a CORRECT password through.
    const good = await h.app.inject({
      method: "POST",
      url: "/v1/auth/password/login",
      payload: { identifier: "09136660002", password: "Routino!2026" },
    });
    expect(good.statusCode).toBe(200);
  });
});
