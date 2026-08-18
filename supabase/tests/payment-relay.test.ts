import { describe, expect, it, vi } from "vitest";
// @ts-expect-error — the relay is dependency-free production JavaScript.
import { createRelayHandler, signRelayRequest } from "../../payment-relay/relay.js";

const SECRET = "relay-secret-with-at-least-32-bytes";
const NOW = 1_787_098_000_000;

describe("Zibal fixed-egress relay", () => {
  it("accepts a valid signed request and replaces an untrusted merchant", async () => {
    let upstreamBody: Record<string, unknown> | undefined;
    let upstreamUrl = "";
    const upstream = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      upstreamUrl = String(input);
      upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ result: 100, trackId: 42 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const relay = createRelayHandler({
      merchant: "merchant-from-relay-secret",
      secret: SECRET,
      fetchImpl: upstream,
      now: () => NOW,
    });
    const path = "/v1/request";
    const body = JSON.stringify({
      merchant: "attacker-controlled",
      amount: 1_490_000,
      callbackUrl: "https://api.routino.me/v1/payments/callback",
      orderId: "order-1",
    });
    const timestamp = String(NOW);
    const nonce = "123e4567-e89b-42d3-a456-426614174000";
    const signature = await signRelayRequest({ secret: SECRET, timestamp, nonce, path, body });

    const response = await relay(
      new Request(`https://relay.routino.me${path}`, {
        method: "POST",
        body,
        headers: {
          "content-type": "application/json",
          "x-routino-timestamp": timestamp,
          "x-routino-nonce": nonce,
          "x-routino-signature": signature,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 100, trackId: 42 });
    expect(upstreamUrl).toBe("https://gateway.zibal.ir/v1/request");
    expect(upstreamBody).toEqual({
      merchant: "merchant-from-relay-secret",
      amount: 1_490_000,
      callbackUrl: "https://api.routino.me/v1/payments/callback",
      orderId: "order-1",
    });
  });

  it("rejects stale signed requests before contacting Zibal", async () => {
    const upstream = vi.fn();
    const relay = createRelayHandler({
      merchant: "merchant-live",
      secret: SECRET,
      fetchImpl: upstream,
      now: () => NOW,
    });
    const path = "/v1/verify";
    const body = JSON.stringify({ trackId: 42 });
    const timestamp = String(NOW - 60_001);
    const nonce = "123e4567-e89b-42d3-a456-426614174001";
    const signature = await signRelayRequest({ secret: SECRET, timestamp, nonce, path, body });
    const response = await relay(
      new Request(`https://relay.routino.me${path}`, {
        method: "POST",
        body,
        headers: {
          "x-routino-timestamp": timestamp,
          "x-routino-nonce": nonce,
          "x-routino-signature": signature,
        },
      }),
    );

    expect(response.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects a replayed nonce during its validity window", async () => {
    const upstream = vi.fn(async () => Response.json({ result: 100 }));
    const relay = createRelayHandler({
      merchant: "merchant-live",
      secret: SECRET,
      fetchImpl: upstream,
      now: () => NOW,
    });
    const path = "/v1/verify";
    const body = JSON.stringify({ trackId: 42 });
    const timestamp = String(NOW);
    const nonce = "123e4567-e89b-42d3-a456-426614174002";
    const signature = await signRelayRequest({ secret: SECRET, timestamp, nonce, path, body });
    const makeRequest = () =>
      new Request(`https://relay.routino.me${path}`, {
        method: "POST",
        body,
        headers: {
          "x-routino-timestamp": timestamp,
          "x-routino-nonce": nonce,
          "x-routino-signature": signature,
        },
      });

    expect((await relay(makeRequest())).status).toBe(200);
    expect((await relay(makeRequest())).status).toBe(409);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("keeps health local and allows only the two Zibal operations", async () => {
    const upstream = vi.fn();
    const relay = createRelayHandler({
      merchant: "merchant-live",
      secret: SECRET,
      fetchImpl: upstream,
      now: () => NOW,
    });
    const health = await relay(new Request("https://relay.routino.me/health"));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, service: "routino-payment-relay" });

    const forbidden = await relay(
      new Request("https://relay.routino.me/v1/refund", { method: "POST", body: "{}" }),
    );
    expect(forbidden.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects invalid or oversized JSON without contacting Zibal", async () => {
    const upstream = vi.fn();
    const relay = createRelayHandler({
      merchant: "merchant-live",
      secret: SECRET,
      fetchImpl: upstream,
      now: () => NOW,
    });
    const path = "/v1/request";
    const timestamp = String(NOW);
    const invalidBody = "not-json";
    const invalidNonce = "123e4567-e89b-42d3-a456-426614174003";
    const invalidSignature = await signRelayRequest({
      secret: SECRET,
      timestamp,
      nonce: invalidNonce,
      path,
      body: invalidBody,
    });
    const invalid = await relay(
      new Request(`https://relay.routino.me${path}`, {
        method: "POST",
        body: invalidBody,
        headers: {
          "x-routino-timestamp": timestamp,
          "x-routino-nonce": invalidNonce,
          "x-routino-signature": invalidSignature,
        },
      }),
    );
    expect(invalid.status).toBe(400);

    const oversizedBody = JSON.stringify({ padding: "x".repeat(8 * 1024) });
    const oversizedNonce = "123e4567-e89b-42d3-a456-426614174004";
    const oversizedSignature = await signRelayRequest({
      secret: SECRET,
      timestamp,
      nonce: oversizedNonce,
      path,
      body: oversizedBody,
    });
    const oversized = await relay(
      new Request(`https://relay.routino.me${path}`, {
        method: "POST",
        body: oversizedBody,
        headers: {
          "x-routino-timestamp": timestamp,
          "x-routino-nonce": oversizedNonce,
          "x-routino-signature": oversizedSignature,
        },
      }),
    );
    expect(oversized.status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });
});
