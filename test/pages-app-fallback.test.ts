import { describe, expect, it, vi } from "vitest";

describe("Cloudflare Pages /app SPA fallback", () => {
  it("sets security headers while forcing HTML and revalidation", async () => {
    const assetsFetch = vi.fn(
      async () =>
        new Response("<!doctype html><title>Routino</title>", {
          headers: { "cache-control": "public, max-age=31536000" },
        }),
    );
    const { onRequest } = await import("../functions/app/[[path]].js");

    const response = await onRequest({
      request: new Request("https://routino.me/app/habits"),
      next: vi.fn(),
      env: { ASSETS: { fetch: assetsFetch } },
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(assetsFetch).toHaveBeenCalledOnce();
  });

  it("passes real app files through unchanged", async () => {
    const next = vi.fn(async () => new Response("asset"));
    const { onRequest } = await import("../functions/app/[[path]].js");

    const response = await onRequest({
      request: new Request("https://routino.me/app/assets/client.abc123.js"),
      next,
      env: { ASSETS: { fetch: vi.fn() } },
    } as never);

    expect(await response.text()).toBe("asset");
    expect(next).toHaveBeenCalledOnce();
  });
});
