/**
 * The Cloudflare Worker in front of api.routino.me.
 *
 * It is 90 lines of plain JS with no build step and no type checking, and every
 * request to the API passes through it — so a mistake here is a total outage,
 * not a degraded feature. The edge-function suites never touch it (they drive
 * the Hono app directly), which left it as the one unexercised hop.
 *
 * `caches.default` and the `cf` runtime are stubbed with the same contract the
 * Workers runtime provides: a Cache API keyed by Request, and a `fetch` to the
 * Supabase origin.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error — plain JS with no types; the shape is asserted below.
import workerModule from "../../cloudflare/api-worker.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Worker = { fetch(req: Request, env: any, ctx: any): Promise<Response> };

// Safe to import once: the module holds no state, and it reads `caches`/`fetch`
// off the global at call time — after beforeEach has stubbed them.
const worker = workerModule as Worker;

const SUPABASE = "https://axychfrteevhfdhgvfuv.supabase.co/functions/v1/api";

/** Minimal stand-in for Cloudflare's `caches.default`, matching on URL+method. */
function stubCache() {
  const store = new Map<string, Response>();
  return {
    store,
    async match(req: Request) {
      const hit = store.get(req.url);
      return hit ? hit.clone() : undefined;
    },
    async put(req: Request, res: Response) {
      if (req.method !== "GET") throw new TypeError("Cannot cache non-GET");
      if (res.headers.get("vary") === "*") throw new TypeError("Cannot cache Vary: *");
      store.set(req.url, res);
    },
  };
}

let cache: ReturnType<typeof stubCache>;
let origin: ReturnType<typeof vi.fn>;
/** Promises handed to ctx.waitUntil, awaited before assertions on the cache. */
let pending: Promise<unknown>[];

const ctx = () => ({ waitUntil: (p: Promise<unknown>) => void pending.push(p) });
const env = { PROXY_SECRET: "s3cret" };

/** The Supabase function's real answer shape for /v1/plans, CORS included. */
const plansResponse = (origin = "https://routino.me") =>
  new Response(JSON.stringify({ plans: [{ id: "m1", price: 59000 }], offer: null }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": origin,
      vary: "Accept-Encoding, Origin",
    },
  });

const get = (path: string, headers: Record<string, string> = {}) =>
  worker.fetch(new Request(`https://api.routino.me${path}`, { headers }), env, ctx());

beforeEach(async () => {
  pending = [];
  cache = stubCache();
  origin = vi.fn();
  vi.stubGlobal("caches", { default: cache });
  vi.stubGlobal("fetch", origin);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const settle = () => Promise.all(pending);

describe("proxying", () => {
  it("maps the public path onto the function and stamps the proxy headers", async () => {
    origin.mockResolvedValue(new Response("{}", { status: 200 }));

    await worker.fetch(
      new Request("https://api.routino.me/v1/auth/otp/request", {
        method: "POST",
        body: "{}",
        headers: { "cf-connecting-ip": "5.6.7.8", "content-type": "application/json" },
      }),
      env,
      ctx(),
    );

    const [target, init] = origin.mock.calls[0];
    expect(target).toBe(`${SUPABASE}/v1/auth/otp/request`);
    // Without the secret the function 403s everything; without the IP the OTP
    // rate limits silently degrade to per-phone only.
    expect(init.headers.get("x-proxy-secret")).toBe("s3cret");
    expect(init.headers.get("x-client-ip")).toBe("5.6.7.8");
    expect(init.method).toBe("POST");
  });

  it("keeps the query string, which the payment callback is identified by", async () => {
    origin.mockResolvedValue(new Response("{}", { status: 200 }));
    await get("/v1/payments/callback?orderId=abc-123&success=1");
    expect(origin.mock.calls[0][0]).toBe(
      `${SUPABASE}/v1/payments/callback?orderId=abc-123&success=1`,
    );
  });

  it("restores text/html and drops the gateway sandbox CSP for marked pages", async () => {
    origin.mockResolvedValue(
      new Response("<h1>admin</h1>", {
        status: 200,
        headers: {
          "x-routino-html": "1",
          "content-type": "text/plain",
          "content-security-policy": "sandbox",
        },
      }),
    );

    const res = await get("/admin");
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    // Ours, not the gateway's: the admin page holds the admin token.
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("content-security-policy")).not.toBe("sandbox");
    expect(res.headers.get("x-routino-html")).toBeNull();
  });

  it("leaves the payment result page without a CSP, so the deep link still works", async () => {
    origin.mockResolvedValue(
      new Response("<h1>paid</h1>", {
        status: 200,
        headers: { "x-routino-html": "1", "content-security-policy": "sandbox" },
      }),
    );
    const res = await get("/v1/payments/callback");
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toBeNull();
  });
});

describe("edge cache for /v1/plans", () => {
  it("serves the second request without touching Supabase", async () => {
    origin.mockResolvedValue(plansResponse());

    const first = await get("/v1/plans", { origin: "https://routino.me" });
    expect(await first.json()).toMatchObject({ plans: [{ id: "m1", price: 59000 }] });
    await settle();

    const second = await get("/v1/plans", { origin: "https://routino.me" });
    expect(await second.json()).toMatchObject({ plans: [{ id: "m1", price: 59000 }] });

    // The whole point: one origin fetch, two answers.
    expect(origin).toHaveBeenCalledTimes(1);
  });

  it("does not let one origin's CORS header be served to another", async () => {
    // The function echoes the caller's origin, so a shared cache entry would
    // hand capacitor:// the site's header and the browser would reject it.
    origin.mockImplementation((_t: string, init: { headers: Headers }) =>
      Promise.resolve(plansResponse(init.headers.get("origin") ?? "")),
    );

    const web = await get("/v1/plans", { origin: "https://routino.me" });
    const app = await get("/v1/plans", { origin: "capacitor://localhost" });
    await settle();

    expect(web.headers.get("access-control-allow-origin")).toBe("https://routino.me");
    expect(app.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
    expect(origin).toHaveBeenCalledTimes(2);

    const again = await get("/v1/plans", { origin: "capacitor://localhost" });
    expect(again.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
    expect(origin).toHaveBeenCalledTimes(2); // both are cached now
  });

  it("marks the answer cacheable for the browser too", async () => {
    origin.mockResolvedValue(plansResponse());
    const res = await get("/v1/plans");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    // A stale `content-encoding` on a body the runtime already decoded would
    // make the browser fail to parse it.
    expect(res.headers.get("content-encoding")).toBeNull();
  });

  it("never caches a failure", async () => {
    origin.mockResolvedValue(new Response('{"error":"internal"}', { status: 500 }));

    const first = await get("/v1/plans");
    expect(first.status).toBe(500);
    await settle();
    expect(cache.store.size).toBe(0);

    // The next request must reach a (by then healthy) function, not replay the
    // 500 for five minutes on the one screen that takes money.
    origin.mockResolvedValue(plansResponse());
    const second = await get("/v1/plans");
    expect(second.status).toBe(200);
    expect(origin).toHaveBeenCalledTimes(2);
  });

  it("caches nothing else — every other path stays per-user and live", async () => {
    origin.mockResolvedValue(new Response('{"entitlement":{"status":"active"}}', { status: 200 }));

    await get("/v1/subscriptions/me", { authorization: "Bearer token" });
    await get("/v1/subscriptions/me", { authorization: "Bearer token" });
    await get("/health");
    await get("/health");
    await settle();

    expect(cache.store.size).toBe(0);
    expect(origin).toHaveBeenCalledTimes(4);
  });

  it("still answers correctly when the cache write is refused", async () => {
    // The Cache API rejects some responses outright. That must cost the cache
    // entry and nothing else — never the user's answer.
    cache.put = () => Promise.reject(new TypeError("Cannot cache"));
    origin.mockResolvedValue(plansResponse());

    const res = await get("/v1/plans");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ plans: [{ id: "m1", price: 59000 }] });
    await expect(settle()).resolves.toBeDefined();
  });

  it("does not cache a POST to a cacheable path", async () => {
    origin.mockResolvedValue(new Response("{}", { status: 200 }));
    await worker.fetch(
      new Request("https://api.routino.me/v1/plans", { method: "POST", body: "{}" }),
      env,
      ctx(),
    );
    await settle();
    expect(cache.store.size).toBe(0);
  });
});
