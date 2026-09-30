import { afterEach, describe, expect, it, vi } from "vitest";
import { paymentAuthorityHash, logPaymentStage } from "../src/lib/payment-diagnostics.js";
import { zarinpalPsp } from "../src/providers/psp/zarinpal.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("safe payment evidence", () => {
  it("correlates with a one-way authority hash and drops extra fields", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const authority = "A".repeat(36);
    const hash = paymentAuthorityHash(authority);
    logPaymentStage("callback_received", {
      paymentId: "123e4567-e89b-42d3-a456-426614174000",
      authorityHash: hash,
      phone: "09120000000",
      token: "private-token",
      authority,
    } as never);
    const output = JSON.stringify(log.mock.calls);
    expect(output).toContain(hash!);
    expect(output).not.toMatch(/09120000000|private-token|AAAAAAAA/);
    expect(paymentAuthorityHash(authority)).toBe(hash);
    expect(paymentAuthorityHash("B".repeat(36))).not.toBe(hash);
  });

  it("never lets a broken logger prevent a payment", () => {
    vi.spyOn(console, "info").mockImplementation(() => {
      throw new Error("logger unavailable");
    });
    expect(() => logPaymentStage("callback_received", {})).not.toThrow();
  });

  it("records an Inquiry proxy error without exposing payload or changing the ambiguous result", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"error":"private-proxy-message"}', { status: 404 })),
    );
    await expect(
      zarinpalPsp("private-merchant", {
        apiBase: "https://proxy.test",
        proxySecret: "private-proxy-secret",
      }).inquire!("A".repeat(36)),
    ).resolves.toEqual({ kind: "unknown", code: undefined });
    const output = JSON.stringify(log.mock.calls);
    expect(output).toContain("http_error");
    expect(output).toContain('"httpStatus":404');
    expect(output).not.toMatch(
      /private-merchant|private-proxy-secret|private-proxy-message|AAAAAAAA/,
    );
  });
});
