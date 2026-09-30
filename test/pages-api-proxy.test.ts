import { describe, expect, it, vi } from "vitest";

describe("Cloudflare Pages /v1 proxy", () => {
  it("relays authenticated Inquiry while keeping unsupported and anonymous paths closed", async () => {
    const upstream = vi.fn(async (input: string | Request, _init?: RequestInit) =>
      String(input).includes("relay-auth")
        ? new Response(null, { status: 204 })
        : new Response('{"data":{"code":100,"status":"IN_BANK"}}'),
    );
    vi.stubGlobal("fetch", upstream);
    const { onRequest } = await import("../functions/v1/[[path]].js");
    const secret = "inquiry-test-secret".repeat(3);
    const url = "https://routino.me/v1/_zarinpal/pg/v4/payment/inquiry.json";
    const anonymous = await onRequest({ request: new Request(url, { method: "POST" }) } as never);
    expect(anonymous.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
    const response = await onRequest({
      request: new Request(url, {
        method: "POST",
        headers: { "x-proxy-secret": secret },
        body: '{"authority":"synthetic"}',
      }),
    } as never);
    expect(response.status).toBe(200);
    const forwarded = upstream.mock.calls[1];
    expect(forwarded?.[0]).toBe("https://payment.zarinpal.com/pg/v4/payment/inquiry.json");
    expect((forwarded?.[1] as RequestInit).headers).not.toHaveProperty("x-proxy-secret");
    const unsupported = await onRequest({
      request: new Request("https://routino.me/v1/_zarinpal/pg/v4/payment/refund.json", {
        method: "POST",
        headers: { "x-proxy-secret": secret },
      }),
    } as never);
    expect(unsupported.status).toBe(404);
    expect(upstream).toHaveBeenCalledTimes(2);
  });
  it("forwards the exact API path, query, method and auth to api.routino.me", async () => {
    const upstream = vi.fn(
      async (request: Request) =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json", "x-request-id": "upstream-id" },
        }),
    );
    vi.stubGlobal("fetch", upstream);
    const { onRequest } = await import("../functions/v1/[[path]].js");
    const request = new Request("https://routino.me/v1/devices/ping?fresh=1", {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify({ probe: true }),
    });

    const response = await onRequest({ request } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-routino-pages-proxy")).toBe("1");
    expect(upstream).toHaveBeenCalledOnce();
    const forwarded = upstream.mock.calls[0]![0];
    expect(forwarded.url).toBe("https://api.routino.me/v1/devices/ping?fresh=1");
    expect(forwarded.method).toBe("POST");
    expect(forwarded.headers.get("authorization")).toBe("Bearer test-token");
    expect(await forwarded.json()).toEqual({ probe: true });
  });

  it("returns a small 502 without leaking an upstream exception", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("private detail"))),
    );
    const { onRequest } = await import("../functions/v1/[[path]].js");

    const response = await onRequest({
      request: new Request("https://routino.me/v1/plans"),
    } as never);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "api_unavailable" });
  });

  it("rejects an oversized body before making an upstream request", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const { onRequest } = await import("../functions/v1/[[path]].js");

    const response = await onRequest({
      request: new Request("https://routino.me/v1/auth/password/login", {
        method: "POST",
        body: "x".repeat(64 * 1024 + 1),
      }),
    } as never);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "body_too_large" });
    expect(upstream).not.toHaveBeenCalled();
  });
});
