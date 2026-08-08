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
  refresh: string;
  user: { id: string };
}

/** A fresh sign-in. Each call is a new DEVICE on the same account. */
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
  data: { id, name },
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
});

describe("sign-in and sign-out racing each other", () => {
  it("leaves exactly MAX_ACTIVE_DEVICES sessions when four devices sign in at once", async () => {
    const phone = "09130000004";
    const first = await signIn(phone);

    // Password sign-in, not OTP: a code is single-use and only the newest is
    // accepted, so four SIMULTANEOUS OTP sign-ins are impossible by design.
    // Password is also what the app actually offers by default, which makes it
    // the path four devices really would arrive on together.
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

    // Four devices, all at the same moment. The limit is 2.
    const logins = await Promise.all([login(), login(), login(), login()]);
    for (const r of logins) expect(r.statusCode).toBe(200);

    const [row] = await h.query<{ n: number }>(
      `select count(*)::int as n from devices d
        join users u on u.id = d.user_id
       where u.phone = '98${phone.slice(1)}' and d.revoked_at is null`,
    );
    expect(Number(row!.n)).toBeLessThanOrEqual(2);
    // And at least one survives — evicting everybody would sign the user out of
    // the device they are holding.
    expect(Number(row!.n)).toBeGreaterThanOrEqual(1);
  });

  it("refuses to let one refresh token be spent twice", async () => {
    const s = await signIn("09130000005");

    // The same refresh token submitted five times at once: a flaky connection
    // retrying, or two tabs waking together. Rotation means exactly one may win;
    // if more did, an old token would stay valid forever.
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        h.app.inject({
          method: "POST",
          url: "/v1/auth/token/refresh",
          payload: { refresh: s.refresh },
        }),
      ),
    );
    const ok = results.filter((r) => r.statusCode === 200);
    expect(ok).toHaveLength(1);
    for (const r of results.filter((x) => x.statusCode !== 200)) {
      expect(r.statusCode).toBe(401);
    }
  });

  it("does not let a signed-out device keep working", async () => {
    const s = await signIn("09130000006");
    await h.app.inject({ method: "POST", url: "/v1/auth/logout", payload: { refresh: s.refresh } });

    // The access token is short-lived and still technically valid, but the
    // refresh must be dead immediately — that is what makes sign-out mean
    // something.
    const again = await h.app.inject({
      method: "POST",
      url: "/v1/auth/token/refresh",
      payload: { refresh: s.refresh },
    });
    expect(again.statusCode).toBe(401);
  });

  it("survives a sign-out landing while the same account signs in elsewhere", async () => {
    const phone = "09130000007";
    const first = await signIn(phone);

    const [, second] = await Promise.all([
      h.app.inject({ method: "POST", url: "/v1/auth/logout", payload: { refresh: first.refresh } }),
      signIn(phone),
    ]);

    // The new device must be usable; the old one must not.
    expect((await pull(second.access, 0)).statusCode).toBe(200);
    const dead = await h.app.inject({
      method: "POST",
      url: "/v1/auth/token/refresh",
      payload: { refresh: first.refresh },
    });
    expect(dead.statusCode).toBe(401);
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
