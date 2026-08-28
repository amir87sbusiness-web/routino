import { afterEach, describe, expect, it, vi } from "vitest";
import type { PspRequestInput } from "../src/providers/psp/index.js";
import { ZARINPAL_MIN_AMOUNT_RIAL } from "../src/providers/psp/index.js";
import { zarinpalPsp } from "../src/providers/psp/zarinpal.js";

const INPUT: PspRequestInput = {
  amountRial: 1_490_000,
  callbackUrl:
    "https://api.routino.me/v1/payments/callback?paymentId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  description: "Routino m3 (3m)",
  mobile: "09121234567",
};

type FetchCapture = { url?: string; init?: RequestInit; body?: Record<string, unknown> };

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(result: Response | Error, capture?: FetchCapture) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (capture) {
        capture.url = url;
        capture.init = init;
        capture.body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      }
      if (result instanceof Error) throw result;
      return result;
    }),
  );
}

describe("ZarinPal adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the exact production request contract in Rial", async () => {
    const capture: FetchCapture = {};
    mockFetch(
      response({ data: { code: 100, authority: "A000000000000000000000000000001" }, errors: [] }),
      capture,
    );

    const result = await zarinpalPsp("11111111-2222-4333-8444-555555555555").request(INPUT);

    expect(result).toEqual({
      kind: "issued",
      authority: "A000000000000000000000000000001",
      code: 100,
    });
    expect(capture.url).toBe("https://api.zarinpal.com/pg/v4/payment/request.json");
    expect(capture.init).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
    });
    expect(capture.init?.signal).toBeInstanceOf(AbortSignal);
    expect(capture.body).toEqual({
      merchant_id: "11111111-2222-4333-8444-555555555555",
      amount: 1_490_000,
      currency: "IRR",
      callback_url: INPUT.callbackUrl,
      description: INPUT.description,
      metadata: { mobile: INPUT.mobile },
    });
  });

  it("rejects an amount below ZarinPal's documented minimum before fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await zarinpalPsp("11111111-2222-4333-8444-555555555555").request({
      ...INPUT,
      amountRial: ZARINPAL_MIN_AMOUNT_RIAL - 1,
    });

    expect(result).toEqual({ kind: "rejected", code: -9 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ data: [], errors: { code: -9, message: "validation" } }, -9],
    [{ data: {}, errors: [{ code: -10, message: "merchant" }] }, -10],
    [{ data: { code: -11, message: "inactive" }, errors: [] }, -11],
  ])("normalizes an official request rejection without exposing its body", async (body, code) => {
    mockFetch(response(body));
    await expect(zarinpalPsp("m").request(INPUT)).resolves.toEqual({
      kind: "rejected",
      code,
    });
  });

  it.each([
    ["missing authority", { data: { code: 100 }, errors: [] }],
    ["missing code", { data: { authority: "A000" }, errors: [] }],
    ["empty object", {}],
  ])("keeps a malformed successful request recoverable: %s", async (_name, body) => {
    mockFetch(response(body));
    await expect(zarinpalPsp("m").request(INPUT)).resolves.toEqual({ kind: "unknown" });
  });

  it.each([
    ["HTTP failure", response({ error: "upstream" }, 502)],
    ["invalid JSON", new Response("<html>bad gateway</html>", { status: 200 })],
    ["network failure", new TypeError("fetch failed")],
    ["timeout", new DOMException("timed out", "TimeoutError")],
  ])("keeps an ambiguous request recoverable: %s", async (_name, result) => {
    mockFetch(result);
    await expect(zarinpalPsp("m").request(INPUT)).resolves.toEqual({ kind: "unknown" });
  });

  it("verifies with the stored authority and Rial amount", async () => {
    const capture: FetchCapture = {};
    mockFetch(
      response({
        data: { code: 100, ref_id: 998877, card_pan: "603799******1234" },
        errors: [],
      }),
      capture,
    );

    const result = await zarinpalPsp("11111111-2222-4333-8444-555555555555").verify(
      "A000000000000000000000000000001",
      1_490_000,
    );

    expect(result).toEqual({
      kind: "paid",
      code: 100,
      refNumber: "998877",
      cardNumber: "603799******1234",
    });
    expect(capture.url).toBe("https://api.zarinpal.com/pg/v4/payment/verify.json");
    expect(capture.body).toEqual({
      merchant_id: "11111111-2222-4333-8444-555555555555",
      amount: 1_490_000,
      authority: "A000000000000000000000000000001",
    });
  });

  it("treats code 101 as idempotent success", async () => {
    mockFetch(response({ data: { code: 101, ref_id: 998877 }, errors: [] }));
    await expect(zarinpalPsp("m").verify("A000", 590_000)).resolves.toEqual({
      kind: "already_verified",
      code: 101,
      refNumber: "998877",
      cardNumber: undefined,
    });
  });

  it.each([
    [-51, "pending"],
    [-12, "pending"],
    [-52, "unknown"],
    [-9, "failed"],
    [-10, "failed"],
    [-50, "failed"],
    [-53, "failed"],
    [-54, "failed"],
  ] as const)("classifies verify code %i as %s", async (code, kind) => {
    mockFetch(response({ data: [], errors: { code, message: "safe provider message" } }));
    await expect(zarinpalPsp("m").verify("A000", 590_000)).resolves.toEqual({ kind, code });
  });

  it.each([
    ["HTTP failure", response({ error: "upstream" }, 503)],
    ["invalid JSON", new Response("not json", { status: 200 })],
    ["malformed JSON", response({ data: { ref_id: 1 }, errors: [] })],
    ["network failure", new TypeError("fetch failed")],
    ["timeout", new DOMException("timed out", "TimeoutError")],
  ])("keeps an ambiguous Verify recoverable: %s", async (_name, result) => {
    mockFetch(result);
    await expect(zarinpalPsp("m").verify("A000", 590_000)).resolves.toEqual({
      kind: "unknown",
    });
  });

  it("builds the production StartPay URL", () => {
    expect(zarinpalPsp("m").startUrl("A000")).toBe("https://payment.zarinpal.com/pg/StartPay/A000");
  });
});
