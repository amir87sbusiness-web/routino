import { afterEach, describe, expect, it, vi } from "vitest";
import { zarinpalPsp } from "../src/providers/psp/zarinpal.js";

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("ZarinPal success envelope hardening", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([100, 101] as const)("does not trust code %i without ref_id", async (code) => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ data: { code }, errors: [] })));

    await expect(zarinpalPsp("merchant").verify("A000", 1_990_000)).resolves.toEqual({
      kind: "unknown",
      code,
    });
  });

  it.each(["", "   ", "abc", "0", -1, 0, null] as const)(
    "does not trust an invalid ref_id: %s",
    async (refId) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => reply({ data: { code: 100, ref_id: refId }, errors: [] })),
      );

      await expect(zarinpalPsp("merchant").verify("A000", 1_990_000)).resolves.toEqual({
        kind: "unknown",
        code: 100,
      });
    },
  );

  it("accepts a numeric-string reference without changing it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply({ data: { code: 100, ref_id: "0012345" }, errors: [] })),
    );

    await expect(zarinpalPsp("merchant").verify("A000", 1_990_000)).resolves.toEqual({
      kind: "paid",
      code: 100,
      refNumber: "0012345",
      cardNumber: undefined,
    });
  });
});
