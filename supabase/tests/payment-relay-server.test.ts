import type { Server } from "node:http";
import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error — the relay is dependency-free production JavaScript.
import { createRelayServer } from "../../payment-relay/server-core.js";

let server: Server | undefined;

afterEach(async () => {
  if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

async function listen(relay: (request: Request) => Promise<Response>) {
  server = createRelayServer({ relay });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind TCP");
  return address.port;
}

describe("payment relay Node server", () => {
  it("serves the local health endpoint through the real HTTP adapter", async () => {
    const relay = vi.fn(async () => Response.json({ ok: true }));
    const port = await listen(relay);

    const response = await fetch(`http://127.0.0.1:${port}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(relay).toHaveBeenCalledTimes(1);
  });

  it("rejects a declared oversized body before reading or calling the relay", async () => {
    const relay = vi.fn(async () => Response.json({ ok: true }));
    const port = await listen(relay);

    const status = await new Promise<number>((resolve, reject) => {
      const outgoing = httpRequest(
        {
          host: "127.0.0.1",
          port,
          path: "/v1/request",
          method: "POST",
          headers: { "content-length": String(9 * 1024) },
        },
        (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode ?? 0));
        },
      );
      outgoing.on("error", reject);
      outgoing.end("{}");
    });

    expect(status).toBe(413);
    expect(relay).not.toHaveBeenCalled();
  });

  it("sets conservative connection and slow-request limits", async () => {
    const relay = vi.fn(async () => Response.json({ ok: true }));
    await listen(relay);

    expect(server!.headersTimeout).toBeLessThanOrEqual(5_000);
    expect(server!.requestTimeout).toBeLessThanOrEqual(10_000);
    expect(server!.keepAliveTimeout).toBeLessThanOrEqual(5_000);
    expect(server!.maxConnections).toBe(128);
    expect(server!.maxRequestsPerSocket).toBe(100);
  });
});
